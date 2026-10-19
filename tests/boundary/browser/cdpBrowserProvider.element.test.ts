import { describe, expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { captureWebScreenshotInputSchema } from "../../../src/domain/webScreenshot.js";
import type { FakeCdpCommand } from "../../fixtures/fakeCdpBrowserTypes.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

/** A 120×40 button, 50px below the top of a viewport scrolled 650px down. */
const elementReplies = (
  command: FakeCdpCommand,
): Readonly<Record<string, unknown>> | undefined => {
  switch (command.method) {
    case "CSS.enable":
    case "CSS.disable":
      return {};
    case "DOM.getDocument":
      return { root: { nodeId: 1 } };
    case "DOM.querySelector":
      return { nodeId: command.params.selector === "#buy" ? 7 : 0 };
    case "DOM.getBoxModel":
      return { model: { border: [30, 50, 150, 50, 150, 90, 30, 90] } };
    case "Page.getLayoutMetrics":
      return {
        cssLayoutViewport: {
          pageX: 0,
          pageY: 650,
          clientWidth: 800,
          clientHeight: 600,
        },
      };
    case "DOM.getOuterHTML":
      return { outerHTML: '<button id="buy">Buy</button>' };
    case "CSS.getComputedStyleForNode":
      return {
        computedStyle: [
          { name: "background-color", value: "rgb(255, 0, 0)" },
          { name: "width", value: "120px" },
        ],
      };
    default:
      return undefined;
  }
};

const capture = async (selector: string) => {
  const browser = await startFakeCdpBrowser({ commandResult: elementReplies });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().captureScreenshot(
    captureWebScreenshotInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      selector,
    }),
  );
  return { browser, result };
};

describe("CdpBrowserProvider: element capture", () => {
  it("crops to one element and returns its box, markup and style", async () => {
    const { browser, result } = await capture("#buy");

    if (!result.ok) throw result.error;
    expect(result.value.viewport).toEqual({ width: 800, height: 600 });
    expect(result.value.element).toMatchObject({
      selector: "#buy",
      box: { x: 30, y: 50, width: 120, height: 40 },
      visible_box: { x: 30, y: 50, width: 120, height: 40 },
      clipped: false,
      outer_html: '<button id="buy">Buy</button>',
      outer_html_truncated: false,
      computed_style: {
        "background-color": "rgb(255, 0, 0)",
        width: "120px",
      },
      computed_style_truncated: false,
    });
    const shot = browser.commands.find(
      ({ method }) => method === "Page.captureScreenshot",
    );
    expect(shot?.params.clip).toEqual({
      x: 30,
      y: 700,
      width: 120,
      height: 40,
      scale: 1,
    });
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).toEqual(
      expect.arrayContaining(["CSS.disable", "DOM.disable"]),
    );
    expect(methods).not.toContain("Runtime.evaluate");
  });

  it("names the selector when no element matches", async () => {
    const { browser, result } = await capture("#missing");

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        operation: "capture_web_screenshot",
        reason: "target_not_found",
      },
    });
    if (!result.ok) expect(result.error.userMessage).toContain("#missing");
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Page.captureScreenshot",
    );
  });

  it("keeps the plain viewport screenshot unchanged without a selector", async () => {
    const browser = await startFakeCdpBrowser();
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().captureScreenshot(
      captureWebScreenshotInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.element).toBeUndefined();
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "DOM.getDocument",
    );
  });
});
