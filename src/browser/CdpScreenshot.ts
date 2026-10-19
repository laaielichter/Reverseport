import type { ProgressReporter } from "../application/ProgressReporter.js";
import type {
  CaptureWebScreenshotInput,
  WebElement,
  WebScreenshot,
} from "../domain/webScreenshot.js";
import {
  createWebScreenshotArtifact,
  WEB_ELEMENT_HTML_LIMIT,
  WEB_ELEMENT_STYLE_LIMIT,
} from "../domain/webScreenshot.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { isMainFrameNavigation } from "./CdpCaptureEventHelpers.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";
import type { CdpConnection, CdpEvent } from "./CdpConnection.js";
import {
  allowedSanitizedUrl,
  recordValue,
  recordsValue,
  cdpStringValue,
  numberValue,
} from "./CdpCaptureValues.js";
import { mainFrameUrl } from "./CdpCaptureDocuments.js";
import { captureFrames } from "./CdpCaptureDocuments.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { decodeCanonicalBase64 } from "../domain/webScreenshot.js";

interface ScreenshotContext {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly discovery: CdpEndpointDiscovery;
  readonly target: CdpEndpointTarget;
  readonly input: CaptureWebScreenshotInput;
  readonly signal?: AbortSignal;
  readonly progress?: ProgressReporter;
}

/** Capture the current viewport without navigation, evaluation, or page mutation. */
export const captureCdpScreenshot = async (
  context: ScreenshotContext,
): Promise<WebScreenshot> => {
  const origins = new Set(context.input.allowed_origins);
  await context.progress?.report({
    phase: "browser_observation",
    completed: 1,
    total: 2,
    message: "Authorizing current screenshot frame",
  });
  await context.connection.send(
    "Page.enable",
    {},
    context.sessionId,
    context.signal,
  );
  const before = await context.connection.send(
    "Page.getFrameTree",
    {},
    context.sessionId,
    context.signal,
  );
  const beforeUrl = mainFrameUrl(before);
  const authorized = allowedSanitizedUrl(beforeUrl, origins);
  const mainFrame = captureFrames(before, origins, 1).items[0];
  if (authorized === undefined || mainFrame === undefined)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  const initialFrame = recordValue(
    recordValue(recordValue(before)?.frameTree)?.frame,
  );
  const navigation = {
    changed: false,
    leftScope: false,
    url: beforeUrl,
    loaderId: cdpStringValue(initialFrame?.loaderId),
  };
  const removeListener = context.connection.onEvent((event) => {
    if (event.sessionId !== context.sessionId) return;
    observeScreenshotNavigation(event, mainFrame.frame_id, origins, navigation);
  });
  let result: ReturnType<typeof recordValue>;
  let after: unknown;
  let element: ElementProbe | undefined;
  try {
    if (context.input.selector !== undefined)
      element = await probeElement(context, context.input.selector);
    result = recordValue(
      await context.connection.send(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          ...(element === undefined ? {} : { clip: element.clip }),
        },
        context.sessionId,
        context.signal,
      ),
    );
    after = await context.connection.send(
      "Page.getFrameTree",
      {},
      context.sessionId,
      context.signal,
    );
  } finally {
    removeListener();
    if (context.input.selector !== undefined) await releaseDomains(context);
  }
  const encoded = cdpStringValue(result?.data);
  const bytes =
    encoded === undefined ? undefined : decodeCanonicalBase64(encoded);
  if (bytes === undefined)
    throw new BrowserObservationError("inspect_web_page", "payload_limit");
  const dimensions = pngDimensions(bytes);
  if (navigation.leftScope)
    throw new BrowserObservationError("inspect_web_page", "target_not_allowed");
  const afterUrl = mainFrameUrl(after);
  if (
    navigation.changed ||
    afterUrl !== beforeUrl ||
    allowedSanitizedUrl(afterUrl, origins) === undefined
  )
    throw new BrowserObservationError("inspect_web_page", "target_changed");
  await context.progress?.report({
    phase: "browser_observation",
    completed: 2,
    total: 2,
    message: "Screenshot capture complete",
    terminal: true,
  });
  return {
    browser: context.discovery.version,
    target: {
      target_id: context.target.id,
      url: authorized.url,
      origin: authorized.origin ?? "",
    },
    captured_at: new Date().toISOString(),
    viewport: element === undefined ? dimensions : element.viewport,
    artifact: createWebScreenshotArtifact(bytes),
    ...(element === undefined
      ? {}
      : { element: { ...element.element, image: dimensions } }),
    completeness: new CdpCaptureCompleteness().snapshot(),
    limitations: [
      ...(element === undefined
        ? [
            "The screenshot contains the visible viewport, including on-screen content.",
          ]
        : [
            "The image shows only the part of the element inside the viewport; scroll it into view in the browser for the rest.",
            "outer_html is the element's markup as the page has it now, including attribute values.",
          ]),
      "REA does not scroll, evaluate JavaScript, or capture beyond the current viewport.",
    ],
  };
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ElementProbe {
  readonly clip: Box & { readonly scale: 1 };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly element: Omit<WebElement, "image">;
}

