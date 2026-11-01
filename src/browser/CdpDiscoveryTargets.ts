import { z } from "zod";

import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";

const identitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  url: z.string(),
  title: z.unknown().optional(),
  attached: z.unknown().optional(),
  webSocketDebuggerUrl: z.unknown().optional(),
});

/** Shared HTTP /json/list facts; socket authority stays with each transport owner. */
export interface CdpDiscoveryTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly attached: boolean | null;
  readonly webSocketDebuggerUrl: unknown;
}

/** A malformed optional field cannot erase valid sibling target identities. */
export const parseCdpDiscoveryTargets = (
  input: unknown,
  operation: BrowserObservationOperation,
): {
  readonly targets: readonly CdpDiscoveryTarget[];
  readonly limitations: readonly string[];
} => {
  if (!Array.isArray(input))
    throw new BrowserObservationError(operation, "invalid_endpoint_response", {
      detail: "CDP /json/list must return an array of target rows.",
    });
  const targets: CdpDiscoveryTarget[] = [];
  const limitations: string[] = [];
  for (const [index, row] of input.entries()) {
    const parsed = identitySchema.safeParse(row);
    if (!parsed.success) {
      limitations.push(
        `CDP /json/list row ${String(index)} was excluded because its target identity is malformed: ${JSON.stringify(parsed.error.issues)}.`,
      );
      continue;
    }
    const target = parsed.data;
    if (
      target.attached !== undefined &&
      target.attached !== null &&
      typeof target.attached !== "boolean"
    )
      limitations.push(
        `CDP /json/list row ${String(index)} target ${target.id} reported malformed attached metadata ${JSON.stringify(target.attached)}; attachment state is unknown.`,
      );
    if (target.title !== undefined && typeof target.title !== "string")
      limitations.push(
        `CDP /json/list row ${String(index)} target ${target.id} reported malformed title metadata ${JSON.stringify(target.title)}; title is unavailable.`,
      );
    targets.push({
      id: target.id,
      type: target.type,
      url: target.url,
      title: typeof target.title === "string" ? target.title : "",
      attached: typeof target.attached === "boolean" ? target.attached : null,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    });
  }
  return { targets, limitations };
};
