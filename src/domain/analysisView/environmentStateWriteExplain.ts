import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import {
  isObject,
  locateItem,
  pointerTo,
  same,
  scalarText,
  type JsonObject,
  type StateEntity,
} from "./environmentStateRules.js";
import {
  siblingTrimmedClocks,
  type FieldRule,
  type InsertRule,
  type WriteBody,
  type WriteCall,
  type WriteResponse,
} from "./environmentStateWriteRules.js";
import {
  containsDelimited,
  containsNumber,
  generatedIntegerDigits,
  integerOf,
  isUuid,
  readClock,
  sequenceNumber,
  slugOf,
  sortedStrings,
  type ClockFormat,
} from "./environmentStateWriteValues.js";
import { createdComposer } from "./environmentStateWriteComposed.js";
import { referenceRule } from "./environmentStateWriteReferences.js";
import {
  fittedClockFormat,
  showsFixedWidth,
} from "./environmentStateWriteClockFormats.js";
import {
  COPY_MIN_LENGTH,
  instantMembers,
  referencedMembers,
  storedMembers,
  strandedCopies,
  templateRule,
} from "./environmentStateWriteCopies.js";
import {
  unexplainedRenewals,
  GENERATED,
} from "./environmentStateWriteGenerated.js";
import {
  createdNestedClock,
  createdToken,
  isClockNear,
  pairedStamps,
  pinnedEchoes,
} from "./environmentStateWriteStamps.js";
import {
  changeRule,
  heldClock,
  sameSecondClocks,
  sentRule,
  type UpdateEvidence,
} from "./environmentStateWriteChanges.js";

/** What explaining a create reads: the observed entity, the call that wrote it and the entities it joined. */
export interface CreateEvidence {
  readonly entity: JsonObject;
  readonly call: WriteCall & { readonly body: JsonObject };
  readonly idField: string;
  /** The request's start in epoch milliseconds, when the timeline is timed. */
  readonly startMs: number | undefined;
  readonly collection: readonly JsonObject[];
  readonly type: readonly JsonObject[];
  /** The entities of any type the state holds under an id. */
  readonly named?: (id: string) => readonly StateEntity[];
}

/** What explaining a create looks values up in, built once per request body. */
interface BodyIndex {
  /** Each body string long enough to show a copy, at its shallowest pointer (breadth-first, members in order). */
  readonly copies: ReadonlyMap<string, string>;
  /** Each slug a top-level string member slugs to, other than its own value, from the first such member. */
  readonly slugs: ReadonlyMap<string, string>;
}

/** Index a request body once, so explaining each field looks values up rather than walking the body again. */
const indexBody = (body: JsonObject): BodyIndex => {
  const copies = new Map<string, string>();
  const pending: { readonly value: JsonValue; readonly pointer: string }[] = [
    { value: body, pointer: "" },
  ];
  // An index walks the queue: shifting a wide body's values one by one would take quadratic time.
  for (let at = 0; at < pending.length; at += 1) {
    const next = pending[at]!;
    if (typeof next.value === "string") {
      if (next.value.length >= COPY_MIN_LENGTH && !copies.has(next.value))
        copies.set(next.value, next.pointer);
      continue;
    }
    const children: [string, JsonValue][] = Array.isArray(next.value)
      ? next.value.map((item, index) => [String(index), item])
      : isObject(next.value)
        ? Object.entries(next.value)
        : [];
    for (const [key, item] of children)
      pending.push({
        value: item,
        pointer: `${next.pointer}${pointerTo(key)}`,
      });
  }
  const slugs = new Map<string, string>();
  for (const [member, sent] of Object.entries(body))
    if (typeof sent === "string") {
      const slug = slugOf(sent);
      if (slug !== sent && !slugs.has(slug)) slugs.set(slug, member);
    }
  return { copies, slugs };
};

/** One more than the largest integer the members hold in the field, or undefined when none holds one. */
export const nextInteger = (
  members: readonly JsonObject[],
  field: string,
  exemplar?: JsonValue,
): number | undefined => {
  let largest: number | undefined;
  for (const member of members) {
    const value = sequenceNumber(member[field], exemplar);
    if (value !== undefined && (largest === undefined || value > largest))
      largest = value;
  }
  return largest === undefined ? undefined : largest + 1;
};

const identityRule = (field: string, value: JsonValue): FieldRule => ({
  field,
  rule: "identity",
  generator:
    integerOf(value) !== undefined
      ? "sequence"
      : isUuid(value)
        ? "uuid"
        : "token",
});

