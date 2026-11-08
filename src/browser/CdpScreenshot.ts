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
  decodeCanonicalBase64,
} from "../domain/webScreenshot.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { cdpOriginScopeRefusal } from "./CdpOriginScopeError.js";
import {
  selectCdpFrameIdentity,
  cdpFrameRecordFacts,
  cdpFrameEventFacts,
} from "./CdpFrameIdentity.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";
import type { CdpConnection, CdpEvent } from "./CdpConnection.js";
import {
  recordValue,
  recordsValue,
  cdpStringValue,
  numberValue,
} from "./CdpCaptureValues.js";
import {
  observeCdpFrameUrl,
  observeMainFrameUrl,
  classifyCdpFrameUrl,
} from "./CdpCaptureDocuments.js";

import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { readPngHeaderDimensions } from "../domain/pngHeader.js";

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
  const initialFrame = recordValue(
    recordValue(recordValue(before)?.frameTree)?.frame,
  );
  const beforeObservation = observeCdpFrameUrl(initialFrame);
  const beforeFacts = classifyCdpFrameUrl(beforeObservation, origins);
  if (
    beforeFacts.scope === "outside_policy" ||
    beforeFacts.scope === "unsupported"
  )
    throw cdpOriginScopeRefusal("capture_web_screenshot");
  if (beforeObservation.kind !== "observed")
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  const beforeUrl = beforeFacts.url;
  const mainFrame = cdpFrameRecordFacts(initialFrame);
  if (
    beforeUrl === undefined ||
    beforeFacts.origin === null ||
    mainFrame.frameId === null ||
    mainFrame.identityIssue !== null ||
    mainFrame.parentRelation !== "root"
  )
    throw new BrowserObservationError(
      "capture_web_screenshot",
      "protocol_error",
    );
  const navigation = {
    changed: false,
    leftScope: false,
    invalidIdentity: false,
    frameId: mainFrame.frameId,
    url: beforeUrl,
    loaderId: mainFrame.loaderId,
    completeness: new CdpCaptureCompleteness(),
  };
  const removeListener = context.connection.onEvent((event) => {
    if (event.sessionId !== context.sessionId) return;
    observeScreenshotNavigation(event, origins, navigation);
  });
  const assertCurrentDocument = () => {
    if (navigation.leftScope)
      throw cdpOriginScopeRefusal("capture_web_screenshot");
    if (navigation.invalidIdentity)
      throw new BrowserObservationError("inspect_web_page", "protocol_error");
    if (navigation.changed)
      throw new BrowserObservationError("inspect_web_page", "target_changed");
  };
  let screenshot: Awaited<ReturnType<typeof captureScreenshotImage>>;
  let after: unknown;
  let element: ElementProbe | undefined;
  try {
    if (context.input.selector !== undefined) {
      element = await probeElement(context, context.input.selector);
      assertCurrentDocument();
      screenshot = await captureScreenshotImage(context, element.clip);
      assertCurrentDocument();
    } else {
      const viewport = await readScreenshotViewport(context);
      assertCurrentDocument();
      screenshot = await captureScreenshotImage(context);
      assertCurrentDocument();
      const currentViewport = await readScreenshotViewport(context);
      assertCurrentDocument();
      assertSameViewport(viewport, currentViewport);
      if (!coversViewport(screenshot, currentViewport)) {
        // Refresh geometry before clipping, and reject a moving viewport rather
        // than capture a region that is no longer visible.
        screenshot = await captureScreenshotImage(
          context,
          currentViewport.clip,
        );
        assertCurrentDocument();
        const recoveredViewport = await readScreenshotViewport(context);
        assertCurrentDocument();
        assertSameViewport(currentViewport, recoveredViewport);
        if (!coversViewport(screenshot, recoveredViewport))
          throw new BrowserObservationError(
            "inspect_web_page",
            "protocol_error",
            {
              detail:
                "The screenshot does not cover the reported visual viewport.",
            },
          );
      }
    }
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
  assertCurrentDocument();
  if (navigation.leftScope)
    throw cdpOriginScopeRefusal("capture_web_screenshot");
  const afterObservation = observeMainFrameUrl(after);
  const afterFacts = classifyCdpFrameUrl(afterObservation, origins);
  if (
    afterFacts.scope === "outside_policy" ||
    afterFacts.scope === "unsupported"
  )
    throw cdpOriginScopeRefusal("capture_web_screenshot");
  if (navigation.invalidIdentity || afterObservation.kind !== "observed")
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  const afterUrl = afterFacts.url;
  if (navigation.changed || afterUrl !== beforeUrl || afterUrl === undefined)
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
      url: beforeUrl,
      origin: beforeFacts.origin,
    },
    captured_at: new Date().toISOString(),
    viewport: element === undefined ? screenshot.dimensions : element.viewport,
    artifact: createWebScreenshotArtifact(screenshot.bytes),
    ...(element === undefined
      ? {}
      : { element: { ...element.element, image: screenshot.dimensions } }),
    completeness: navigation.completeness.snapshot(),
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

