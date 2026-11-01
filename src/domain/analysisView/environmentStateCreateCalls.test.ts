import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  HELD_FIXED_TAG_ROWS,
  TAG_ROWS,
  misshelvedRows,
  referencedCreateRows,
  shelvedRows,
} from "../../../tests/fixtures/environmentStateDerivedValues.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import { mergedCreatePlan } from "./environmentStateWriteCreateCalls.js";
import type { FieldRule } from "./environmentStateWriteRules.js";

const createPlan = (rows: readonly TimedCaptureRow[], tool = "post_books") => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error("No create plan");
  return plan;
};

const OPTIONAL_SHELF = {
  served: true,
  body: {
    accepted: ["name", "shelf"],
    required: ["name"],
    defaults: [{ member: "shelf", value: "general" }],
  },
  rules: expect.arrayContaining([{ field: "shelf", rule: "echo" }]),
};

describe("create plans learned from every call", () => {
  it("accepts a member a later create sends, stored as the earlier one's default when left out", () => {
    expect(
      createPlan(
        shelvedRows(
          { name: "Third Book" },
          { name: "Fourth Book", shelf: "rare" },
        ),
      ),
    ).toMatchObject(OPTIONAL_SHELF);
  });

  it("makes a member a later create leaves out optional, with the default that create stored", () => {
    expect(
      createPlan(
        shelvedRows(
          { name: "Third Book", shelf: "rare" },
          { name: "Fourth Book" },
        ),
      ),
    ).toMatchObject(OPTIONAL_SHELF);
  });

  it("withholds creates whose later call stores a left-out member otherwise than the default it learned", () => {
    expect(createPlan(misshelvedRows())).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it.each([
    { id: 1, name: "Different Hall", floor: "ground" },
    { id: 2, name: "Map Room", floor: "upper" },
    null,
  ])(
    "withholds a create whose sent reference contradicts its answer (%j)",
    (shelf) => {
      expect(createPlan(referencedCreateRows(shelf))).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it("accepts a later create whose sent reference agrees in a different object key order", () => {
    expect(
      createPlan(
        referencedCreateRows({ floor: "ground", name: "Main Hall", id: 1 }),
      ),
    ).toMatchObject({ served: true });
  });

  it("trims no clock a later create shows trimmed after a held entity showed it at a fixed width", () => {
    expect(createPlan(TAG_ROWS, "post_tags")).toMatchObject({ served: true });
    const plan = createPlan(HELD_FIXED_TAG_ROWS, "post_tags");
    expect(plan).toMatchObject({ served: false, reason: "unexplained-change" });
    expect(plan.rules).not.toContainEqual(
      expect.objectContaining({
        field: "updatedAt",
        format: expect.objectContaining({ trimmed: true }),
      }),
    );
  });

  it("serves no plan a later create contradicts by storing a member otherwise than sent", () => {
    expect(
      createPlan(
        shelvedRows(
          { name: "Third Book" },
          { name: "Fourth Book", shelf: "rare" },
          (sent) => sent.toUpperCase(),
        ),
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });
});

describe("merging a later create into a plan", () => {
  const body = (accepted: string[], required = accepted) => ({
    accepted,
    fixed: [],
    required,
    identity: null,
    kinds: [],
  });
  const plan = {
    rules: [
      { field: "id", rule: "identity", generator: "sequence" } as const,
      { field: "name", rule: "echo" } as const,
    ],
    body: body(["name"]),
  };
  const exemplar = { id: 3, name: "Third", shelf: "general" };
  const later = (
    overrides: Partial<Parameters<typeof mergedCreatePlan>[2]>,
  ) => ({
    entity: { id: 4, name: "Fourth", shelf: "rare" },
    body: { name: "Fourth", shelf: "rare" },
    rules: [...plan.rules, { field: "shelf", rule: "echo" } as const],
    contract: body(["name", "shelf"]),
    ...overrides,
  });

  it("refuses a field neither call rules that holds another value, or a member one fixes and the other accepts", () => {
    expect(
      mergedCreatePlan(plan, exemplar, later({ rules: plan.rules })),
    ).toBeUndefined();
    expect(
      mergedCreatePlan(
        {
          ...plan,
          body: { ...body(["name"]), fixed: [{ member: "shelf", sent: "x" }] },
        },
        exemplar,
        later({}),
      ),
    ).toBeUndefined();
  });

  const reference: FieldRule = {
    field: "shelf",
    rule: "reference",
    member: "shelf_id",
    type: "/api/shelves",
    fields: ["id", "name"],
  };
  const shelved = (id: number, name: string) =>
    later({
      entity: { id, name, shelf: { id: 1, name: "Main" } },
      body: { name, shelf_id: 1 },
      rules: [...plan.rules, reference],
      contract: body(["name", "shelf_id"]),
    });
  const unshelved = (id: number, name: string, sent: object = {}) =>
    later({
      entity: { id, name },
      body: { name, ...sent },
      rules: plan.rules,
      contract: body(["name", ...Object.keys(sent)]),
    });
  const unshelvedExemplar = { id: 3, name: "Third" };

  it("takes a reference one call alone shows when the other did not send its member", () => {
    const merged = mergedCreatePlan(
      plan,
      unshelvedExemplar,
      shelved(4, "Fourth"),
    );
    expect(merged).toMatchObject({
      rules: expect.arrayContaining([reference]),
      body: { accepted: ["name", "shelf_id"], required: ["name"] },
    });
  });

  it("keeps a reference an earlier call added through calls that leave it out, and agrees with it when it returns", () => {
    const added = mergedCreatePlan(
      plan,
      unshelvedExemplar,
      shelved(4, "Fourth"),
    )!;
    const omitted = mergedCreatePlan(
      added,
      unshelvedExemplar,
      unshelved(5, "Fifth"),
    );
    expect(omitted).toMatchObject({
      rules: expect.arrayContaining([reference]),
      body: { accepted: ["name", "shelf_id"], required: ["name"] },
    });
    expect(
      mergedCreatePlan(omitted!, unshelvedExemplar, shelved(6, "Sixth")),
    ).toMatchObject({ rules: expect.arrayContaining([reference]) });
    // A call that sends the member yet stores no shelf contradicts the reference.
    expect(
      mergedCreatePlan(
        added,
        unshelvedExemplar,
        unshelved(7, "Seventh", { shelf_id: 1 }),
      ),
    ).toBeUndefined();
  });
});
