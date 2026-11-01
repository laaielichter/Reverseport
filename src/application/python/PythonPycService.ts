import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PythonPycPort } from "./PythonPycPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPythonPycInputSchema,
  PYTHON_PYC_HEADER_BYTES,
  pythonPycSchema,
} from "../../domain/python/pythonPyc.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";

const OPERATION = "inspect_python_pyc";

/** Shared caller validation, output parsing and Evidence provenance for CLI and MCP. */
export class PythonPycService {
  constructor(readonly provider: PythonPycPort) {}

  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    const input = inspectPythonPycInputSchema.safeParse(rawInput);
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
    const result = await this.provider.inspect(input.data, options);
    if (!result.ok) return result;
    const report = pythonPycSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.data.path ||
      report.data.artifact.bytes > input.data.max_file_bytes ||
      report.data.coverage.objects > input.data.max_objects ||
      report.data.coverage.marshal_depth > input.data.max_depth
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Python pyc provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "file",
          sha256: value.artifact.sha256,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.data,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [
            { kind: "artifact-path", path: value.artifact.path },
            {
              kind: "file-offset-range",
              start: 0,
              end: PYTHON_PYC_HEADER_BYTES,
            },
            {
              kind: "file-offset-range",
              start: PYTHON_PYC_HEADER_BYTES,
              end: value.artifact.bytes,
            },
          ],
        },
      ),
      options?.signal,
    );
  }
}
