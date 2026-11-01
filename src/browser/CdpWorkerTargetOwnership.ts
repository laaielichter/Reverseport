import { err, ok, type Result } from "../domain/result.js";
import { cdpStringValue } from "./CdpCaptureValues.js";

/** Optional CDP relationships establish ownership only when supplied. */
export const workerTargetOwnership = (
  target: Readonly<Record<string, unknown>>,
  selectedTargetId: string,
  frameIds: ReadonlySet<string>,
): Result<
  {
    readonly scope: "selected" | "foreign" | "unknown";
    readonly openerTargetId: string | null;
    readonly parentFrameId: string | null;
  },
  { readonly _tag: "InvalidWorkerRelationship" }
> => {
  const openerTargetId = cdpStringValue(target.openerId);
  const parentFrameId = cdpStringValue(target.parentFrameId);
  if (
    (target.openerId !== undefined &&
      (openerTargetId === undefined || openerTargetId === "")) ||
    (target.parentFrameId !== undefined &&
      (parentFrameId === undefined || parentFrameId === ""))
  )
    return err({ _tag: "InvalidWorkerRelationship" });
  const selected =
    openerTargetId === selectedTargetId ||
    (parentFrameId !== undefined && frameIds.has(parentFrameId));
  return ok({
    scope: selected
      ? "selected"
      : openerTargetId === undefined && parentFrameId === undefined
        ? "unknown"
        : "foreign",
    openerTargetId: openerTargetId ?? null,
    parentFrameId: parentFrameId ?? null,
  });
};
