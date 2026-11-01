import type {
  JavaScriptSemanticProjectionCapacity,
  JavaScriptSemanticFileProjection,
} from "./javascriptSemanticFileProjection.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import type { Result } from "../result.js";
import type { JavaScriptArtifactFile } from "./javascriptArtifactFiles.js";
import type { JavaScriptStaticAnalysis } from "./javascriptStaticAnalysisTypes.js";
import type { JavaScriptModuleSemanticIr } from "./javascriptModuleSemanticIr.js";

/** Portable facts collected from one inert source. */
export interface JavaScriptAnalyzedSource {
  readonly javascript: JavaScriptStaticAnalysis;
  readonly module: JavaScriptModuleSemanticIr | null;
  readonly projection: JavaScriptSemanticFileProjection | null;
  readonly applicationProjectionFailure?: AnalysisResourceConstraintError;
}

/** Execution failure alongside facts already collected by the consumer. */
export interface JavaScriptSourceAnalysisFailure {
  readonly error: AnalysisError;
  readonly javascript: JavaScriptStaticAnalysis | null;
  readonly module: JavaScriptModuleSemanticIr | null;
  readonly projection: JavaScriptSemanticFileProjection | null;
  readonly applicationProjectionFailure?: AnalysisResourceConstraintError;
}

/** Operational choices for source analysis, independent of transport framing. */
export interface JavaScriptSourceAnalysisLimits {
  readonly heapMb: number;
  readonly timeoutMs: number;
}

/** Sequential source-analysis authority with independently verified cleanup. */
export interface JavaScriptSourceAnalysisPort {
  analyze(
    file: JavaScriptArtifactFile,
    capacity: JavaScriptSemanticProjectionCapacity,
    signal?: AbortSignal,
    onPhase?: (phase: string) => Promise<void>,
  ): Promise<Result<JavaScriptAnalyzedSource, JavaScriptSourceAnalysisFailure>>;
  close(): Promise<void>;
}
