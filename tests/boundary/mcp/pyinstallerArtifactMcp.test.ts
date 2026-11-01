import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";

import { createArtifactBinarySession } from "../../../src/composition/binary.js";
import {
  PYTHON_39_MAGIC,
  cArchiveExecutable,
  cArchiveBytecodeExecutable,
  pyzArchive,
} from "../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const assertMetadataQueries = async (
  client: Client,
  parent: Evidence,
  expectedCoverage: "complete" | "unknown",
): Promise<void> => {
  const definition = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  expect(definition?.outputSchema).toBeDefined();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = definition!.inputSchema;
  const outputSchema: Record<string, unknown> = definition!.outputSchema!;
  const input = ajv.compile(inputSchema);
  const output = ajv.compile(outputSchema);
  const ids: string[] = [];
  const selected: unknown[] = [];
  for (const offset of [0, 1, 2, 3]) {
    const args = {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: {
        kind: "inventory",
        collection: "occurrences",
        entry_kinds: ["metadata"],
        fields: ["format_metadata"],
        offset,
        limit: 1,
      },
    };
    expect(input(args), JSON.stringify(input.errors)).toBe(true);
    const reply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: args,
    });
    expect(reply.isError).not.toBe(true);
    expect(output(reply.structuredContent), JSON.stringify(output.errors)).toBe(
      true,
    );
    const evidence = parseEvidence(reply.structuredContent);
    const view = analysisViewResultSchema.parse(evidence.normalized_result);
    if (view.kind !== "inventory") throw new Error("Expected inventory page");
    expect(view.parent_evidence_id).toBe(parent.evidence_id);
    expect(evidence.evidence_links).toContain(parent.evidence_id);
    expect(view.coverage.total).toBe(3);
    expect(view.source_coverage?.status).toBe(expectedCoverage);
    if (offset < 3) {
      expect(view.items).toHaveLength(1);
      expect(view.items[0]).toMatchObject({
        artifact_id: null,
        format_metadata: { kind: "pyinstaller-entry" },
      });
      expect(view.items[0]).not.toHaveProperty("logical_path");
      const row = view.items[0];
      if (row === undefined || !("occurrence_id" in row))
        throw new Error("Expected occurrence identity");
      ids.push(row.occurrence_id);
      selected.push(row);
    } else expect(view.items).toEqual([]);
  }
  expect(new Set(ids).size).toBe(3);
  expect(selected).toEqual(
    expect.arrayContaining([
      ...[0, 1].map((index) =>
        expect.objectContaining({
          format_metadata: expect.objectContaining({
            index,
            type_code: "o",
            source_name: "pyi-contents-directory _internal",
          }),
        }),
      ),
      expect.objectContaining({
        format_metadata: expect.objectContaining({
          type_code: "d",
          source_name: "../shared/app:assets/data.bin",
          dependency_status: "unresolved",
          dependency_archive: "../shared/app",
          dependency_member: "assets/data.bin",
        }),
      }),
    ]),
  );
};

const writeExecutable = async (opaque: boolean): Promise<string> => {
  const directory = await createTestTempDirectory("rea-pyinstaller-mcp-");
  const path = join(directory, "hello");
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 312,
      pythonLibrary: "libpython3.12.so",
      members: [
        {
          name: "pyi-contents-directory _internal",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "pyi-contents-directory _internal",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "hello",
          typeCode: "s",
          payload: Buffer.from("print('hi')"),
          compress: false,
        },
        {
          name: "../shared/app:assets/data.bin",
          typeCode: "d",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: opaque ? Buffer.alloc(4) : PYTHON_39_MAGIC,
            modules: [{ name: "app", typeCode: 0, body: Buffer.from("app") }],
          }),
          compress: opaque,
        },
        ...(opaque
          ? [
              {
                name: "pyimod00_crypto_key",
                typeCode: "m",
                payload: Buffer.from("key"),
                compress: false,
              },
            ]
          : []),
      ],
    }),
  );
  return path;
};

const writeSurrogateNamespaceExecutable = async (): Promise<string> => {
  const directory = await createTestTempDirectory(
    "rea-pyinstaller-mcp-surrogate-",
  );
  const path = join(directory, "surrogate-name");
  const namespace = Buffer.concat([
    Buffer.from("node_"),
    Buffer.from("edb3bf", "hex"),
  ]);
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 39,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: namespace, typeCode: 3, body: Buffer.alloc(0) },
              { name: "healthy", typeCode: 0, body: Buffer.from("healthy") },
            ],
          }),
          compress: false,
        },
      ],
    }),
  );
  return path;
};