/** The rule a request explains a created field by, before generated values and templates are considered. */
const requestRule = (
  evidence: CreateEvidence,
  index: BodyIndex,
  field: string,
  value: JsonValue,
): FieldRule | undefined => {
  const { body, pathValues } = evidence.call;
  if (Object.hasOwn(body, field) && same(body[field], value))
    return { field, rule: "echo" };
  if (Object.hasOwn(body, field) && same(sortedStrings(body[field]), value))
    return { field, rule: "echo", sorted: true };
  if (typeof value === "string" && value.length >= COPY_MIN_LENGTH) {
    const from = index.copies.get(value);
    if (from !== undefined) return { field, rule: "copy", from };
  }
  const text = scalarText(value);
  for (const [name, pathValue] of pathValues)
    if (text !== undefined && text === pathValue)
      return { field, rule: "path", from: name };
  const slugged = typeof value === "string" && value.length >= 3;
  const member = slugged ? index.slugs.get(value) : undefined;
  return member === undefined
    ? undefined
    : { field, rule: "slug", from: member };
};

/** A clock's format, trimmed when the type's values of the field show its fraction trimmed and none shows a fixed width. */
const learnedClockFormat = (
  format: ClockFormat,
  field: string,
  value: JsonValue,
  type: readonly JsonObject[],
): ClockFormat => {
  let learned = format;
  for (const member of type) {
    const fitted = fittedClockFormat(learned, member[field], value);
    if (fitted?.kind === "iso" && fitted.trimmed === true) learned = fitted;
  }
  return type.some((member) => showsFixedWidth(format, member[field]))
    ? format
    : learned;
};

/** A created large integer's proof, as a time-based id's: no entity of its type holds it and each holds a distinct one of the same length and kind; linked when another field holds it too, as a number at any depth or delimited in a nested string, which seeding cannot keep. */
export const createdInteger = (
  field: string,
  entity: JsonObject,
  type: readonly JsonObject[],
): "independent" | "linked" | undefined => {
  const value = entity[field];
  const digits = generatedIntegerDigits(value);
  if (
    digits === undefined ||
    readClock(value) !== undefined ||
    type.length === 0
  )
    return undefined;
  const held = new Set([digits]);
  const distinct = type.every((member) => {
    const other = generatedIntegerDigits(member[field]);
    if (
      other === undefined ||
      typeof member[field] !== typeof value ||
      other.length !== digits.length ||
      held.has(other)
    )
      return false;
    held.add(other);
    return true;
  });
  if (!distinct) return undefined;
  return Object.entries(entity).some(
    ([other, kept]) =>
      other !== field &&
      (kept === value ||
        containsNumber(kept, digits) ||
        (typeof kept === "object" &&
          kept !== null &&
          containsDelimited(kept, digits))),
  )
    ? "linked"
    : "independent";
};

/** The rule a created field's generated value follows, if it follows one. */
const generatedRule = (
  evidence: CreateEvidence,
  field: string,
  value: JsonValue,
): FieldRule | undefined => {
  if (field === evidence.idField) return identityRule(field, value);
  const clock = readClock(value);
  if (clock !== undefined && isClockNear(value, evidence.startMs))
    return {
      field,
      rule: "clock",
      format: learnedClockFormat(clock.format, field, value, evidence.type),
    };
  const integer = sequenceNumber(value);
  if (integer !== undefined) {
    if (nextInteger(evidence.collection, field, value) === integer)
      return { field, rule: "sequence", scope: "collection" };
    if (nextInteger(evidence.type, field, value) === integer)
      return { field, rule: "sequence", scope: "type" };
  }
  if (
    (isUuid(value) &&
      evidence.type.length > 0 &&
      evidence.type.every((member) => member[field] !== value)) ||
    createdInteger(field, evidence.entity, evidence.type) === "independent"
  )
    return { field, rule: "unique" };
  if (createdToken(field, evidence.entity, evidence.type) === "independent")
    return { field, rule: "unique" };
  return createdNestedClock(field, value, evidence);
};

/** Pinned members less those a reference reads: it rebuilds the object they name for any held entity. */
const unreferenced = (
  rules: readonly FieldRule[],
  pinned: Set<string>,
): Set<string> => {
  for (const rule of rules)
    if (rule.rule === "reference") pinned.delete(rule.member);
  return pinned;
};

/** Body members the application stored as sent, and the others with what they were sent. */
const bodyOf = (
  body: JsonObject,
  echoed: ReadonlySet<string>,
  required: readonly string[],
): WriteBody => ({
  accepted: Object.keys(body).filter((member) => echoed.has(member)),
  fixed: Object.entries(body)
    .filter(([member]) => !echoed.has(member))
    .map(([member, sent]) => ({ member, sent })),
  required: [...required],
  identity: null,
  kinds: [],
});

