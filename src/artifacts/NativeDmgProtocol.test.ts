import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { build } from "plist";
import { expect, it } from "vitest";
import {
  NativeDmgArtifactReader,
  type NativeDmgHost,
} from "./NativeDmgArtifactReader.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

it("retains malformed successful hdiutil inventory output as a typed producer parse failure before attach", async () => {
  const calls: string[] = [];
  const host: NativeDmgHost = {
    run: async (args) => {
      calls.push(args[0] ?? "");
      if (args[0] === "verify") return { stdout: "", exitCode: 0 };
      if (args[0] === "info")
        return { stdout: build({ images: "not an array" }), exitCode: 0 };
      throw new Error("Unexpected command");
    },
  };
  const reader = new NativeDmgArtifactReader("/fixture/image.dmg", {}, host);
  let failure: unknown;
  try {
    for await (const _entry of reader.entries()) {
      /* consume */
    }
  } catch (cause: unknown) {
    failure = cause;
  } finally {
    await reader.close();
  }
  expect(calls).toEqual(["verify", "info"]);
  expect(failure).toMatchObject({
    reason: "format",
    message: "hdiutil info -plist returned malformed image inventory",
    cause: { name: "ZodError" },
  });
  expect(
    projectAnalysisError(translateArtifactFailure("inspect_artifact", failure)),
  ).toMatchObject({
    details: {
      reason: "format",
      detail: "hdiutil info -plist returned malformed image inventory",
    },
  });
});

it("uses the typed command cancellation owner for injected hosts and preserves physical AbortError names", async () => {
  for (const cancelled of [true, false]) {
    const reason = { requested: "stop injected verify" };
    const physical = Object.assign(new Error("physical host failure"), {
      name: "AbortError",
      code: "EIO",
    });
    const failureCause = cancelled
      ? new ExecFileOutputCancelledError(reason)
      : physical;
    const reader = new NativeDmgArtifactReader(
      "/fixture/image.dmg",
      {},
      {
        run: async () => {
          throw failureCause;
        },
      },
    );
    try {
      const result = (async () => {
        for await (const _entry of reader.entries()) {
          /* consume */
        }
      })();
      const failure: unknown = await result.catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected typed failure");
      expect(failure.reason).toBe(cancelled ? "cancelled" : "io");
      expect(failure.cause).toBe(failureCause);
      expect(failure.cancellation?.reason).toBe(cancelled ? reason : undefined);
    } finally {
      await reader.close();
    }
  }
});
