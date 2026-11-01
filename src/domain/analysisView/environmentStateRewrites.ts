import type { StateRecordFacts } from "./environmentStateRules.js";

/** Two recordings of a type that disagree across a write. */
export interface RewriteSpan {
  readonly type: string;
  readonly earlier: number;
  readonly later: number;
}

/**
 * Per type whose reads disagree across writes, the earliest write within any such span: one that
 * began before the later recording ended and ended after the earlier began, in timeline order.
 */
export const rewriteCuts = (
  spans: readonly RewriteSpan[],
  writes: readonly StateRecordFacts[],
  byOrdinal: ReadonlyMap<number, StateRecordFacts>,
): Map<string, StateRecordFacts> => {
  // The latest end among each prefix of writes, so the first write ending after a time is found by bisection.
  const reach: number[] = [];
  for (const write of writes)
    reach.push(Math.max(reach.at(-1) ?? Number.NEGATIVE_INFINITY, write.end));
  const starts = writes.map((write) => write.start);
  /** The first index whose value passes `test`, which once true stays true. */
  const first = (
    values: readonly number[],
    test: (value: number) => boolean,
  ) => {
    let [low, high] = [0, values.length];
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (test(values[middle]!)) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const cuts = new Map<string, number>();
  for (const span of spans) {
    const earlier = byOrdinal.get(span.earlier);
    const later = byOrdinal.get(span.later);
    if (earlier === undefined || later === undefined) continue;
    // Writes come in start order: those begun before the later recording ended are a prefix.
    const index = first(reach, (end) => end > earlier.start);
    if (index < first(starts, (start) => start >= later.end))
      cuts.set(span.type, Math.min(index, cuts.get(span.type) ?? index));
  }
  return new Map([...cuts].map(([type, index]) => [type, writes[index]!]));
};
