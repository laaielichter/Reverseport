import { expect, it } from "vitest";

import { combineBundleResourceClients } from "./BundleResourceSession.js";
import {
  createAnalysisExecution,
  type AnalysisClient,
  type ProviderIdentity,
} from "../AnalysisProvider.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err } from "../../domain/result.js";

const identity: ProviderIdentity = {
  id: "bundle-resource-close-fixture",
  name: "Bundle resource close fixture",
  version: "1",
};

it("retains both child close failures when a resource owner rejects", async () => {
  const attempts: string[] = [];
  const artifact: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      attempts.push("artifact");
      throw new Error("artifact close rejected");
    },
  };
  const native: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      attempts.push("native");
      throw new Error("native close rejected");
    },
  };

  const closed = await combineBundleResourceClients(artifact, native).close();
  expect(attempts.sort()).toEqual(["artifact", "native"]);
  expect(closed.ok).toBe(false);
  if (!closed.ok) expect(closed.error.cleanupIncomplete).toBe(true);
});

it("reports the first mixed child failure before awaiting the other owner and retries both", async () => {
  let artifactCloseAttempts = 0;
  let nativeCloseAttempts = 0;
  let nativeCloseStarted!: () => void;
  const nativeStarted = new Promise<void>((resolve) => {
    nativeCloseStarted = resolve;
  });
  let releaseNativeClose!: () => void;
  const nativeCloseGate = new Promise<void>((resolve) => {
    releaseNativeClose = resolve;
  });
  let cleanupFailureObserved!: (failure: Error) => void;
  const failureObserved = new Promise<Error>((resolve) => {
    cleanupFailureObserved = resolve;
  });
  const artifact: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      artifactCloseAttempts += 1;
      return artifactCloseAttempts === 1
        ? err(
            new ProviderCleanupError(identity.id, ["artifact-reader"], {
              reason: "artifact owner remains open",
            }),
          )
        : { ok: true, value: null };
    },
  };
  const native: AnalysisClient = {
    execute: async () => ({
      ok: true,
      value: createAnalysisExecution(null, identity),
    }),
    close: async () => {
      nativeCloseAttempts += 1;
      if (nativeCloseAttempts === 1) {
        nativeCloseStarted();
        await nativeCloseGate;
      }
      return { ok: true, value: null };
    },
  };
  const combined = combineBundleResourceClients(artifact, native);
  const closing = combined.close({
    onCleanupFailure: cleanupFailureObserved,
  });
  await Promise.all([nativeStarted, failureObserved]);
  releaseNativeClose();
  const first = await closing;
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("Expected mixed close failure");
  expect(first.error.cleanupIncomplete).toBe(true);

  expect(await combined.close()).toMatchObject({ ok: true });
  expect(artifactCloseAttempts).toBe(2);
  expect(nativeCloseAttempts).toBe(2);
});
