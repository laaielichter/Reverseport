import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [runtime, mode, path, expectedDigest, output] = process.argv.slice(2);
const { readStableArtifact } = await import(
  pathToFileURL(`${runtime}/dist/artifacts/readStableArtifact.js`)
);
const report = {
  mode,
  path,
  status: "running",
  node: process.version,
  memory_before: process.memoryUsage(),
};
let service;
const start = performance.now();
try {
  if (mode === "read") {
    const snapshot = await readStableArtifact(path, 256 * 1024 * 1024);
    report.read_ms = performance.now() - start;
    assert.equal(snapshot.sha256, expectedDigest);
    assert.equal(
      createHash("sha256").update(snapshot.bytes).digest("hex"),
      expectedDigest,
    );
    report.bytes = snapshot.bytes.length;
    report.sha256 = snapshot.sha256;
  } else {
    assert.equal(mode, "elf");
    const { ElfNotesService } = await import(
      pathToFileURL(
        `${runtime}/dist/application/binaryDiagnostics/ElfNotesService.js`,
      )
    );
    const { ElfNotesProvider } = await import(
      pathToFileURL(`${runtime}/dist/native/elf/ElfNotesProvider.js`)
    );
    service = new ElfNotesService(new ElfNotesProvider());
    const inspected = await service.inspect({
      path,
      max_file_bytes: 256 * 1024 * 1024,
    });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    report.evidence = inspected.value;
    assert.equal(
      report.evidence.normalized_result.artifact.sha256,
      expectedDigest,
    );
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  try {
    await service?.close();
  } catch (error) {
    report.status = "failed";
    report.cleanup_error = String(error);
    process.exitCode = 1;
  }
  report.elapsed_ms = performance.now() - start;
  report.memory_after = process.memoryUsage();
  report.process_max_rss_kib = process.resourceUsage().maxRSS;
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      mode,
      path,
      status: report.status,
      elapsed_ms: report.elapsed_ms,
      read_ms: report.read_ms,
      bytes: report.bytes,
      max_rss_kib: report.process_max_rss_kib,
      array_buffers: report.memory_after.arrayBuffers,
    }),
  );
}
