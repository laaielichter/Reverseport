import { describe, expect, it } from "vitest";
import { z } from "incur";

import { createCli } from "../../../src/cli.js";
import {
  FREE_FORM_JSON_CONTENT,
  cliJsonInputArgument,
} from "../../../src/cliJsonInput.js";

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

const jsonContent = z
  .object({
    type: z.literal("string"),
    contentMediaType: z.literal("application/json"),
    contentSchema: z.record(z.string(), z.unknown()),
  })
  .loose();

const advertisedSchema = z.object({
  args: z.object({ properties: z.record(z.string(), z.unknown()) }),
  options: z
    .object({ properties: z.record(z.string(), z.unknown()) })
    .optional(),
});

const objectProperties = z.object({
  properties: z.record(z.string(), z.unknown()),
});

/** Top-level fields of a JSON Schema object, or of each union alternative. */
const payloadFields = (schema: Record<string, unknown>): readonly string[] => {
  const alternatives = z
    .array(z.record(z.string(), z.unknown()))
    .safeParse(schema.anyOf ?? schema.oneOf);
  if (alternatives.success) return alternatives.data.flatMap(payloadFields);
  const object = objectProperties.safeParse(schema);
  return object.success ? Object.keys(object.data.properties) : [];
};

// The REA #9195 follow-up: analysis-view, the managed workflows and the other
// JSON-input commands validated a typed request but advertised a bare string.
describe("every JSON-input CLI argument advertises its payload", () => {
  it.each([
    ["inspect-analysis-view", "args", "inputJson", "view"],
    ["inspect-evidence-bundle", "args", "inputJson", "path"],
    [
      "verify-managed-native-boundaries",
      "args",
      "inputJson",
      "managed_boundaries",
    ],
    ["import-managed-reconstruction", "args", "inputJson", "static_members"],
    [
      "project-managed-application-graph",
      "args",
      "inputJson",
      "managed_members",
    ],
    ["compare-artifacts", "args", "inputJson", "left"],
    ["compare-wasm-interfaces", "args", "input", "scope"],
    ["match-native-functions", "args", "input", "left"],
    ["compare-static-and-observed-endpoints", "args", "inputJson", "capture"],
    ["capture-browser-scenario", "args", "inputJson", "actions"],
    ["validate-browser-scenario", "args", "inputJson", "actions"],
    [
      "reconcile-javascript-runtime",
      "args",
      "inputJson",
      "runtime_observations",
    ],
    [
      "project-android-application-graph",
      "args",
      "inputJson",
      "inventory_evidence",
    ],
    [
      "project-apple-application-graph",
      "args",
      "inputJson",
      "inventory_evidence",
    ],
    [
      "project-harmony-application-graph",
      "args",
      "inputJson",
      "inventory_evidence",
    ],
    ["compare-web-screenshots", "args", "beforeJson", "sha256"],
    ["compare-web-screenshots", "args", "afterJson", "sha256"],
    ["compare-web-captures", "args", "beforeJson", "inspection"],
    ["compare-web-captures", "args", "afterJson", "scenario"],
    ["compare-web-captures", "options", "normalizationJson", "rules"],
  ] as const)(
    "%s %s.%s publishes field %s",
    async (command, section, argument, field) => {
      const result = await serve([command, "--schema", "--json"]);
      expect(result.exitCode, result.stdout).toBe(0);
      const advertised = advertisedSchema.parse(JSON.parse(result.stdout));
      const content = jsonContent.parse(
        advertised[section]?.properties[argument],
      );
      expect(content.contentSchema).not.toEqual(FREE_FORM_JSON_CONTENT);
      expect(payloadFields(content.contentSchema)).toContain(field);
    },
  );

  it("says a JSON argument without a typed request schema takes free-form JSON", () => {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(
      cliJsonInputArgument("Inline JSON or JSON file path"),
    );
    expect(schema).toEqual({
      type: "string",
      description: "Inline JSON or JSON file path",
      contentMediaType: "application/json",
      contentSchema: {
        description: expect.stringMatching(/^Free-form JSON: /u),
      },
    });
  });
});
