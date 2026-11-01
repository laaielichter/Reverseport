import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, type Result } from "../domain/result.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type {
  AnalysisClient,
  ExecutionOptions,
} from "../application/AnalysisProvider.js";

/** Close one provider client and normalize unexpected adapter rejection. */
export const closeAnalysisClient = async (
  client: AnalysisClient,
  providerId: string,
  options: Pick<ExecutionOptions, "progress"> & {
    readonly retainDocument?: boolean;
    readonly onCleanupFailure?: (failure: AnalysisError) => void;
  } = {},
): Promise<Result<null, AnalysisError>> => {
  try {
    const result = await client.close(options);
    if (!result.ok) options.onCleanupFailure?.(result.error);
    return result;
  } catch (cause: unknown) {
    // A typed cleanup failure already names its leftover resources.
    const failure =
      cause instanceof AnalysisError && cause.cleanupIncomplete
        ? cause
        : new ProviderCleanupError(
            providerId,
            ["provider-client"],
            { reason: "provider client close rejected unexpectedly" },
            { cause },
          );
    options.onCleanupFailure?.(failure);
    return err(failure);
  }
};