/** Explain every field of a created entity: echoed, copied, path, slug, generated, template or constant (unlisted). */
export const explainCreate = (
  evidence: CreateEvidence,
): {
  readonly rules: FieldRule[];
  readonly body: WriteBody;
  readonly tied: boolean;
} => {
  const ruled: FieldRule[] = [];
  const unexplained: string[] = [];
  const index = indexBody(evidence.call.body);
  for (const [field, value] of Object.entries(evidence.entity)) {
    const rule =
      requestRule(evidence, index, field, value) ??
      generatedRule(evidence, field, value) ??
      (evidence.named === undefined
        ? undefined
        : referenceRule(field, value, evidence.call.body, evidence.named));
    if (rule === undefined) unexplained.push(field);
    else ruled.push(rule);
  }
  const rules = siblingTrimmedClocks(ruled, evidence.entity, ...evidence.type);
  // Generated values first, then copies: an echoed value may recur in unrelated text, a copied one is the call's own unless also echoed.
  const echoed = new Set(
    rules.flatMap((rule) =>
      rule.rule === "echo" ? [scalarText(evidence.entity[rule.field])] : [],
    ),
  );
  const sources = [
    ...rules.filter((rule) => GENERATED.has(rule.rule)),
    ...rules.filter(
      (rule) =>
        rule.rule === "copy" &&
        !echoed.has(scalarText(evidence.entity[rule.field])),
    ),
  ];
  const constants: string[] = [];
  const composed = createdComposer(evidence.entity, rules, evidence.type);
  for (const field of unexplained) {
    const template =
      templateRule(evidence.entity, field, sources) ?? composed(field);
    if (template === undefined) constants.push(field);
    else rules.push(template);
  }
  const tokens = [...evidence.call.pathValues.values()].filter(
    (value) => value.length > 0,
  );
  const templates = rules.flatMap((rule) =>
    rule.rule === "template" ? [rule.field] : [],
  );
  // A composed string rebuilds the values it names, so only its literal text can tie it.
  const literals = rules.flatMap((rule) =>
    rule.rule === "composed"
      ? rule.parts.flatMap((part) => ("text" in part ? [part.text] : []))
      : [],
  );
  // A member whose value a template cannot rebuild, or that a constant derives from, is accepted only with its recorded value.
  const texts = [...constants, ...templates];
  const stranded = strandedCopies(rules, evidence.entity, texts);
  const referenced = new Set([
    ...referencedMembers(
      evidence.call.body,
      evidence.entity,
      constants,
      evidence.named ?? (() => []),
    ),
    ...instantMembers(evidence.call.body, evidence.entity, constants),
  ]);
  const pinned = unreferenced(
    rules,
    pinnedEchoes(evidence.entity, evidence.call.body, evidence.type),
  );
  const stored = storedMembers(
    rules.filter((rule) => !stranded.has(rule.field)),
    evidence.entity,
  );
  return {
    rules,
    body: bodyOf(
      evidence.call.body,
      new Set(
        [...stored].filter(
          (member) => !referenced.has(member) && !pinned.has(member),
        ),
      ),
      Object.keys(evidence.call.body),
    ),
    // A template rebuilds only its generated value, so other text it keeps ties it like a constant.
    tied: [
      ...[...constants, ...templates].map((field) => evidence.entity[field]!),
      ...literals,
    ].some((text) => tokens.some((token) => containsDelimited(text, token))),
  };
};

/** Each slug an echoed string member slugs to, from the first such member. */
const echoedSlugs = (
  body: JsonObject,
  echoed: ReadonlySet<string>,
): Map<string, string> => {
  const slugs = new Map<string, string>();
  for (const member of echoed) {
    const sent = body[member];
    if (typeof sent === "string" && !slugs.has(slugOf(sent)))
      slugs.set(slugOf(sent), member);
  }
  return slugs;
};

/** A reference an earlier call showed for a field this call left as it was, when the call names the entity the field repeats through its member. */
const keptReference = (
  evidence: UpdateEvidence,
  field: string,
): FieldRule | undefined => {
  const known = evidence.references?.find((rule) => rule.field === field);
  if (known === undefined || evidence.named === undefined) return undefined;
  const shown = referenceRule(
    field,
    evidence.after[field],
    evidence.call.body,
    evidence.named,
  );
  return shown?.member === known.member && shown.type === known.type
    ? known
    : undefined;
};

