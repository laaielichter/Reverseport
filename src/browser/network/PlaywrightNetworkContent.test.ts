import { expect, it } from "vitest";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../../tests/fixtures/browserScenarioSecrets.js";
import {
  captureNetworkBody,
  captureNetworkHeaders,
} from "./PlaywrightNetworkContent.js";

const scenario = browserScenarioSchema.parse({
  browser: { mode: "launch", executable_path: "/fixture/chrome" },
  start_url: { url: "https://example.test" },
  actions: [{ step_id: "done", action: "wait_for_timeout", duration_ms: 1 }],
  secrets: [{ secret_id: "declared", environment_variable: "SECRET" }],
});
const secrets = resolveScenarioSecrets(scenario, { SECRET: "x" });
const options = {
  timeoutMs: 100,
  maxBodyBytes: 4,
  maxBodyAllocationBytes: 1024 * 1024,
  maxHeaderAllocationBytes: 16384,
  maxMetadataAllocationBytes: 4096,
};
const source = {
  headers: () => ({ "content-type": "text/plain" }),
  headersArray: async () => [],
};

it("enforces the retained body byte limit after secret expansion", async () => {
  expect(
    await captureNetworkBody(
      async () => Buffer.from("xxxx"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "unavailable",
    reason: "body-size-limit",
    limit_bytes: 4,
  });
  expect(
    await captureNetworkBody(
      async () => Buffer.from("safe"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "captured",
    bytes: 4,
    content: Buffer.from("safe").toString("base64"),
  });
});

it("charges discarded credential header values only for their retained projection", async () => {
  const read = async (name: string) =>
    captureNetworkHeaders(
      {
        headers: () => ({}),
        headersArray: async () => [
          { name, value: "v".repeat(50_000) },
          { name: "X-Observed", value: "ordinary" },
        ],
      },
      secrets,
      options,
    );
  expect(await read("Cookie")).toMatchObject({
    state: "captured",
    items: [
      { name: "Cookie", value: null, redacted: true },
      { name: "X-Observed", value: "ordinary", redacted: false },
    ],
  });
  expect(await read("X-Retained")).toMatchObject({ state: "unavailable" });
});
