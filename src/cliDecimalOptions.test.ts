import { z } from "incur";
import { expect, it } from "vitest";
import { cliDecimalField } from "./cli/options.js";

const rowLimit = cliDecimalField(z.number().int().min(1).max(1000).optional());

// Upstream REA #9221: hex and exponent spellings are refused before coercion.
// The refusal names the accepted spelling instead of a bare union failure.
it.each(["0x10", "1e1", "+16", "16.0", " 16"])(
  "explains how to spell a decimal integer token (%j)",
  (token) => {
    const parsed = rowLimit.safeParse(token);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "Expected a decimal integer: digits only, without a sign, 0x prefix, exponent or fraction",
    );
  },
);

it("reports the domain bound for a decimal token outside it", () => {
  const parsed = rowLimit.safeParse("0");
  expect(parsed.success).toBe(false);
  expect(parsed.error?.issues[0]?.message).toMatch(/>=\s*1/u);
});

it("keeps decimal tokens, leading zeros and JSON numbers", () => {
  expect(rowLimit.parse("020")).toBe(20);
  expect(rowLimit.parse(16)).toBe(16);
  expect(rowLimit.parse(undefined)).toBeUndefined();
});
