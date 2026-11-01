import type { JsonValue } from "../jsonValue.js";
import { same, type JsonObject } from "./environmentStateRules.js";
import { storedKinds } from "./environmentStateWriteApply.js";
import { fittedClockFormat } from "./environmentStateWriteClockFormats.js";
import {
  alikeRules,
  type FieldRule,
  type WriteBody,
} from "./environmentStateWriteRules.js";

type Default = { readonly member: string; readonly value: JsonValue };

/** What earlier calls showed that a merge must respect: members stored unsorted as sent, and the value showing each clock's width. */
export interface EarlierEvidence {
  readonly kept: ReadonlySet<string>;
  readonly clockOf: (field: string) => JsonValue | undefined;
}

/** The plan's rule for a field and a later call's agree: equal, or clocks one spelling covers given what earlier calls showed. */
const agreeing = (
  held: FieldRule,
  later: FieldRule,
  values: {
    readonly field: string;
    readonly later: JsonValue | undefined;
    readonly earlier: EarlierEvidence;
  },
): FieldRule | undefined => {
  const alike = alikeRules(held, later, values.earlier.kept);
  if (alike !== undefined) return alike;
  if (held.rule !== "clock" || later.rule !== "clock") return undefined;
  const format = fittedClockFormat(
    held.format,
    values.later,
    values.earlier.clockOf(values.field),
  );
  return format === undefined ? undefined : { ...held, format };
};

/** Defaults joined, undefined when two calls showed one member left out at different values. */
const joinedDefaults = (
  held: readonly Default[],
  added: readonly Default[],
): Default[] | undefined => {
  const joined = new Map(held.map((entry) => [entry.member, entry.value]));
  for (const { member, value } of added) {
    if (joined.has(member) && !same(joined.get(member), value))
      return undefined;
    joined.set(member, value);
  }
  return [...joined].map(([member, value]) => ({ member, value }));
};

/** What two calls show of one field. */
interface FieldCalls {
  readonly before: FieldRule | undefined;
  readonly after: FieldRule | undefined;
  readonly exemplar: JsonObject;
  readonly later: { readonly entity: JsonObject; readonly body: JsonObject };
  readonly sentBefore: ReadonlySet<string>;
  readonly required: readonly string[];
  readonly earlier: EarlierEvidence;
}

/** A reference an earlier later call added: it stays while a call leaves its member out, and agrees with this call's when it shows it. */
const addedReference = (
  field: string,
  added: Extract<FieldRule, { rule: "reference" }>,
  calls: FieldCalls,
): { readonly rule: FieldRule } | undefined => {
  const { after, later } = calls;
  if (!Object.hasOwn(later.entity, field))
    return Object.hasOwn(later.body, added.member)
      ? undefined
      : { rule: added };
  const rule =
    after === undefined
      ? undefined
      : agreeing(added, after, {
          field,
          later: later.entity[field],
          earlier: calls.earlier,
        });
  return rule === undefined ? undefined : { rule };
};

/** A field one call shows alone, which must be a reference the other call did not send the member of. */
const shownAlone = (
  inExemplar: boolean,
  calls: FieldCalls,
): { readonly rule: FieldRule } | undefined => {
  const own = inExemplar ? calls.before : calls.after;
  if (own?.rule !== "reference") return undefined;
  const sent = inExemplar
    ? Object.hasOwn(calls.later.body, own.member)
    : calls.sentBefore.has(own.member);
  return sent ? undefined : { rule: own };
};

/** One field's rule in the merged plan, and the default it gives a member; undefined when the calls disagree on it. */
const mergedField = (
  field: string,
  calls: FieldCalls,
): { readonly rule?: FieldRule; readonly default?: Default } | undefined => {
  const { before, after, exemplar, later } = calls;
  const inExemplar = Object.hasOwn(exemplar, field);
  if (!inExemplar && before?.rule === "reference")
    return addedReference(field, before, calls);
  if (!inExemplar || !Object.hasOwn(later.entity, field))
    return shownAlone(inExemplar, calls);
  if (before !== undefined && after !== undefined) {
    const rule = agreeing(before, after, {
      field,
      later: later.entity[field],
      earlier: calls.earlier,
    });
    return rule === undefined ? undefined : { rule };
  }
  // The plan echoes a member this call left out: what it stored there is the member's default.
  if (before !== undefined)
    return before.rule === "echo" && !Object.hasOwn(later.body, field)
      ? {
          rule: before,
          default: { member: field, value: later.entity[field]! },
        }
      : undefined;
  // This call echoes a member the plan's calls left out: what they stored there is its default.
  if (after !== undefined)
    return after.rule === "echo" && !calls.required.includes(field)
      ? { rule: after, default: { member: field, value: exemplar[field]! } }
      : undefined;
  return same(exemplar[field], later.entity[field]) ? {} : undefined;
};

