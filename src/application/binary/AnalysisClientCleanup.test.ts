import { expect, it } from "vitest";

import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../../domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err } from "../../domain/result.js";
import type { AnalysisClient } from "../AnalysisProvider.js";
import { closeAnalysisClient } from "../../providers/AnalysisClientCleanup.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";

const clientClosingWith = (cause: unknown): AnalysisClient => ({
  execute: () => Promise.resolve(err(new ProviderCleanupError("x", [], {}))),
  close: () => Promise.reject(cause),
});

it("keeps the leftover resources a typed cleanup failure names", async () => {
  const leftover = "/tmp/rea-ghidra-fixture";
  const failure = new ProviderCleanupError("ghidra", [leftover], {
    reason: "runtime directory retained",
  });

  const closed = await closeAnalysisClient(
    clientClosingWith(failure),
    "ghidra",
  );

  expect(closed.ok).toBe(false);
  if (!closed.ok)
    expect(projectAnalysisError(closed.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: [leftover] },
    });
});

it("still reports an untyped close rejection as the provider client", async () => {
  const closed = await closeAnalysisClient(
    clientClosingWith(new Error("unexpected")),
    "ghidra",
  );

  expect(closed.ok).toBe(false);
  if (!closed.ok)
    expect(projectAnalysisError(closed.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: ["provider-client"] },
    });
});

it("preserves the original explanation and collected output alongside cleanup uncertainty", () => {
  const primary = new ProviderAdapterError("fixture", "capture", {
    userMessage: "Select the running target process and retry the capture.",
    capturedOutput: {
      stdout: "partial observation",
      stderr: "native reason",
      truncated: false,
    },
  });
  const cleanup = new ProviderCleanupError("fixture", ["owned-process"], {
    reason: "Process termination was not confirmed",
  });
  const combined = analysisErrorWithCleanupFailure(primary, cleanup);
  const projected = projectAnalysisError(combined);
  expect(projected).toMatchObject({
    code: "cleanup_incomplete",
    message: primary.userMessage,
    details: {
      resources: ["owned-process"],
      captured_output: primary.capturedOutput,
      diagnostics: {
        primary_error: projectAnalysisErrorWithoutCapturedOutput(primary),
        cleanup_error: projectAnalysisError(cleanup),
      },
    },
  });
  expect(projected).not.toHaveProperty(
    "details.diagnostics.primary_error.details.captured_output",
  );
  expect(JSON.stringify(projected).split("partial observation")).toHaveLength(
    2,
  );
  expect(JSON.stringify(projected).split("native reason")).toHaveLength(2);
  expect(combined.cause).toBeInstanceOf(AggregateError);
  expect(combined.cause).toMatchObject({
    cause: primary,
    errors: [primary, cleanup],
  });
});
