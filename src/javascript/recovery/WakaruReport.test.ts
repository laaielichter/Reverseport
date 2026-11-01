import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { parseWakaruReports } from "./WakaruReport.js";
import { RECOVERY_LIMITS } from "./WakaruRelease.js";

const reportStdout = JSON.stringify({
  detected_formats: ["unknown"],
  safety: "safe",
  modules: [],
  warnings: [],
  total: 0,
  failed: 0,
  elapsed_ms: 1,
});

const execution = {
  exit_code: 0,
  signal: null,
  stdout: reportStdout,
  stderr: "",
  command: "/selected/wakaru",
  arguments: ["--json"],
  resource_limiter: "/usr/bin/prlimit",
};

it("names the fixed report allowance when provenance.json exceeds 8 MiB", async () => {
  const root = await createTestTempDirectory("rea-wakaru-provenance-size-");
  const provenancePath = join(root, "provenance.json");
  await writeFile(provenancePath, "");
  await truncate(provenancePath, RECOVERY_LIMITS.reportBytes + 1);
  const refusal: unknown = await parseWakaruReports({
    execution,
    provenancePath,
    snapshots: new Map(),
    files: [],
  }).catch((cause: unknown) => cause);
  if (!(refusal instanceof ProviderAdapterError))
    throw new Error("Expected a wrapped Wakaru report refusal");
  const projected = projectAnalysisError(refusal);
  expect(projected.message).toContain(String(RECOVERY_LIMITS.reportBytes));
  expect(projected.message).toContain("no runtime override");
  expect(projected.remediation.action).toContain("no runtime override");
  expect(projected.remediation.action).toContain("max_heap_mb");
  expect(projected.remediation.action).toContain("analysis_timeout_ms");
  expect(projected.remediation.action).toContain(
    "Repeating the unchanged request fails the same way",
  );
});

it("keeps a malformed provenance report distinct from the fixed report allowance", async () => {
  const root = await createTestTempDirectory(
    "rea-wakaru-provenance-malformed-",
  );
  const provenancePath = join(root, "provenance.json");
  await writeFile(provenancePath, "{");
  const refusal: unknown = await parseWakaruReports({
    execution,
    provenancePath,
    snapshots: new Map(),
    files: [],
  }).catch((cause: unknown) => cause);
  if (!(refusal instanceof ProviderAdapterError))
    throw new Error("Expected a wrapped Wakaru report refusal");
  const projected = projectAnalysisError(refusal);
  expect(projected.message).toBe(
    "Analysis could not complete. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.",
  );
  expect(projected.remediation.action).toBe(projected.message);
  expect(JSON.stringify(projected)).not.toContain("report allowance");
  expect(JSON.stringify(projected)).not.toContain("no runtime override");
});