/** Parse CSS clip geometry and device-pixel coverage at their owning boundary. */
const readScreenshotViewport = async (context: ScreenshotContext) => {
  const metrics = recordValue(
    await context.connection.send(
      "Page.getLayoutMetrics",
      {},
      context.sessionId,
      context.signal,
    ),
  );
  const visualViewport = recordValue(metrics?.visualViewport);
  const cssViewport = recordValue(metrics?.cssVisualViewport);
  const pageX = numberValue(cssViewport?.pageX);
  const pageY = numberValue(cssViewport?.pageY);
  const width = numberValue(cssViewport?.clientWidth);
  const height = numberValue(cssViewport?.clientHeight);
  const scale = numberValue(cssViewport?.scale);
  const pixelWidth = numberValue(visualViewport?.clientWidth);
  const pixelHeight = numberValue(visualViewport?.clientHeight);
  const pixelScale = numberValue(visualViewport?.scale);
  if (
    pageX === undefined ||
    pageY === undefined ||
    width === undefined ||
    height === undefined ||
    scale === undefined ||
    pixelWidth === undefined ||
    pixelHeight === undefined ||
    pixelScale !== scale ||
    width <= 0 ||
    height <= 0 ||
    scale <= 0 ||
    pixelWidth <= 0 ||
    pixelHeight <= 0
  )
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  // Keep ordinary surface captures, including their scrollbars and pixel
  // density. The visual viewport excludes scrollbars and supplies only a
  // lower bound on the expected image size, allowing subpixel rounding.
  const minimumWidth = Math.max(1, Math.floor(pixelWidth * scale));
  const minimumHeight = Math.max(1, Math.floor(pixelHeight * scale));
  if (
    !Number.isSafeInteger(minimumWidth) ||
    !Number.isSafeInteger(minimumHeight)
  )
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  return {
    clip: { x: pageX, y: pageY, width, height, scale },
    pixelWidth,
    pixelHeight,
    minimumWidth,
    minimumHeight,
  };
};

type ScreenshotViewport = Awaited<ReturnType<typeof readScreenshotViewport>>;

const coversViewport = (
  image: Awaited<ReturnType<typeof captureScreenshotImage>>,
  viewport: ScreenshotViewport,
) =>
  image.dimensions.width >= viewport.minimumWidth &&
  image.dimensions.height >= viewport.minimumHeight;

const assertSameViewport = (
  before: ScreenshotViewport,
  after: ScreenshotViewport,
): void => {
  if (
    before.clip.x !== after.clip.x ||
    before.clip.y !== after.clip.y ||
    before.clip.width !== after.clip.width ||
    before.clip.height !== after.clip.height ||
    before.clip.scale !== after.clip.scale ||
    before.pixelWidth !== after.pixelWidth ||
    before.pixelHeight !== after.pixelHeight
  )
    throw new BrowserObservationError("inspect_web_page", "target_changed", {
      detail: "The visual viewport changed during screenshot capture.",
    });
};

