import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { readPyzArchive, MAX_PYZ_TABLE_BYTES } from "./PyzArchive.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { PYTHON_39_MAGIC, pyzArchive } from "./CArchive.fixture.js";

it("lists modules from a supported PYZ and leaves an unknown magic opaque", async () => {
  const body = Buffer.from("module");
  const parsed = await readImage(
    pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [{ name: "json.decoder", typeCode: 0, body }],
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.value.kind !== "entries") return;
  expect(parsed.value.pythonVersion).toBe("3.9");
  expect(parsed.value.entries).toMatchObject([
    { name: "json.decoder", typeCode: 0, package: false },
  ]);

  const opaque = await readImage(
    pyzArchive({
      magic: Buffer.alloc(4),
      modules: [{ name: "json.decoder", typeCode: 0, body }],
    }),
  );
  expect(opaque.ok).toBe(true);
  if (!opaque.ok || opaque.value.kind !== "opaque") return;
  expect(Buffer.compare(opaque.value.pythonMagic, Buffer.alloc(4))).toBe(0);
  expect(opaque.value.limitation).toContain("left opaque");
});

it("leaves a PYZ opaque when the table uses an unsupported marshal type", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [],
    toc: Buffer.from([0x4e]),
  });
  const parsed = await readImage(image);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.value.kind !== "opaque") return;
  expect(parsed.value.limitation).toContain("left opaque");
  expect(parsed.value.pythonMagic).toEqual(PYTHON_39_MAGIC);
});

it("reports an entry that extends outside the PYZ as an integrity error", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [{ name: "missing", typeCode: 0, body: Buffer.from("x") }],
  });
  image.writeInt32LE(100_000, image.length - 4);
  const parsed = await readImage(image);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.error.reason).toBe("integrity");
});

it("rejects an oversized sparse PYZ table before allocating its bytes", async () => {
  const root = await createTestTempDirectory("rea-pyz-table-budget-");
  const path = join(root, "image.pyz");
  const header = Buffer.alloc(12);
  header.write("PYZ\0");
  PYTHON_39_MAGIC.copy(header, 4);
  header.writeUInt32BE(12, 8);
  await writeFile(path, header);
  const handle = await open(path, "r+");
  try {
    const size = 12 + MAX_PYZ_TABLE_BYTES + 1;
    await handle.truncate(size);
    expect(await readPyzArchive(handle, 0, size)).toMatchObject({
      ok: false,
      error: { reason: "limit" },
    });
  } finally {
    await handle.close();
  }
});

it("rejects a PYZ table whose back-references repeat one long row", async () => {
  // One namespace row with a 16 KiB name, flagged for reference, then 999
  // back-references to it. The table is about 21 KiB but would expand to
  // 16 MiB of entry names.
  const name = Buffer.alloc(16 * 1024, 0x61);
  const refs = 1_000;
  const row = Buffer.concat([
    Buffer.from([0x28 | 0x80]),
    int32(2),
    Buffer.from([0x61]),
    int32(name.length),
    name,
    Buffer.from([0x29, 3, 0x69]),
    int32(3),
    Buffer.from([0x69]),
    int32(0),
    Buffer.from([0x69]),
    int32(0),
  ]);
  const reference = Buffer.concat([Buffer.from([0x72]), int32(0)]);
  const table = Buffer.concat([
    Buffer.from([0x5b]),
    int32(refs),
    row,
    ...Array.from({ length: refs - 1 }, () => reference),
  ]);
  const header = Buffer.alloc(12);
  header.write("PYZ\0");
  PYTHON_39_MAGIC.copy(header, 4);
  header.writeUInt32BE(12, 8);
  const image = Buffer.concat([header, table]);
  expect(image.length).toBeLessThan(32 * 1024);

  const parsed = await readImage(image);
  expect(parsed).toMatchObject({ ok: false, error: { reason: "limit" } });
  if (parsed.ok) return;
  expect(parsed.error.message).toContain("expand past");
});

const int32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
};

const readImage = async (bytes: Buffer) => {
  const root = await createTestTempDirectory("rea-pyz-file-");
  const path = join(root, "image.pyz");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await readPyzArchive(handle, 0, bytes.length);
  } finally {
    await handle.close();
  }
};
