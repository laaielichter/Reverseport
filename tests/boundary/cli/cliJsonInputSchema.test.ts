import { describe, expect, it } from "vitest";
import { z } from "incur";

import { createCli } from "../../../src/cli.js";

const serve = async (argv: readonly string[]) => {
  let stdout = "";
  let exitCode = 0;
  await createCli({}).serve([...argv], {
    env: {},
    exit: (code) => {
      exitCode = code;
    },
    stdout: (text) => {
      stdout += text;
    },
  });
  return { stdout, exitCode };
};

const jsonArgument = z.object({
  args: z.object({
    properties: z.object({
      inputJson: z
        .object({
          type: z.literal("string"),
          contentMediaType: z.literal("application/json"),
          contentSchema: z
            .object({
              type: z.literal("object"),
              properties: z.record(z.string(), z.unknown()),
            })
            .loose(),
        })
        .loose(),
    }),
  }),
});

// Upstream REA #9195: `--schema` on a JSON-input command showed only the
// string wrapper, so callers had to guess the payload's fields.
describe("JSON-input CLI commands advertise their payload", () => {
  it.each([
    ["trace-application-feature", "application"],
    ["trace-javascript-semantics", "application"],
    ["compare-application-versions", "left_native_observations"],
    ["compare-javascript-export-shapes", "left_module_path"],
    ["compare-source-to-bundle", "application"],
  ])(
    "%s publishes its request schema as JSON content",
    async (command, field) => {
      const result = await serve([command, "--schema", "--json"]);
      expect(result.exitCode, result.stdout).toBe(0);
      const advertised = jsonArgument.parse(JSON.parse(result.stdout));
      const payload = advertised.args.properties.inputJson.contentSchema;
      expect(Object.keys(payload.properties)).toContain(field);
    },
  );
});