interface ScreenshotClip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/** Decode every capture at the same boundary, including a clipped recovery. */
const captureScreenshotImage = async (
  context: ScreenshotContext,
  clip?: ScreenshotClip,
) => {
  const result = recordValue(
    await context.connection.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: clip !== undefined,
        ...(clip === undefined ? {} : { clip }),
      },
      context.sessionId,
      context.signal,
    ),
  );
  const screenshot = decodeScreenshot(result);
  if (screenshot === undefined)
    throw new BrowserObservationError("inspect_web_page", "protocol_error");
  return screenshot;
};

const decodeScreenshot = (
  result: ReturnType<typeof recordValue>,
):
  | {
      readonly bytes: Buffer;
      readonly dimensions: { width: number; height: number };
    }
  | undefined => {
  const encoded = cdpStringValue(result?.data);
  const bytes =
    encoded === undefined ? undefined : decodeCanonicalBase64(encoded);
  if (bytes === undefined) return undefined;
  const dimensions = readPngHeaderDimensions(bytes);
  return dimensions === undefined ? undefined : { bytes, dimensions };
};

const observeScreenshotNavigation = (
  event: CdpEvent,
  origins: ReadonlySet<string>,
  state: {
    changed: boolean;
    leftScope: boolean;
    invalidIdentity: boolean;
    frameId: string;
    url: string | undefined;
    loaderId: string | undefined;
    readonly completeness: CdpCaptureCompleteness;
  },
): void => {
  const frameFacts = cdpFrameEventFacts(event);
  const identity = selectCdpFrameIdentity(frameFacts, state.frameId);
  if (identity.applicability === "not_applicable") return;
  if (identity.identityIssue !== null || identity.parentIssue !== null) {
    state.completeness.exclude("screenshot", "invalid_protocol_value");
    if (
      identity.selection === "unknown" &&
      identity.parentRelation === "child" &&
      identity.identityIssue !== null
    )
      return;
    state.invalidIdentity = true;
    return;
  }
  if (identity.selection === "unknown") {
    if (identity.parentRelation === "child") return;
    state.completeness.exclude("screenshot", "invalid_protocol_value");
    state.invalidIdentity = true;
    return;
  }
  if (identity.selection === "other" && !identity.isRootReplacement) return;
  // A requested navigation does not establish a committed document change.
  // The frame-tree read after capture still verifies the selected URL.
  if (event.method === "Page.frameRequestedNavigation") return;
  const observed = observeCdpFrameUrl(frameFacts.source);
  const facts = classifyCdpFrameUrl(observed, origins);
  const frameUrl = facts.url;
  if (
    event.method === "Page.navigatedWithinDocument" &&
    state.loaderId !== undefined &&
    state.loaderId !== "" &&
    frameUrl === state.url
  )
    return;
  if (
    event.method === "Page.frameNavigated" &&
    !identity.isRootReplacement &&
    state.loaderId !== undefined &&
    state.loaderId !== "" &&
    frameFacts.loaderId === state.loaderId &&
    frameUrl === state.url
  )
    return;

  state.changed = true;
  if (facts.scope === "outside_policy" || facts.scope === "unsupported")
    state.leftScope = true;
  if (observed.kind !== "observed") state.invalidIdentity = true;
  if (event.method === "Page.frameNavigated") {
    if (identity.isRootReplacement)
      state.frameId = identity.frameId ?? state.frameId;
    state.url = frameUrl ?? state.url;
    state.loaderId = frameFacts.loaderId;
  } else if (event.method === "Page.navigatedWithinDocument") {
    state.url = frameUrl ?? state.url;
  }
};
