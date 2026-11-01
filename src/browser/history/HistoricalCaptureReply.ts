import { z } from "zod";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  completedStableArtifact,
  readStableArtifact,
} from "../../artifacts/readStableArtifact.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  webNetworkCapturePayloadSchema,
} from "../../domain/webNetworkCapture.js";

const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    value: webNetworkCapturePayloadSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([
      "format",
      "unsupported",
      "input-limit",
      "expanded-limit",
      "resource-limit",
      "decoder",
      "limit",
    ]),
    message: z.string(),
    pointer: z.string(),
  }),
]);

/** Decode a bounded reply while keeping its completed read and descriptor finalization distinct. */
export const readHistoricalCaptureReply = async (
  path: string,
  capturePath: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
) => {
  let finalization: ArtifactReaderFailure | undefined;
  try {
    let file;
    try {
      file = await readStableArtifact(
        path,
        WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
        signal,
        undefined,
        resources,
      );
    } catch (cause: unknown) {
      const completed = completedStableArtifact(cause);
      if (!(cause instanceof ArtifactReaderFailure) || completed === undefined)
        throw cause;
      finalization = cause;
      file = completed;
    }
    return {
      value: replySchema.parse(JSON.parse(file.bytes.toString("utf8"))),
      bytes: file.bytes.length,
      finalization,
    };
  } catch (cause: unknown) {
    if (finalization !== undefined) throw finalization;
    if (cause instanceof ArtifactReaderFailure) throw cause;
    if (
      signal?.aborted === true &&
      (cause === signal.reason ||
        (cause instanceof Error &&
          cause.name === "AbortError" &&
          "code" in cause &&
          cause.code === "ABORT_ERR"))
    )
      throw cause;
    throw new AnalysisOutputError(
      "inspect_web_network_capture",
      `Owned capture decoder reply failed for ${capturePath}: ${replyFailureReason(cause)}`,
      { cause },
    );
  }
};

const replyFailureReason = (cause: unknown): string => {
  if (cause instanceof ArtifactReaderFailure) return cause.message;
  if (cause instanceof z.ZodError)
    return `Reply violates its schema at ${cause.issues[0]?.path.map(String).join(".") ?? "root"}.`;
  if (cause instanceof SyntaxError) return "Reply is malformed JSON.";
  if (cause instanceof Error && "code" in cause)
    return `Reply file could not be read (${String(cause.code)}).`;
  return "Reply could not be validated.";
};