/** Explain an update: echoed members, fixed members whose stored value is constant, and the changes it made unsent. */
export const explainUpdate = (
  evidence: UpdateEvidence,
): {
  readonly rules: FieldRule[];
  readonly body: WriteBody;
  readonly unexplained: string[];
  /** Unsent clocks left as they were in the call's own second, which the call cannot show it stamps. */
  readonly unstamped: string[];
} => {
  const { body } = evidence.call;
  const rules: FieldRule[] = [];
  const echoed = new Set<string>();
  const unexplained: string[] = [];
  // A member the application replaces with a value it generates is accepted with any value.
  const generated = new Set<string>();
  let identity: string | null = null;
  // Two clocks sent back unchanged in the call's second cannot both be ones it stamps anew, as a whole-object PUT shows.
  const held = Object.keys(body).filter(
    (member) =>
      member !== evidence.idField && heldClock(evidence, member, body[member]!),
  );
  for (const [member, sent] of Object.entries(body)) {
    // The identity is the entity's key: the path's id repeated is the identity member; another value is one the application ignored, or used to re-key the entity, which no rule models.
    if (member === evidence.idField) {
      if (scalarText(sent) === evidence.id) identity = member;
      else if (!same(evidence.after[member], evidence.before[member]))
        unexplained.push(member);
      continue;
    }
    if (!Object.hasOwn(evidence.after, member)) continue;
    const rule = sentRule(evidence, member, held);
    rules.push(rule);
    if (rule.rule === "echo") echoed.add(member);
    else if (rule.rule !== "constant") generated.add(member);
  }
  // Serving keeps every field an update does not write, so one a read shows the update removed is a change no rule models.
  if (evidence.readFields !== undefined)
    for (const field of Object.keys(evidence.before))
      if (
        evidence.readFields.includes(field) &&
        !Object.hasOwn(evidence.after, field)
      )
        unexplained.push(field);
  const slugs = echoedSlugs(body, echoed);
  for (const field of Object.keys(evidence.after)) {
    if (
      Object.hasOwn(body, field) ||
      (!Object.hasOwn(evidence.before, field) &&
        !(evidence.shown ?? []).includes(field))
    )
      continue;
    if (same(evidence.before[field], evidence.after[field])) {
      const kept = keptReference(evidence, field);
      if (kept !== undefined) rules.push(kept);
      continue;
    }
    const rule = changeRule(evidence, field, slugs);
    if (rule === undefined) unexplained.push(field);
    else rules.push(rule);
  }
  rules.push(...pairedStamps(evidence, rules));
  // A member a reference reads names an entity, which any held one may be.
  for (const rule of rules)
    if (rule.rule === "reference") echoed.add(rule.member);
  // Serving renews one UUID alike in every field, so the call must have.
  unexplained.push(...unexplainedRenewals(rules, evidence));
  const pinned = unreferenced(rules, pinnedEchoes(evidence.after, body));
  const shaped = bodyOf(
    Object.fromEntries(
      Object.entries(body).filter(([member]) => member !== identity),
    ),
    new Set([...echoed, ...generated].filter((member) => !pinned.has(member))),
    evidence.method === "PUT"
      ? Object.keys(body).filter((member) => member !== identity)
      : [],
  );
  return {
    rules,
    body: { ...shaped, identity },
    unexplained,
    unstamped: sameSecondClocks(evidence),
  };
};

/**
 * How a write's response carries the entity it wrote: an object with the type's identity field
 * equal to the id (entity), the id alone at the root or in one member (identity), nothing
 * (empty), or anything else (recorded).
 */
export const responseShapeOf = (
  ordinal: number,
  body: JsonValue | undefined,
  empty: boolean,
  entity: { readonly idField: string; readonly id: string },
): WriteResponse => {
  if (empty) return { ordinal, shape: "empty", pointer: null };
  if (body === undefined) return { ordinal, shape: "recorded", pointer: null };
  const located = locateItem(body, entity.id);
  if (located?.keys.includes(entity.idField) === true)
    return { ordinal, shape: "entity", pointer: located.pointer };
  if (scalarText(body) === entity.id)
    return { ordinal, shape: "identity", pointer: "" };
  if (isObject(body)) {
    const members = Object.entries(body).filter(
      ([, value]) => scalarText(value) === entity.id,
    );
    if (members.length === 1)
      return {
        ordinal,
        shape: "identity",
        pointer: pointerTo(members[0]![0]),
      };
  }
  return { ordinal, shape: "recorded", pointer: null };
};

