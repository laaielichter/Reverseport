import { expect, it } from "vitest";

import { BROWSER_TOOL_CONTRACTS } from "../../../src/contracts/browserToolContracts.js";
import { comparePngScreenshots } from "../../../src/browser/PngVisualDiff.js";
import { compareWebScreenshotsInputSchema } from "../../../src/domain/webScreenshot.js";

it("executes the advertised screenshot comparison example through PNG checksum validation", () => {
  const contract = BROWSER_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_web_screenshots",
  );
  const input = compareWebScreenshotsInputSchema.parse(
    contract?.examples[0]?.input,
  );
  expect(comparePngScreenshots(input)).toMatchObject({
    status: "identical",
    compared_pixels: 1,
    changed_pixels: 0,
  });
});
