import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { readPersistedToolOutput } from "../../../scripts/lib/persisted-tool-output.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Claude Code replaces a large tool result (binary_session is about 64 KB)
// with this preview and saves the complete result to a file.
const preview = (file: string, newline = "\n") =>
  `<persisted-output>${newline}Output too large (64.2KB). Full output saved to: ${file}${newline}${newline}Preview (first 2KB):${newline}{"result":`;

it("reads the complete persisted result inside the verifier lab", async () => {
  const lab = await createTestTempDirectory("rea-persisted-output-");
  const file = join(lab, "profile space Ω", "tool-results", "toolu_rea_4.txt");
  await mkdir(join(lab, "profile space Ω", "tool-results"), {
    recursive: true,
  });
  await writeFile(file, '{"result":{"server_identity":{}}}');
  expect(readPersistedToolOutput(preview(file), lab)).toBe(
    '{"result":{"server_identity":{}}}',
  );
  expect(readPersistedToolOutput(preview(file, "\r\n"), lab)).toBe(
    '{"result":{"server_identity":{}}}',
  );
});

it("ignores a result saved outside the lab, a missing file and inline output", async () => {
  const lab = await createTestTempDirectory("rea-persisted-output-");
  const elsewhere = await createTestTempDirectory("rea-persisted-elsewhere-");
  const outside = join(elsewhere, "toolu_rea_4.txt");
  await writeFile(outside, "{}");
  expect(readPersistedToolOutput(preview(outside), lab)).toBeUndefined();
  expect(
    readPersistedToolOutput(preview(join(lab, "missing.txt")), lab),
  ).toBeUndefined();
  expect(readPersistedToolOutput('{"result":{}}', lab)).toBeUndefined();
});
