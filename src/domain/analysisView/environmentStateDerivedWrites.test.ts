import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  BOOKMARK_ROWS,
  FIXED_HELD_TAG_ROWS,
  FIXED_SIBLING_TAG_ROWS,
  FOLDER_ROWS,
  goClock,
  LATER_FIXED_SIBLING_TAG_ROWS,
  MIDDLE_FIXED_TAG_UPDATE_ROWS,
  MIXED_WIDTH_TAG_UPDATE_ROWS,
  restoredAddressRows,
  TAG_ROWS,
  TAG_UPDATE_ROWS,
  TWO_CLOCK_TAG_UPDATE_ROWS,
  UNKNOWN_TAG_UPDATE_ROWS,
} from "../../../tests/fixtures/environmentStateDerivedValues.js";
import {
  environmentStateViewOf,
  numberedUuid,
} from "../../../tests/fixtures/environmentStateWrites.js";
import type { JsonValue } from "../jsonValue.js";
import { isObject, type JsonObject } from "./environmentStateRules.js";

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error(`No plan for ${tool}`);
  return plan;
};

const TRIMMED = {
  kind: "iso",
  separator: "T",
  fraction: 9,
  zone: "Z",
  trimmed: true,
} as const;

describe("later creates must retain the learned value rules", () => {
  it("withholds a later create whose captured composed address is null", () => {
    const snapshot = null;
    const rows = BOOKMARK_ROWS.slice(0, 6).map(
      (row, index): TimedCaptureRow => {
        if (index !== 5) return row;
        const [method, path, body, ...rest] = row;
        if (!isObject(body)) throw new Error("Expected a bookmark response");
        return [
          method,
          path,
          { ...body, web_archive_snapshot_url: snapshot },
          ...rest,
        ];
      },
    );
    expect(planOf(rows, "post_bookmarks")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it.each([
    {
      name: "a string integer becomes a UUID",
      exemplar: String,
      later: numberedUuid(888),
    },
    {
      name: "a string integer becomes an equal-length token",
      exemplar: String,
      later: "a656166745726976",
    },
    {
      name: "a UUID becomes an equal-length opaque token",
      exemplar: (id: number) => numberedUuid(400 + (id % 1000)),
      later: "a".repeat(35) + "1",
    },
  ])("withholds a create when $name", ({ exemplar, later }) => {
    const changed = (value: JsonValue): JsonValue =>
      Array.isArray(value)
        ? value.map(changed)
        : isObject(value)
          ? Object.fromEntries(
              Object.entries(value).map(([field, child]) => [
                field,
                field === "id" && typeof child === "number"
                  ? child === 1656166745726976
                    ? later
                    : exemplar(child)
                  : changed(child),
              ]),
            )
          : value;
    const rows = FOLDER_ROWS.map((row): TimedCaptureRow => {
      const [method, path, body, ...rest] = row;
      return body === undefined ? row : [method, path, changed(body), ...rest];
    });
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });
});

describe("clock spellings an application derives", () => {
  it("serves creates whose clocks drop trailing fraction zeros, as Go spells nanoseconds", () => {
    expect(planOf(TAG_ROWS, "post_tags")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });

  it.each([
    ["2026-10-01T09:00:00.12345678Z", "2026-10-01T10:00:00.120000000Z"],
    ["2026-10-01T09:00:00.120000000Z", "2026-10-01T10:00:00.12345678Z"],
    ["2026-10-01T09:00:00.12345678Z", "2026-10-01T10:00:00.123456780Z"],
    ["2026-10-01T09:00:00.123456780Z", "2026-10-01T10:00:00.12345678Z"],
  ])(
    "keeps a create's clock at a fixed width when a held value ends its fraction in a zero (%s, %s)",
    (first, second) => {
      const held = [first, second].map((updatedAt, index) => ({
        id: numberedUuid(index + 1),
        name: `Held ${index + 1}`,
        updatedAt,
      }));
      const created = {
        id: numberedUuid(3),
        name: "Heavy",
        updatedAt: goClock(3, "374763655"),
      };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/tags", held],
        ...held.map((tag): TimedCaptureRow => [
          "GET",
          `/api/tags/${tag.id}`,
          tag,
        ]),
        ["POST", "/api/tags", created, 201, { name: "Heavy" }],
        ["GET", `/api/tags/${created.id}`, created],
      ];
      expect(planOf(rows, "post_tags").rules).toContainEqual({
        field: "updatedAt",
        rule: "clock",
        format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
      });
    },
  );

  it("keeps a create's sibling clock at a fixed width when a later call trims one clock and shows the sibling's trailing zero", () => {
    const rules = planOf(FIXED_SIBLING_TAG_ROWS, "post_tags").rules;
    expect(rules).toContainEqual({
      field: "updatedAt",
      rule: "clock",
      format: TRIMMED,
    });
    expect(rules).toContainEqual({
      field: "createdAt",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
    });
  });

  it("serves updates whose clock a later call shows trimmed", () => {
    expect(planOf(TAG_UPDATE_ROWS, "patch_tags_by_uuid")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });

  it("learns no clock spelling from an update to an entity an unmodelled write left unknown", () => {
    expect(planOf(UNKNOWN_TAG_UPDATE_ROWS, "patch_tags_by_uuid")).toMatchObject(
      {
        served: true,
        rules: expect.arrayContaining([
          {
            field: "updatedAt",
            rule: "clock",
            format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
          },
        ]),
      },
    );
  });

  it("serves updates whose two clocks a later call shows trimmed for one only", () => {
    expect(
      planOf(TWO_CLOCK_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
        { field: "syncedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });
});

describe("fixed-width clock evidence", () => {
  const FIXED = {
    kind: "iso",
    separator: "T",
    fraction: 9,
    zone: "Z",
  } as const;

  it.each([1, 2])(
    "withholds a shorter update clock when held entity %s proves a fixed width",
    (heldId) => {
      const fixedHeld = (value: JsonValue): JsonValue =>
        Array.isArray(value)
          ? value.map(fixedHeld)
          : isObject(value) && value.id === numberedUuid(heldId)
            ? { ...value, updatedAt: "2026-10-01T09:00:00.120000000Z" }
            : value;
      const rows = TAG_UPDATE_ROWS.map((row, index): TimedCaptureRow => {
        const [method, path, body, ...rest] = row;
        return index < 3 && body !== undefined
          ? [method, path, fixedHeld(body), ...rest]
          : row;
      });
      expect(planOf(rows, "patch_tags_by_uuid")).toMatchObject({
        served: false,
        reason: "unexplained-change",
        rules: expect.arrayContaining([
          { field: "updatedAt", rule: "clock", format: FIXED },
        ]),
      });
    },
  );

  it("serves updates whose later call trims one clock and shows the other's trailing zero", () => {
    expect(
      planOf(MIXED_WIDTH_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
        { field: "syncedAt", rule: "clock", format: FIXED },
      ]),
    });
  });

  it("keeps a create's clock at a fixed width an earlier later call showed, whatever a third shows", () => {
    expect(
      planOf(LATER_FIXED_SIBLING_TAG_ROWS, "post_tags").rules,
    ).toContainEqual({ field: "createdAt", rule: "clock", format: FIXED });
  });

  it("keeps a create's clock at a fixed width a held entity showed while its sibling is learned trimmed", () => {
    const rules = planOf(FIXED_HELD_TAG_ROWS, "post_tags").rules;
    expect(rules).toContainEqual({
      field: "updatedAt",
      rule: "clock",
      format: TRIMMED,
    });
    expect(rules).toContainEqual({
      field: "createdAt",
      rule: "clock",
      format: FIXED,
    });
  });

  it("withholds updates whose clock a later call trims after an earlier one showed a trailing zero", () => {
    expect(
      planOf(MIDDLE_FIXED_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: false,
      reason: "unexplained-change",
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: FIXED },
      ]),
    });
  });
});

describe("values an application composes or generates", () => {
  it("withholds bookmark creates a later call answers with a snapshot address the composition does not spell", () => {
    const special = "https://web.archive.org/web/special";
    const rows = BOOKMARK_ROWS.flatMap((row): TimedCaptureRow[] => {
      const [method, path, body, ...rest] = row;
      if (method === "GET" && path === "/api/bookmarks/4") return [];
      return method === "POST" && isObject(body) && body.id === 4
        ? [
            [
              method,
              path,
              { ...body, web_archive_snapshot_url: special },
              ...rest,
            ],
          ]
        : [row];
    }).slice(0, -1);
    expect(planOf(rows, "post_bookmarks")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("serves creates whose snapshot address joins the creation time and the sent URL, accepting any URL", () => {
    expect(planOf(BOOKMARK_ROWS, "post_bookmarks")).toMatchObject({
      served: true,
      body: { accepted: ["url", "title"], fixed: [] },
      rules: expect.arrayContaining([
        {
          field: "web_archive_snapshot_url",
          rule: "composed",
          parts: [
            { text: "https://web.archive.org/web/" },
            { from: "date_added", as: "clock", pattern: "YYYYMMDDhhmmss" },
            { text: "/" },
            { from: "url", as: "value" },
          ],
        },
      ]),
    });
  });

  it("serves folder creates and renames whose address follows the uid and the title's slug, and whose numeric id is generated", () => {
    const url = {
      field: "url",
      rule: "composed",
      parts: [
        { text: "/dashboards/f/" },
        { from: "uid", as: "value" },
        { text: "/" },
        { from: "title", as: "slug" },
      ],
    };
    expect(planOf(FOLDER_ROWS, "post_folders")).toMatchObject({
      served: true,
      body: { accepted: ["uid", "title"], fixed: [] },
      rules: expect.arrayContaining([{ field: "id", rule: "unique" }, url]),
    });
    expect(planOf(FOLDER_ROWS, "put_folders_by_uuid")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([url]),
    });
  });

  it("withholds renames whose address a later call composes when an earlier call left it otherwise", () => {
    expect(
      planOf(restoredAddressRows(true), "put_folders_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "url", rule: "composed" }),
      ]),
    });
    // The first rename left its address as it was, which the composition would rebuild.
    expect(
      planOf(restoredAddressRows(false), "put_folders_by_uuid"),
    ).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it.each([null, { path: "/legacy" }])(
    "withholds a later composition whose parts an earlier rename could not spell (%j)",
    (base) => {
      const first = { id: 1, title: "First Folder", base, url: "/legacy" };
      const renamedFirst = { ...first, title: "Renamed First Folder" };
      const second = {
        id: 2,
        title: "Second Folder",
        base: "https://example.test/folders",
        url: "https://example.test/folders/second-folder",
      };
      const renamedSecond = {
        ...second,
        title: "Renamed Second Folder",
        url: "https://example.test/folders/renamed-second-folder",
      };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/folders", [first, second]],
        ["GET", "/api/folders/1", first],
        ["GET", "/api/folders/2", second],
        [
          "PUT",
          "/api/folders/1",
          renamedFirst,
          200,
          { title: renamedFirst.title },
        ],
        ["GET", "/api/folders/1", renamedFirst],
        [
          "PUT",
          "/api/folders/2",
          renamedSecond,
          200,
          { title: renamedSecond.title },
        ],
        ["GET", "/api/folders/2", renamedSecond],
      ];
      expect(planOf(rows, "put_folders_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );
});

/** The folder rows with each folder's numeric id repeated where `mirror` puts it, and in each create's body when `sent`. */
const mirrored = (
  mirror: (id: number) => JsonObject,
  sent = false,
): TimedCaptureRow[] => {
  const repeated = (value: JsonValue): JsonValue =>
    Array.isArray(value)
      ? value.map(repeated)
      : isObject(value) && typeof value.id === "number"
        ? { ...value, ...mirror(value.id) }
        : value;
  return FOLDER_ROWS.map((row): TimedCaptureRow => {
    const [method, path, body, ...rest] = row;
    if (body === undefined) return row;
    const answered = repeated(body);
    const [status, request] = rest;
    return sent &&
      method === "POST" &&
      isObject(answered) &&
      status !== undefined &&
      isObject(request)
      ? [
          method,
          path,
          answered,
          status,
          { ...request, ...mirror(Number(answered.id)) },
        ]
      : [method, path, answered, ...rest];
  });
};

describe("generated integers another field repeats", () => {
  it("withholds folder creates a later call answers with a UUID where the exemplar generated an integer", () => {
    const later = 1656166745726976;
    const answered = numberedUuid(203);
    const swap = (value: JsonValue): JsonValue =>
      Array.isArray(value)
        ? value.map(swap)
        : isObject(value) && value.id === later
          ? { ...value, id: answered }
          : value;
    const rows = FOLDER_ROWS.map((row): TimedCaptureRow => {
      const [method, path, body, ...rest] = row;
      return body === undefined ? row : [method, path, swap(body), ...rest];
    });
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("withholds folder creates whose generated numeric id another field repeats, which seeding cannot keep", () => {
    expect(
      planOf(
        mirrored((id) => ({ folderId: id })),
        "post_folders",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it("withholds folder creates whose generated numeric id a number nested in another field repeats", () => {
    expect(
      planOf(
        mirrored((id) => ({ metadata: { serial: id } })),
        "post_folders",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it.each([
    [
      "an echoed string of its digits",
      (id: number) => ({ serialText: String(id) }),
      true,
    ],
    [
      "a string another rule generates around its digits",
      (id: number) => ({ ref: `folder-${id}` }),
      false,
    ],
  ])(
    "withholds folder creates whose generated numeric id %s repeats",
    (_, mirror, sent) => {
      expect(planOf(mirrored(mirror, sent), "post_folders")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it("serves folder creates whose string of the id's digits a template rebuilds from it", () => {
    expect(
      planOf(
        mirrored((id) => ({ idText: String(id) })),
        "post_folders",
      ),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "id", rule: "unique" },
        { field: "idText", rule: "template", from: "id" },
      ]),
    });
  });
});
