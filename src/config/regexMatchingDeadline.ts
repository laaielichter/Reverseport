import {
  DEFAULT_REGEX_MATCHING_DEADLINE_MS,
  MAXIMUM_REGEX_MATCHING_DEADLINE_MS,
} from "../domain/analysisResourceLimits.js";
export {
  DEFAULT_REGEX_MATCHING_DEADLINE_MS,
  MAXIMUM_REGEX_MATCHING_DEADLINE_MS,
} from "../domain/analysisResourceLimits.js";
import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const REGEX_MATCHING_DEADLINE_SETTING = "REA_REGEX_MATCHING_DEADLINE_MS";

/** Effective regex matching deadline and where its value came from. */
export interface RegexMatchingDeadline {
  readonly deadlineMs: number;
  readonly source: "default" | "setting" | "runtime";
}

export const DEFAULT_REGEX_MATCHING_DEADLINE: RegexMatchingDeadline = {
  deadlineMs: DEFAULT_REGEX_MATCHING_DEADLINE_MS,
  source: "default",
};

export const regexMatchingDeadlineConstraint = `${REGEX_MATCHING_DEADLINE_SETTING} must be a positive decimal integer from 1 to ${String(MAXIMUM_REGEX_MATCHING_DEADLINE_MS)} ms; the default is ${String(DEFAULT_REGEX_MATCHING_DEADLINE_MS)} ms. Node schedules a delay above that maximum as 1 ms, so a larger value is refused.`;

const decimalInteger = /^[1-9]\d*$/u;

const withinDeadlineRange = (value: string): boolean => {
  // The pattern check reports a non-decimal value. Refine only bounds integers.
  if (!decimalInteger.test(value)) return true;
  const parsed = BigInt(value);
  return parsed >= 1n && parsed <= BigInt(MAXIMUM_REGEX_MATCHING_DEADLINE_MS);
};

/** Optional decimal millisecond count for the supervised regex matching deadline. */
export const regexMatchingDeadlineMsSchema = z
  .string()
  .regex(decimalInteger, { error: regexMatchingDeadlineConstraint })
  .refine(withinDeadlineRange, { error: regexMatchingDeadlineConstraint })
  .transform(Number);

/** Resolve the effective deadline from one environment value. */
export const parseRegexMatchingDeadline = (
  value: string | undefined,
): Result<RegexMatchingDeadline, ConfigurationError> => {
  if (value === undefined) return ok(DEFAULT_REGEX_MATCHING_DEADLINE);
  const parsed = regexMatchingDeadlineMsSchema.safeParse(value);
  return parsed.success
    ? ok({ deadlineMs: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(regexMatchingDeadlineConstraint, {
          settings: [
            {
              setting: REGEX_MATCHING_DEADLINE_SETTING,
              constraint: regexMatchingDeadlineConstraint,
            },
          ],
        }),
      );
};

/**
 * Resolve the deadline from a composition root's selected environment. An
 * invalid setting is refused, not ignored. Callers that already resolved it
 * at startup pass that value through instead of reading the environment again.
 */
export const resolveRegexMatchingDeadline = (
  environment: Readonly<Record<string, string | undefined>>,
): RegexMatchingDeadline => {
  const parsed = parseRegexMatchingDeadline(
    environment[REGEX_MATCHING_DEADLINE_SETTING],
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** How to read and change the effective supervised matching deadline. */
export const regexMatchingDeadlineRecovery = (
  deadline: RegexMatchingDeadline,
): string =>
  [
    `The effective ${REGEX_MATCHING_DEADLINE_SETTING} value is ${String(deadline.deadlineMs)} ms (source ${deadline.source}; default ${String(DEFAULT_REGEX_MATCHING_DEADLINE_MS)} ms, floor 1 ms, maximum ${String(MAXIMUM_REGEX_MATCHING_DEADLINE_MS)} ms).`,
    `Set ${REGEX_MATCHING_DEADLINE_SETTING} in the environment that starts REA to a positive decimal integer from 1 to ${String(MAXIMUM_REGEX_MATCHING_DEADLINE_MS)}, then restart REA. In a running MCP server, use update_analysis_settings with setting regex.matching_deadline_ms and action set instead; the new value applies to new work without a REA restart.`,
    "The worker old-generation heap does not raise this deadline.",
  ].join(" ");