it.each([false, true])(
  "inventories a PyInstaller executable through inspect_artifact (opaque: %s)",
  async (opaque) => {
    const path = await writeExecutable(opaque);
    const session = await createArtifactBinarySession(process.env);
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "pyinstaller-mcp-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError).not.toBe(true);
      const inspected = await client.callTool({
        name: "inspect_artifact",
        arguments: {},
      });
      expect(inspected.isError).not.toBe(true);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(inspected.structuredContent).normalized_result,
      );
      expect(inspection.subject.root_format).toBe("pyinstaller");
      if (!opaque) expect(inspection.next_probes).toEqual([]);
      expect(
        inspection.substeps[0]?.evidence.normalized_result.coverage.status,
      ).toBe(opaque ? "unknown" : "complete");
      if (opaque)
        expect(
          inspection.substeps[0]?.evidence.normalized_result.occurrences.find(
            (row) => row.logical_path === "PYZ.pyz",
          ),
        ).toMatchObject({
          encrypted: false,
          hash_status: "verified",
          artifact_id: expect.any(String),
          format_metadata: { encryption_source: "carchive-marker" },
        });
      expect(
        inspection.substeps[0]?.evidence.normalized_result.occurrences.map(
          (occurrence) => occurrence.logical_path,
        ),
      ).toEqual(
        expect.arrayContaining([
          "hello",
          ...(opaque ? [] : ["PYZ.pyz/app.pyc"]),
        ]),
      );
      if (!opaque)
        expect(
          inspection.substeps[0]?.evidence.normalized_result.occurrences.find(
            (row) => row.logical_path === "PYZ.pyz/app.pyc",
          ),
        ).toMatchObject({
          source_path: "app",
          format_metadata: {
            container_name: "PYZ.pyz",
            source_name: "app",
          },
        });
      const parent = parseEvidence(inspected.structuredContent);
      const compact = await client.callTool({
        name: "inspect_artifact",
        arguments: { detail: "summary" },
      });
      expect(compact.isError).not.toBe(true);
      const summary = parseEvidence(
        compact.structuredContent,
      ).normalized_result;
      expect(summary).toMatchObject({
        kind: "summary",
        summary: {
          root_format_metadata: {
            kind: "pyinstaller",
            python_version_raw: 312,
            external_dependency_count: 1,
          },
          observed_entry_kind_counts: { metadata: 3 },
          source_coverage: { status: opaque ? "unknown" : "complete" },
        },
      });
      await assertMetadataQueries(
        client,
        parent,
        opaque ? "unknown" : "complete",
      );
      if (opaque) {
        const missing = await client.callTool({
          name: "inspect_analysis_view",
          arguments: {
            source: {
              kind: "retained-evidence",
              evidence_id: parent.evidence_id,
            },
            view: {
              kind: "inventory",
              collection: "occurrences",
              logical_paths: ["PYZ.pyz/app.pyc"],
              entry_kinds: ["file"],
              fields: [],
              offset: 0,
              limit: 1,
            },
          },
        });
        expect(missing.isError).not.toBe(true);
        const page = analysisViewResultSchema.parse(
          parseEvidence(missing.structuredContent).normalized_result,
        );
        expect(page).toMatchObject({
          kind: "inventory",
          items: [],
          source_coverage: { status: "unknown" },
        });
        expect(page.unknowns).toContain(
          "Producer traversal coverage is unknown; missing matches do not prove source absence.",
        );
      }
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  },
);

it("preserves legacy CArchive identities and modern bytecode derivation through inspect_artifact", async () => {
  const fixture = cArchiveBytecodeExecutable();
  const directory = await createTestTempDirectory(
    "rea-pyinstaller-mcp-bytecode-",
  );
  const path = join(directory, "bytecode-layouts");
  await writeFile(path, fixture.archive);
  const session = await createArtifactBinarySession(process.env);
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "pyinstaller-bytecode-mcp-test",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inventory = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    ).substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("complete");
    for (const module of fixture.modules) {
      const occurrence = inventory?.occurrences.find(
        (row) => row.logical_path === module.name,
      );
      expect(occurrence).toMatchObject({
        hash_status: "verified",
        format_metadata: {
          bytecode_header: module.derived ? "derived" : "unknown",
        },
      });
      expect(
        inventory?.nodes.find(
          (node) => node.artifact_id === occurrence?.artifact_id,
        ),
      ).toMatchObject({
        sha256: createHash("sha256").update(module.bytes).digest("hex"),
        size: module.bytes.length,
      });
      expect(
        inventory?.edges.find(
          (edge) => edge.occurrence_id === occurrence?.occurrence_id,
        )?.relation,
      ).toBe(module.derived ? "derived-from" : "contains");
    }
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});

it("preserves surrogatepass PYZ module names through inspect_artifact", async () => {
  const path = await writeSurrogateNamespaceExecutable();
  const session = await createArtifactBinarySession(process.env);
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "pyinstaller-surrogate-mcp-test",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("complete");
    expect(
      inventory?.occurrences.find(
        (row) => row.logical_path === "PYZ.pyz/node_\udcff",
      ),
    ).toMatchObject({
      entry_kind: "metadata",
      format_metadata: { source_name: "node_\udcff", type_code: 3 },
    });
    expect(
      inventory?.occurrences.find(
        (row) => row.logical_path === "PYZ.pyz/healthy.pyc",
      ),
    ).toMatchObject({
      entry_kind: "file",
      format_metadata: { source_name: "healthy" },
    });
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});
