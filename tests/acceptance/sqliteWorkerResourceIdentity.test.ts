import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { SQLITE_NATIVE_LIMITS_AVAILABLE } from "../fixtures/sqlite/database.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "retains the selected database path on worker resource refusals through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-worker-resource-");
    const path = join(root, "selected.db");
    const producer = new DatabaseSync(path);
    try {
      producer.exec(
        "CREATE TABLE records(id INTEGER PRIMARY KEY, payload BLOB)",
      );
      producer
        .prepare("INSERT INTO records(payload) VALUES (?)")
        .run(Buffer.alloc(9 * 1024 * 1024, 7));
    } finally {
      producer.close();
    }
    const cliResult = await cli.run({
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "records",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const { call } = await connectLocalToolsMcp();
    const mcpResult = await call("inspect_sqlite_database", {
      path,
      table: "records",
    });
    const expectedError = {
      code: "resource_constraint",
      category: "resource_constraint",
      details: {
        operation: "inspect_sqlite_database",
        resource: "transport",
        diagnostics: { selected_path: path },
        reported_limits: {
          sqlite_value_or_record_bytes: 16 * 1024 * 1024,
          worker_reply_bytes: 16 * 1024 * 1024,
        },
      },
    };
    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.json).toMatchObject(expectedError);
    expect(parseMcpToolError(mcpResult).error).toMatchObject(expectedError);
  },
);