/**
 * A create plan widened by a later call, explained on its own: both calls show the same fields, but for a reference
 * whose member a call without it did not send (one an earlier call added stays), every field both rule they rule alike
 * as far as earlier calls allow, a field neither rules holds one value, and where only one echoes a member the other
 * left out, the member becomes optional with the value the call that left it out stored. Members either call sent are
 * accepted, and only those every call sent are required. Undefined when the calls disagree otherwise, so the later call
 * stays unexplained.
 */
export const mergedCreatePlan = (
  plan: { readonly rules: readonly FieldRule[]; readonly body: WriteBody },
  exemplar: JsonObject,
  later: {
    readonly entity: JsonObject;
    readonly body: JsonObject;
    readonly rules: readonly FieldRule[];
    readonly contract: WriteBody;
  },
  earlier: EarlierEvidence = {
    kept: new Set(),
    clockOf: (field) => exemplar[field],
  },
): { readonly rules: FieldRule[]; readonly body: WriteBody } | undefined => {
  const held = new Map(plan.rules.map((rule) => [rule.field, rule]));
  const shown = new Map(later.rules.map((rule) => [rule.field, rule]));
  const sentBefore = new Set([
    ...plan.body.accepted,
    ...plan.body.fixed.map(({ member }) => member),
    ...plan.body.required,
  ]);
  const merged = new Map<string, FieldRule>();
  const defaults: Default[] = [];
  for (const field of new Set([
    ...Object.keys(exemplar),
    ...Object.keys(later.entity),
    ...held.keys(),
  ])) {
    const outcome = mergedField(field, {
      before: held.get(field),
      after: shown.get(field),
      exemplar,
      later,
      sentBefore,
      required: plan.body.required,
      earlier,
    });
    if (outcome === undefined) return undefined;
    if (outcome.rule !== undefined) merged.set(field, outcome.rule);
    if (outcome.default !== undefined) defaults.push(outcome.default);
  }
  const body = mergedBody(plan.body, later, exemplar);
  const joined =
    body === undefined
      ? undefined
      : joinedDefaults(plan.body.defaults ?? [], defaults);
  if (body === undefined || joined === undefined) return undefined;
  // The plan's rules keep their order; rules the later call adds follow.
  return {
    rules: [
      ...plan.rules.flatMap((rule) => {
        const kept = merged.get(rule.field);
        return kept === undefined ? [] : [kept];
      }),
      ...[...merged.values()].filter((rule) => !held.has(rule.field)),
    ],
    body: joined.length === 0 ? body : { ...body, defaults: joined },
  };
};

/** Two calls' body contracts joined, undefined when a member one accepts with any value the other fixes, or both fix it at different values. */
const mergedBody = (
  body: WriteBody,
  later: {
    readonly body: JsonObject;
    readonly contract: WriteBody;
    readonly entity: JsonObject;
  },
  exemplar: JsonObject,
): WriteBody | undefined => {
  const fixed = new Map(body.fixed.map((entry) => [entry.member, entry.sent]));
  const { contract } = later;
  if (
    contract.accepted.some((member) => fixed.has(member)) ||
    contract.fixed.some(
      (entry) =>
        body.accepted.includes(entry.member) ||
        (fixed.has(entry.member) && !same(fixed.get(entry.member), entry.sent)),
    ) ||
    contract.envelope !== body.envelope
  )
    return undefined;
  const added = contract.accepted.filter(
    (member) => !body.accepted.includes(member),
  );
  return {
    ...body,
    accepted: [...body.accepted, ...added],
    fixed: [
      ...body.fixed,
      ...contract.fixed.filter((entry) => !fixed.has(entry.member)),
    ],
    required: body.required.filter((member) =>
      Object.hasOwn(later.body, member),
    ),
    identity: body.identity ?? contract.identity,
    kinds: [...body.kinds, ...storedKinds(added, exemplar, later.entity)],
  };
};
