import { expect, it } from "vitest";
import { z } from "zod";

import { publicInputStrictObject } from "./publicInput.js";

it("rejects unknown keys on a public tool input", () => {
  const schema = publicInputStrictObject({
    path: z.string(),
    block_size: z.number().default(4096),
  });
  expect(schema.parse({ path: "/file" })).toEqual({
    path: "/file",
    block_size: 4096,
  });
  expect(schema.safeParse({ path: "/file", extra: true }).success).toBe(false);
});
