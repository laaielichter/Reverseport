import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { createCli } from "../../src/cli.js";
import { compareEvidenceBundlesCommand } from "../../src/application/EvidenceBundleCommands.js";
import {
  readEvidenceBundle,
  readImmutableEvidenceBundle,
  writeEvidenceBundle,
} from "../../src/application/EvidenceBundleFiles.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { bundleComparisonResultSchema } from "../../src/domain/bundleComparison.js";
import { processEvidence } from "../../src/application/ReconstructionObligationLedger.fixture.js";
import { processCaptureSchema } from "../../src/domain/process/processCapture.js";
import * as evidenceBundleDomain from "../../src/domain/evidenceBundle.js";
import * as evidenceDomain from "../../src/domain/evidence.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const unexpectedBundleFailures = [
  new TypeError("bundle authentication TypeError"),
  new Error("bundle authentication Error"),
] as const;

const spyOnBundleParse = (failure: Error): void => {
  const parser = vi
    .spyOn(evidenceBundleDomain.evidenceBundleSchema, "parse")
    .mockImplementation(() => {
      throw failure;
    });
  onTestFinished(() => parser.mockRestore());
};

const validBundleFile = async (directory: string, name = "bundle.json") => {
  const path = join(directory, name);
  const bundle = evidenceBundleDomain.createEvidenceBundle([processEvidence()]);
  await writeFile(path, evidenceBundleDomain.serializeEvidenceBundle(bundle));
  return { bundle, path };
};

it.each([
  new TypeError("capture validation implementation failed"),
  new Error("capture validator failed"),
  new z.ZodError([
    { code: "custom", path: [], message: "capture refinement failed" },
  ]),
])(
  "preserves unexpected process validation failures while reading a bundle: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-capture-failure-",
    );
    const path = join(directory, "bundle.json");
    await writeFile(
      path,
      evidenceBundleDomain.serializeEvidenceBundle(
        evidenceBundleDomain.createEvidenceBundle([processEvidence()]),
      ),
    );
    const validator = vi
      .spyOn(processCaptureSchema, "safeParse")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => validator.mockRestore());

    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);

it.each(unexpectedBundleFailures)(
  "preserves unexpected bundle authentication failures in mutable and immutable readers: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-reader-failure-",
    );
    const { path } = await validBundleFile(directory);
    spyOnBundleParse(failure);

    await expect(readEvidenceBundle(path)).rejects.toBe(failure);
    await expect(readImmutableEvidenceBundle(path)).rejects.toBe(failure);
    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);

it.each(unexpectedBundleFailures)(
  "does not publish output or retain resources when bundle authentication throws: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-write-failure-",
    );
    const { bundle } = await validBundleFile(directory, "input.json");
    const outputPath = join(directory, "output.json");
    const resources = new ArtifactResourceScope();
    onTestFinished(async () => {
      await resources.close();
    });
    spyOnBundleParse(failure);

    await expect(
      writeEvidenceBundle(bundle, outputPath, false, resources),
    ).rejects.toBe(failure);
    expect(await readdir(directory)).toEqual(["input.json"]);
    expect(resources.hasPending).toBe(false);
    await resources.close();
  },
);

it.each(unexpectedBundleFailures)(
  "preserves unexpected bundle authentication failures through SDK import: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-import-failure-",
    );
    const { path } = await validBundleFile(directory);
    const session = createTestBinarySession(() => {
      throw new Error("Evidence import must not launch a provider");
    });
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "bundle-import-failure", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    spyOnBundleParse(failure);
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const response = await client.callTool({
        name: "import_evidence_bundle",
        arguments: { path },
      });
      expect(response).toMatchObject({
        isError: true,
        content: [{ type: "text", text: failure.message }],
      });
      expect(response.structuredContent).toBeUndefined();
      expect(session.exportEvidenceBundle().records).toEqual([]);
      expect(session.exportEvidenceBundle().unknowns).toEqual([]);
    } finally {
      await Promise.allSettled([
        client.close(),
        server.close(),
        session.close(),
      ]);
    }
  },
);

it.each(unexpectedBundleFailures)(
  "preserves the session ledger when bundle authentication throws: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-ledger-import-failure-",
    );
    const { bundle } = await validBundleFile(directory);
    const existing = evidenceDomain.createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: {},
        result: { retained: true },
      },
    );
    const session = createTestBinarySession(() => {
      throw new Error("Evidence import must not launch a provider");
    });
    onTestFinished(async () => {
      await session.close();
    });
    expect(session.recordEvidence(existing).ok).toBe(true);
    const before = session.exportEvidenceBundle();
    spyOnBundleParse(failure);

    expect(() => session.importEvidenceBundle(bundle)).toThrow(failure);
    expect(session.exportEvidenceBundle()).toEqual(before);
  },
);

it.each(unexpectedBundleFailures)(
  "propagates unexpected standalone-record classification failures: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-classifier-failure-",
    );
    const path = join(directory, "record.json");
    const record = processEvidence();
    await writeFile(path, JSON.stringify(record));
    const parser = vi
      .spyOn(evidenceDomain, "parseEvidence")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => parser.mockRestore());

    await expect(readImmutableEvidenceBundle(path)).rejects.toBe(failure);
  },
);

it.each([
  new TypeError("comparison output invariant failed"),
  new RangeError("comparison computation failed"),
  new z.ZodError([
    { code: "custom", path: ["status"], message: "invalid generated result" },
  ]),
])(
  "keeps an internal comparison failure distinct from damaged Evidence: $name",
  async (failure) => {
    const directory = await createTestTempDirectory(
      "rea-bundle-compute-failure-",
    );
    const path = join(directory, "bundle.json");
    await writeFile(
      path,
      evidenceBundleDomain.serializeEvidenceBundle(
        evidenceBundleDomain.createEvidenceBundle([]),
      ),
    );
    // Reach output validation through the actual command, reader, authentication
    // and comparison. This fault is generated output, not the caller's bundle.
    const output = vi
      .spyOn(bundleComparisonResultSchema, "parse")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => output.mockRestore());

    const originalExitCode = process.exitCode;
    onTestFinished(() => {
      process.exitCode = originalExitCode;
    });
    process.exitCode = 0;
    let stdout = "";
    let exitCode = 0;
    await createCli({}).serve(["compare", path, path, "--json"], {
      env: {},
      stdout: (chunk) => {
        stdout += chunk;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
    expect(exitCode || Number(process.exitCode ?? 0)).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      code: "UNKNOWN",
      message: failure.message,
    });
    await expect(
      compareEvidenceBundlesCommand({ leftPath: path, rightPath: path }),
    ).rejects.toBe(failure);
  },
);