/** Find one element and read its box, markup and style via DOM and CSS. */
const probeElement = async (
  context: ScreenshotContext,
  selector: string,
): Promise<ElementProbe> => {
  const send = (
    method: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> =>
    context.connection.send(method, params, context.sessionId, context.signal);
  const notFound = (detail: string) =>
    new BrowserObservationError("capture_web_screenshot", "target_not_found", {
      detail,
    });
  const quoted = JSON.stringify(selector);
  await send("DOM.enable");
  await send("CSS.enable");
  const tree = recordValue(await send("DOM.getDocument", { depth: 0 }));
  const root = numberValue(recordValue(tree?.root)?.nodeId);
  if (root === undefined)
    throw new BrowserObservationError(
      "capture_web_screenshot",
      "protocol_error",
    );
  const match = recordValue(
    await send("DOM.querySelector", { nodeId: root, selector }),
  );
  const nodeId = numberValue(match?.nodeId);
  if (nodeId === undefined || nodeId === 0)
    throw notFound(`No element matches the selector ${quoted} on this page.`);
  const model = recordValue(
    recordValue(await send("DOM.getBoxModel", { nodeId }))?.model,
  );
  const box = quadBox(model?.border);
  const metrics = recordValue(await send("Page.getLayoutMetrics"));
  const layout = recordValue(metrics?.cssLayoutViewport);
  const viewportWidth = numberValue(layout?.clientWidth);
  const viewportHeight = numberValue(layout?.clientHeight);
  if (
    box === undefined ||
    viewportWidth === undefined ||
    viewportHeight === undefined
  )
    throw notFound(`The element for ${quoted} is not rendered.`);
  const visible = intersect(box, {
    x: 0,
    y: 0,
    width: viewportWidth,
    height: viewportHeight,
  });
  if (visible === undefined)
    throw notFound(
      `The element for ${quoted} is outside the visible viewport. Scroll it into view in the browser, then capture again.`,
    );
  const markup = recordValue(await send("DOM.getOuterHTML", { nodeId }));
  const html = cdpStringValue(markup?.outerHTML) ?? "";
  const computed = recordValue(
    await send("CSS.getComputedStyleForNode", { nodeId }),
  );
  const properties = recordsValue(computed?.computedStyle);
  const style: Record<string, string> = {};
  for (const property of properties.slice(0, WEB_ELEMENT_STYLE_LIMIT)) {
    const name = cdpStringValue(property.name);
    const value = cdpStringValue(property.value);
    if (name !== undefined && value !== undefined) style[name] = value;
  }
  return {
    clip: {
      x: visible.x + (numberValue(layout?.pageX) ?? 0),
      y: visible.y + (numberValue(layout?.pageY) ?? 0),
      width: visible.width,
      height: visible.height,
      scale: 1,
    },
    viewport: {
      width: Math.max(1, Math.round(viewportWidth)),
      height: Math.max(1, Math.round(viewportHeight)),
    },
    element: {
      selector,
      box,
      visible_box: visible,
      clipped: visible.width < box.width || visible.height < box.height,
      outer_html: html.slice(0, WEB_ELEMENT_HTML_LIMIT),
      outer_html_truncated: html.length > WEB_ELEMENT_HTML_LIMIT,
      computed_style: style,
      computed_style_truncated: properties.length > WEB_ELEMENT_STYLE_LIMIT,
    },
  };
};

/** Bounding box of a CDP quad (x1, y1, … x4, y4). */
const quadBox = (quad: unknown): Box | undefined => {
  if (!Array.isArray(quad)) return undefined;
  const numbers = quad.flatMap((item) => {
    const value = numberValue(item);
    return value === undefined ? [] : [value];
  });
  if (numbers.length !== 8) return undefined;
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
};

const intersect = (a: Box, b: Box): Box | undefined => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - x >= 1 && bottom - y >= 1
    ? { x, y, width: right - x, height: bottom - y }
    : undefined;
};

/** Turn off the DOM and CSS domains this capture enabled; the session close handles the rest. */
const releaseDomains = async (context: ScreenshotContext): Promise<void> => {
  for (const method of ["CSS.disable", "DOM.disable"]) {
    try {
      await context.connection.send(method, {}, context.sessionId);
    } catch {
      // Closing the target session below also ends these domains.
    }
  }
};

const observeScreenshotNavigation = (
  event: CdpEvent,
  mainFrameId: string,
  origins: ReadonlySet<string>,
  state: {
    changed: boolean;
    leftScope: boolean;
    readonly url: string | undefined;
    readonly loaderId: string | undefined;
  },
): void => {
  if (!isMainFrameNavigation(event, mainFrameId)) return;
  const params = recordValue(event.params);
  if (params === undefined) return;
  const frame =
    event.method === "Page.frameNavigated" ? recordValue(params.frame) : params;
  if (
    event.method === "Page.frameNavigated" &&
    state.loaderId !== undefined &&
    state.loaderId !== "" &&
    cdpStringValue(frame?.loaderId) === state.loaderId &&
    cdpStringValue(frame?.url) === state.url
  )
    return;

  state.changed = true;
  if (allowedSanitizedUrl(frame?.url, origins) === undefined)
    state.leftScope = true;
};

const pngDimensions = (
  bytes: Buffer,
): { readonly width: number; readonly height: number } => {
  if (
    bytes.byteLength < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  return { width, height };
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
