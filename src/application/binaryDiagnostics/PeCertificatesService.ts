import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { PeCertificatesPort } from "./PeCertificatesPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  inspectPeCertificatesInputSchema,
  peCertificatesSchema,
  type PeCertificates,
} from "../../domain/native/peCertificates.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { peSubjectArchitecture } from "../../domain/peMachine.js";
import { err, ok, type Result } from "../../domain/result.js";
import { completeProviderEvidence } from "../ProviderOperationExecution.js";

const OPERATION = "inspect_pe_certificates";

/** Shared caller validation, output parsing and Evidence provenance for CLI/MCP. */
export class PeCertificatesService {
  constructor(readonly provider: PeCertificatesPort) {}

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
    const input = inspectPeCertificatesInputSchema.safeParse(rawInput);
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
    const report = peCertificatesSchema.safeParse(result.value);
    if (
      !report.success ||
      report.data.artifact.path !== input.data.path ||
      !validReport(
        report.data,
        input.data.max_entries,
        input.data.max_file_bytes,
      )
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "PE certificate provider returned malformed output or changed artifact identity.",
        ),
      );
    const value = report.data;
    const architecture = peSubjectArchitecture(value.machine, value.format);
    const locations = [
      { kind: "artifact-path" as const, path: value.artifact.path },
      ...(value.table === null
        ? []
        : [
            {
              kind: "file-offset-range" as const,
              start: value.table.location.offset,
              end: value.table.location.offset + value.table.location.bytes,
            },
          ]),
    ];
    return completeProviderEvidence(
      createEvidence(
        {
          path: value.artifact.path,
          format: "pe",
          sha256: value.artifact.sha256,
          ...(architecture === undefined ? {} : { architecture }),
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.data,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations,
        },
      ),
      options?.signal,
    );
  }
}

const validReport = (
  report: PeCertificates,
  maxEntries: number,
  maxBytes: number,
): boolean => {
  const inside = ({ offset, bytes }: { offset: number; bytes: number }) =>
    offset <= report.artifact.bytes - bytes;
  if (
    report.artifact.bytes > maxBytes ||
    report.coverage.examined_entries > maxEntries ||
    report.coverage.certificates !==
      report.entries.reduce(
        (count, entry) => count + (entry.pkcs7?.certificates.length ?? 0),
        0,
      ) ||
    report.entries.length > maxEntries
  )
    return false;
  if (report.table !== null && !inside(report.table.location)) return false;
  return report.entries.every(
    (entry) => inside(entry.location) && inside(entry.payload.location),
  );
};
