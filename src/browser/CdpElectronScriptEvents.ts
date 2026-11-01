import type { CdpEvent } from "./CdpConnection.js";
import type { ElectronScriptFrameClaims } from "../domain/javascript/electronObservation.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { CDP_CAPTURE_SCRIPT_METADATA_LIMITS } from "./CdpCaptureEventTypes.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import {
  numberValue,
  recordValue,
  scriptMetadataValues,
  cdpStringValue,
} from "./CdpCaptureValues.js";

export interface ElectronScriptDraft {
  readonly scriptId: string;
  readonly rawUrl: string;
  readonly hash: string | null;
  readonly length: number | null;
  readonly isModule: boolean | null;
  readonly language: string | null;
  readonly frameId: string | null;
  readonly hasSourceUrl: boolean | null;
  readonly frameClaims: ElectronScriptFrameClaims;
}

/** Frame identity is retained separately from the document generation's admission. */
export type ElectronScriptFrameScope =
  | { readonly state: "authorized"; readonly frameId: string }
  | { readonly state: "excluded" }
  | { readonly state: "unknown"; readonly frameId: string | null };

/** Cumulative JSON bytes for this capture's retained draft array, starting at `[]`. */
export interface ElectronScriptMetadataRetention {
  bytes: number;
}

/** Retain script/frame metadata from passive Electron events. */
export const ingestElectronScriptEvent = (input: {
  readonly event: CdpEvent;
  readonly scripts: ElectronScriptDraft[];
  readonly executionContextFrames: Map<string, string>;
  readonly completeness: CdpCaptureCompleteness;
  readonly retention: ElectronScriptMetadataRetention;
}): void => {
  if (input.event.method === "Runtime.executionContextsCleared") {
    input.executionContextFrames.clear();
    return;
  }
  if (input.event.method === "Runtime.executionContextDestroyed") {
    const parameters = recordValue(input.event.params);
    const key = executionContextKey(parameters?.executionContextId);
    if (key !== null) input.executionContextFrames.delete(key);
    return;
  }
  if (input.event.method === "Runtime.executionContextCreated") {
    retainExecutionContext(input.event, input.executionContextFrames);
    return;
  }
  if (input.event.method !== "Debugger.scriptParsed") return;
  const value = recordValue(input.event.params);
  const scriptId = cdpStringValue(value?.scriptId);
  const rawUrl = cdpStringValue(value?.url);
  if (scriptId === undefined) {
    input.completeness.exclude("scripts", "invalid_protocol_value");
    return;
  }
  if (rawUrl === undefined || rawUrl === "") {
    input.completeness.exclude("scripts", "unattributed_origin");
    return;
  }
  const contextKey = executionContextKey(value?.executionContextId);
  const contextFrame =
    contextKey === null
      ? undefined
      : input.executionContextFrames.get(contextKey);
  const auxiliary = recordValue(value?.executionContextAuxData);
  const reportedFrame = cdpStringValue(auxiliary?.frameId);
  const declaredFrame = reportedFrame === "" ? undefined : reportedFrame;
  const conflictingFrame =
    declaredFrame !== undefined &&
    contextFrame !== undefined &&
    declaredFrame !== contextFrame;
  if (
    conflictingFrame ||
    (value?.executionContextAuxData !== undefined && auxiliary === undefined) ||
    (auxiliary !== undefined &&
      Object.hasOwn(auxiliary, "frameId") &&
      declaredFrame === undefined) ||
    (value?.hasSourceURL !== undefined &&
      typeof value.hasSourceURL !== "boolean")
  )
    input.completeness.exclude("scripts", "invalid_protocol_value");
  const script: ElectronScriptDraft = {
    scriptId,
    rawUrl,
    ...scriptMetadataValues(value),
    frameId: conflictingFrame ? null : (declaredFrame ?? contextFrame ?? null),
    frameClaims: {
      ...(reportedFrame === undefined
        ? {}
        : { script_event_frame_id: reportedFrame }),
      ...(contextFrame === undefined
        ? {}
        : { execution_context_frame_id: contextFrame }),
    },
    hasSourceUrl:
      typeof value?.hasSourceURL === "boolean" ? value.hasSourceURL : null,
  };
  const remaining =
    CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes - input.retention.bytes;
  const bytes =
    jsonValueByteLength({ ...script }, remaining) +
    (input.scripts.length > 0 ? 1 : 0);
  if (bytes > remaining) {
    input.completeness.exclude("scripts", "resource_budget_exhausted");
    return;
  }
  input.retention.bytes += bytes;
  input.scripts.push(script);
};

const retainExecutionContext = (
  event: CdpEvent,
  frames: Map<string, string>,
): void => {
  const parameters = recordValue(event.params);
  const runtimeContext = recordValue(parameters?.context);
  const contextKey = executionContextKey(runtimeContext?.id);
  const frameId = cdpStringValue(recordValue(runtimeContext?.auxData)?.frameId);
  if (contextKey === null || frameId === undefined || frameId === "") return;
  frames.set(contextKey, frameId);
};

const executionContextKey = (value: unknown): string | null => {
  const identifier = numberValue(value);
  return identifier !== undefined && Number.isSafeInteger(identifier)
    ? String(identifier)
    : null;
};
