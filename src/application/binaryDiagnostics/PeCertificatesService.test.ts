import { expect, it } from "vitest";
import { PeCertificatesService } from "./PeCertificatesService.js";
import { PE_CERTIFICATES_PROVIDER } from "../../domain/investigationProviders.js";
import type { PeCertificates } from "../../domain/native/peCertificates.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";

const identity = PE_CERTIFICATES_PROVIDER;
const report: PeCertificates = {
  artifact: {
    path: "/artifacts/app.exe",
    sha256: "a".repeat(64),
    bytes: 512,
  },
  format: "pe32",
  machine: 0x14c,
  table: null,
  entries: [],
  coverage: { status: "complete", examined_entries: 0, certificates: 0 },
  limitations: ["IMAGE_DIRECTORY_ENTRY_SECURITY is absent."],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new PeCertificatesService({
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "app.exe" });
  const extra = await service.inspect({
    path: report.artifact.path,
    extra: true,
  });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  if (!relative.ok) expect(relative.error).toBeInstanceOf(AnalysisInputError);
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it("records the selected PE and an absent certificate table", async () => {
  const result = await new PeCertificatesService({
    identity,
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    confidence: "observed",
    subject: { format: "pe", architecture: "x86" },
    normalized_result: report,
  });
});

it("discards an observation if the caller cancels while the provider completes", async () => {
  const controller = new AbortController();
  const service = new PeCertificatesService({
    identity,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report));
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisCancelledError);
});
