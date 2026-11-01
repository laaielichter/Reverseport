import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { peCertificateFixture } from "../../../src/native/pe/PeCertificates.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("PE certificate inspection must not start a deep provider");
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  return { client, session };
};

mcpTest(
  "advertises inspect_pe_certificates and reads PKCS#7 signer identity",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const advertised = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_pe_certificates",
      );
      expect(advertised?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-pe-cert-mcp-");
      const path = join(root, "signed.exe");
      await writeFile(path, peCertificateFixture(true));
      const response = await client.callTool({
        name: "inspect_pe_certificates",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = toolContract(
        "inspect_pe_certificates",
      ).outputSchema.parse(response.structuredContent);
      expect(evidence.normalized_result.format).toBe("pe32-plus");
      expect(
        evidence.normalized_result.entries[0]?.pkcs7?.certificates[0]
          ?.serial_hex,
      ).toBe("11223344");
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "requires an absolute path for inspect_pe_certificates",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const response = await client.callTool({
        name: "inspect_pe_certificates",
        arguments: { path: "signed.exe" },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: { operation: "inspect_pe_certificates" },
      });
    } finally {
      await session.close();
    }
  },
);
