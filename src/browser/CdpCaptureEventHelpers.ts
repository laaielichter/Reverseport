import { err, ok, type Result } from "../domain/result.js";
import {
  admitRecords,
  isHttpUrl,
  numberValue,
  recordValue,
  cdpStringValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";
import type { CdpEvent } from "./CdpConnection.js";

export type FrameSelection = "main" | "other" | "unknown";
export type FrameParentRelation =
  | "root"
  | "child"
  | "unknown"
  | "not_applicable";

/** Normalized frame identity facts shared by all selected-frame consumers. */
export interface CdpFrameIdentity {
  readonly applicability: "applicable" | "not_applicable";
  readonly selection: FrameSelection;
  readonly isRootReplacement: boolean;
  readonly frameId: string | null;
  readonly identityIssue:
    | "missing_params"
    | "invalid_params"
    | "missing_frame"
    | "missing_id"
    | "invalid_id"
    | null;
  readonly parentRelation: FrameParentRelation;
  readonly parentId: string | null;
  readonly parentIssue:
    | "invalid_parent_id"
    | "self_parent"
    | "main_frame_has_parent"
    | null;
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const identityIssueFor = (
  navigated: boolean,
  frame: UnknownRecord | undefined,
  rawId: unknown,
): CdpFrameIdentity["identityIssue"] => {
  if (navigated && frame === undefined) return "missing_frame";
  if (rawId === undefined) return "missing_id";
  return nonEmptyString(rawId) === undefined ? "invalid_id" : null;
};

const parentFacts = (
  navigated: boolean,
  frame: UnknownRecord | undefined,
): Pick<CdpFrameIdentity, "parentRelation" | "parentId" | "parentIssue"> => {
  if (!navigated)
    return {
      parentRelation: "not_applicable",
      parentId: null,
      parentIssue: null,
    };
  if (frame === undefined)
    return { parentRelation: "unknown", parentId: null, parentIssue: null };
  if (!("parentId" in frame))
    return { parentRelation: "root", parentId: null, parentIssue: null };
  const parentId = nonEmptyString(frame.parentId);
  return parentId === undefined || parentId === nonEmptyString(frame.id)
    ? {
        parentRelation: "unknown",
        parentId: null,
        parentIssue:
          parentId === undefined ? "invalid_parent_id" : "self_parent",
      }
    : { parentRelation: "child", parentId, parentIssue: null };
};

/** Parse a frame record's identity without inferring its selected-target role. */
export const cdpFrameRecordIdentity = (
  frame: UnknownRecord | undefined,
): Pick<
  CdpFrameIdentity,
  "frameId" | "identityIssue" | "parentRelation" | "parentId" | "parentIssue"
> => ({
  frameId: nonEmptyString(frame?.id) ?? null,
  identityIssue: identityIssueFor(true, frame, frame?.id),
  ...parentFacts(true, frame),
});

/** Parse required frame identity separately from the optional parent fact. */
export const cdpFrameIdentity = (
  event: CdpEvent,
  mainFrameId: string,
): CdpFrameIdentity => {
  const navigated = event.method === "Page.frameNavigated";
  const requested = event.method === "Page.frameRequestedNavigation";
  const sameDocument = event.method === "Page.navigatedWithinDocument";
  if (!navigated && !requested && !sameDocument)
    return {
      applicability: "not_applicable",
      selection: "unknown",
      isRootReplacement: false,
      frameId: null,
      identityIssue: null,
      parentRelation: "not_applicable",
      parentId: null,
      parentIssue: null,
    };
  const params = recordValue(event.params);
  if (params === undefined)
    return {
      applicability: "applicable",
      selection: "unknown",
      isRootReplacement: false,
      frameId: null,
      identityIssue:
        event.params === undefined ? "missing_params" : "invalid_params",
      parentRelation: "not_applicable",
      parentId: null,
      parentIssue: null,
    };
  const identity = navigated
    ? cdpFrameRecordIdentity(recordValue(params.frame))
    : {
        frameId: nonEmptyString(params.frameId) ?? null,
        identityIssue: identityIssueFor(false, undefined, params.frameId),
        ...parentFacts(false, undefined),
      };
  const selection =
    identity.frameId === null
      ? "unknown"
      : identity.frameId === mainFrameId
        ? "main"
        : "other";
  return {
    applicability: "applicable",
    selection,
    isRootReplacement:
      selection === "other" && identity.parentRelation === "root",
    ...identity,
    parentIssue:
      selection === "main" &&
      (identity.parentRelation === "child" ||
        identity.parentIssue === "self_parent")
        ? "main_frame_has_parent"
        : identity.parentIssue,
  };
};

export interface MalformedCdpCallFrame {
  readonly _tag: "MalformedCdpCallFrame";
}

const malformedCallFrame: MalformedCdpCallFrame = {
  _tag: "MalformedCdpCallFrame",
};

/**
 * The call site is the frame at position zero. An omitted stack has no call
 * site; a malformed stack or top frame stays unknown rather than promoting a
 * caller to the call site.
 */
export const topCallFrame = (
  value: unknown,
): Result<UnknownRecord | undefined, MalformedCdpCallFrame> => {
  if (value === undefined) return ok(undefined);
  const stack = recordValue(value);
  if (stack === undefined) return err(malformedCallFrame);
  const frames = admitRecords(stack.callFrames);
  if (frames === undefined) return err(malformedCallFrame);
  if (frames.length === 0) return ok(undefined);
  const frame = recordValue(frames[0]);
  return frame === undefined ? err(malformedCallFrame) : ok(frame);
};

export const initiatorLocation = (
  initiator: UnknownRecord | undefined,
): Result<UnknownRecord | undefined, MalformedCdpCallFrame> => {
  let stack = initiator?.stack;
  for (let depth = 0; depth < 32 && stack !== undefined; depth += 1) {
    const frame = topCallFrame(stack);
    if (!frame.ok || frame.value !== undefined) return frame;
    stack = recordValue(stack)?.parent;
  }
  return ok(
    cdpStringValue(initiator?.url) === undefined ? undefined : initiator,
  );
};

export const exclusionReasonForUrl = (
  value: string | undefined,
): "disallowed_origin" | "unsupported_url" | "unattributed_origin" =>
  value === undefined || value === ""
    ? "unattributed_origin"
    : isHttpUrl(value)
      ? "disallowed_origin"
      : "unsupported_url";

export const integerOrNull = (value: unknown): number | null => {
  const number = numberValue(value);
  return number === undefined ? null : Math.max(0, Math.trunc(number));
};

export const executionContextKey = (value: unknown): string | null => {
  const identifier = numberValue(value);
  return identifier !== undefined && Number.isSafeInteger(identifier)
    ? String(identifier)
    : null;
};

export const isJsonContentType = (
  headers: UnknownRecord | undefined,
): boolean => {
  if (headers === undefined) return false;
  for (const [name, value] of Object.entries(headers))
    if (
      name.toLowerCase() === "content-type" &&
      isJsonMediaType(cdpStringValue(value))
    )
      return true;
  return false;
};

export const isJsonMediaType = (value: string | null | undefined): boolean => {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
};

export const consolePrimitive = (
  value: UnknownRecord,
): { readonly type: string; readonly text: string } | undefined => {
  const type = cdpStringValue(value.type);
  switch (type) {
    case "string":
      return typeof value.value === "string"
        ? { type, text: value.value }
        : undefined;
    case "boolean":
      return typeof value.value === "boolean"
        ? { type, text: String(value.value) }
        : undefined;
    case "number":
      return typeof value.value === "number"
        ? { type, text: String(value.value) }
        : typeof value.unserializableValue === "string"
          ? { type, text: value.unserializableValue }
          : undefined;
    case "bigint":
      return typeof value.unserializableValue === "string"
        ? { type, text: value.unserializableValue }
        : undefined;
    case "undefined":
      return { type, text: "undefined" };
    case "object":
      // The protocol delivers `null` as an object with a `null` subtype. Its
      // sentinel is already in the event, unlike an unexpanded remote object.
      return cdpStringValue(value.subtype) === "null"
        ? { type, text: "null" }
        : undefined;
    default:
      return undefined;
  }
};