/** Order two field values as numbers, instants or text; undefined when they are not comparable. */
export const compareValues = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): number | undefined => {
  const [a, b] = [integerOf(left), integerOf(right)];
  if (a !== undefined && b !== undefined) return a - b;
  const [c, d] = [readClock(left), readClock(right)];
  if (c !== undefined && d !== undefined)
    return c.ms - d.ms || c.subMillisecond - d.subMillisecond;
  return typeof left === "string" && typeof right === "string"
    ? compare(left, right)
    : undefined;
};

/** Whether the members are strictly ordered by the field in the direction. */
const orderedBy = (
  members: readonly JsonObject[],
  field: string,
  direction: "ascending" | "descending",
): boolean =>
  members.every((member, index) => {
    if (index === 0) return true;
    const order = compareValues(members[index - 1]![field], member[field]);
    return (
      order !== undefined && (direction === "ascending" ? order < 0 : order > 0)
    );
  });

/** A version 4 UUID, which is random and so orders nothing. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Whether a collection's identities order nothing: version 4 UUIDs, or values every creation clock
 * lists in another order. Time-ordered ids (ObjectId, ULID, TSID, version 7 UUIDs) follow a clock.
 */
export const randomIdentities = (
  members: readonly JsonObject[],
  idField: string,
  clocks: readonly string[],
): boolean => {
  const ids = members.map((member) => scalarText(member[idField]) ?? "");
  if (ids.length > 0 && ids.every((id) => UUID_V4.test(id))) return true;
  if (members.length < 2 || clocks.length === 0) return false;
  const byId = members.toSorted(
    (left, right) => compareValues(left[idField], right[idField]) ?? 0,
  );
  return clocks.every((clock) =>
    byId.some(
      (member, index) =>
        index > 0 &&
        (compareValues(byId[index - 1]![clock], member[clock]) ?? 1) > 0,
    ),
  );
};

/**
 * Insert rules consistent with a collection's recorded order: sorted by identity or clock fields when
 * shown, then last and first. Sorts by a field of random values come after last, since they order
 * nothing until a read shows a create placed by them; when the other sorts place the created entity
 * differently, none is claimed before last.
 */
export const insertCandidates = (
  members: readonly JsonObject[],
  fields: readonly string[],
  placing: { readonly random?: string; readonly created?: JsonObject } = {},
): InsertRule[] => {
  const sorted: InsertRule[] = [];
  if (members.length >= 2)
    for (const field of fields)
      for (const direction of ["ascending", "descending"] as const)
        if (orderedBy(members, field, direction))
          sorted.push({ rule: "sorted", field, direction });
  const byRandom = (rule: InsertRule) =>
    rule.rule === "sorted" && rule.field === placing.random;
  const early = sorted.filter((rule) => !byRandom(rule));
  const { created } = placing;
  const tied =
    created !== undefined &&
    new Set(early.map((rule) => insertIndex(rule, members, created))).size > 1;
  return [
    ...(tied ? [] : early),
    { rule: "last" },
    ...(tied ? early : []),
    ...sorted.filter(byRandom),
    { rule: "first" },
  ];
};

/** Where an entity with these fields enters a collection under an insert rule. */
export const insertIndex = (
  rule: InsertRule,
  members: readonly JsonObject[],
  fields: JsonObject,
): number => {
  if (rule.rule !== "sorted") return rule.rule === "first" ? 0 : members.length;
  const index = members.findIndex((member) => {
    const order = compareValues(fields[rule.field], member[rule.field]);
    return (
      order !== undefined &&
      (rule.direction === "ascending" ? order < 0 : order > 0)
    );
  });
  return index < 0 ? members.length : index;
};

/** The object in a document value, at the root or in one member, that holds most of a body's members. */
export const documentPointerOf = (
  value: JsonValue,
  body: JsonObject,
): string | undefined => {
  const members = Object.keys(body);
  const candidates: [string, JsonValue][] = [
    ["", value],
    ...(isObject(value)
      ? Object.entries(value).map(([name, item]): [string, JsonValue] => [
          pointerTo(name),
          item,
        ])
      : []),
  ];
  let best: { readonly pointer: string; readonly shared: number } | undefined;
  for (const [pointer, candidate] of candidates) {
    if (!isObject(candidate)) continue;
    const shared = members.filter((member) =>
      Object.hasOwn(candidate, member),
    ).length;
    if (shared > 0 && (best === undefined || shared > best.shared))
      best = { pointer, shared };
  }
  return best?.pointer;
};
