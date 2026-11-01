import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import type { NativeCommandCapture } from "./CommandRunner.js";
import { withoutEchoedPathHeader } from "./parsers/echoedPath.js";

const MISSING_UUID_DIAGNOSTIC = "missing LC_UUID load command";

const dyldFailureDiagnostics = (
  capture: NativeCommandCapture,
  outputs: readonly string[],
): readonly string[] =>
  capture.tool !== "dyld_info" ||
  capture.exitCode === null ||
  capture.exitCode === 0 ||
  capture.signal !== null
    ? []
    : outputs.flatMap((output) =>
        withoutEchoedPathHeader(output, capture.arguments.at(-1))
          .split(/\r?\n/u)
          .map((line) => line.trim().replace(/^(?:dyld_info:\s*)/u, "")),
      );

/** Recognize only dyld_info's target-specific missing-UUID refusal. */
export const isMissingUuidDyldFailure = (
  capture: NativeCommandCapture,
): boolean =>
  dyldFailureDiagnostics(capture, [capture.stdout]).includes(
    MISSING_UUID_DIAGNOSTIC,
  );

/** The narrowly observed dyld refusal for an unbacked dSYM text section. */
export const isUnbackedTextDyldFailure = (
  capture: NativeCommandCapture,
): boolean =>
  dyldFailureDiagnostics(capture, [capture.stdout, capture.stderr]).includes(
    "section '__TEXT/__text' has offset=0 but is not a zero-fill section type",
  );

/** Reported CORE/FVMLIB refusals still require an independently matching header. */
export const parseDyldFileTypeRefusal = (
  capture: NativeCommandCapture,
): {
  readonly fileType: "3" | "4";
  readonly diagnostic: string;
} | null => {
  for (const line of dyldFailureDiagnostics(capture, [
    capture.stdout,
    capture.stderr,
  ])) {
    const fileType = /^unknown (?:mh\.)?filetype ([34])$/u.exec(line)?.[1];
    if (fileType === "3" || fileType === "4")
      return { fileType, diagnostic: line };
  }
  return null;
};

/** Complete captures come from the settled native command owner. */
export const nativeMachoCapturedOutput = (
  capture: NativeCommandCapture,
): AnalysisCapturedOutput => ({
  stdout: capture.stdout,
  stderr: capture.stderr,
  truncated: false,
  stdout_bytes: capture.stdoutBytes,
  stderr_bytes: capture.stderrBytes,
  exit_code: capture.exitCode,
  signal: capture.signal,
});

/** Keep the exact target diagnostic beside the incomplete collection. */
export const missingUuidLimitation = (mode: "imports" | "exports"): string =>
  mode === "imports"
    ? "dyld_info -imports reported 'missing LC_UUID load command'; import observations are unavailable."
    : "dyld_info -exports reported 'missing LC_UUID load command'; exports include nm symbol-table observations only.";

/** Preserve unrecognized nonzero command output as an inspection failure. */
export const unusableNativeCommandOutput = (
  capture: NativeCommandCapture,
): AnalysisOutputError =>
  new AnalysisOutputError(
    "inspect_macho",
    `${capture.tool} did not produce a usable inspection result`,
    {
      capturedOutput: nativeMachoCapturedOutput(capture),
    },
  );

/** Refuse a recognized error when the independently parsed load table contradicts it. */
export const conflictingUuidCommandEvidence = (
  command: NativeCommandCapture,
): AnalysisOutputError =>
  new AnalysisOutputError(
    "inspect_macho",
    "dyld_info reported a missing LC_UUID despite an observed LC_UUID load command",
    {
      capturedOutput: nativeMachoCapturedOutput(command),
    },
  );
