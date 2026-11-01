import { inspectApkSignatureInputSchema } from "../../domain/apkSignature/apkSignatureQuery.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
  type AnalysisViewRetention,
} from "../analysisView/AnalysisViewService.js";
import { isAbsolute } from "node:path";

import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { ApkSignaturePort } from "./ApkSignaturePort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  apkSignatureMatchesSubject,
  apkSignatureResultSchema,
} from "../../domain/apkSignature/apkSignatureReport.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";

const OPERATION = "inspect_apk_signature";

/** Shared artifact validation and typed inline Evidence for CLI/MCP. */
export class ApkSignatureService {
  constructor(readonly provider: ApkSignaturePort) {}

  close(): Promise<void> {
    return this.provider.close();
  }

  /** Preserve exact selected artifact identity and the decoded signing facts. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
    retention: AnalysisViewRetention = {
      evidenceById: undefined,
      recordEvidence: undefined,
    },
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    const input = inspectApkSignatureInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    const { detail, view, ...parameters } = input.data;
    if (detail === "summary") {
      const ready = requireAnalysisViewRetention(OPERATION, retention);
      if (!ready.ok) return ready;
    }
    const inspected = await this.provider.inspect(parameters, options);
    if (!inspected.ok) return inspected;
    const execution = inspected.value;
    const report = apkSignatureResultSchema.safeParse(execution.result);
    if (
      !report.success ||
      report.data.artifact.path !== input.data.path ||
      !apkSignatureMatchesSubject(report.data.artifact, execution.subject)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "APK signature reader returned malformed data or changed the selected artifact identity.",
        ),
      );
    const completed = completeProviderEvidence(
      createEvidence(execution.subject, execution.provider, {
        operation: OPERATION,
        parameters: { path: input.data.path },
        result: report.data,
        ...(execution.rawResult === null
          ? {}
          : { rawResult: execution.rawResult }),
        confidence: "observed",
        locations: execution.locations,
        limitations: execution.limitations,
      }),
      options?.signal,
    );
    if (!completed.ok) return completed;
    return detail === "summary"
      ? projectRetainedAnalysis(
          completed.value,
          retention,
          view === undefined
            ? { kind: "summary" }
            : { kind: "apk-signature", ...view },
        )
      : completed;
  }
}
