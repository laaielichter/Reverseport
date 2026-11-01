import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { SqliteDatabasePort } from "./SqliteDatabasePort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceSubjectTarget,
} from "../../domain/evidence.js";
import {
  inspectSqliteDatabaseInputSchema,
  sqliteDatabaseSchema,
  type InspectSqliteDatabaseInput,
  type SqliteDatabase,
  SQLITE_ROW_LIMIT_DEFAULT,
  DEFAULT_SQLITE_WORKER_TIMEOUT_MS,
  sqliteSchemaHasObjectDeclaration,
  sqliteSchemaScope,
  sqliteInspectionParameters,
} from "../../domain/sqlite/sqliteDatabase.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";

const OPERATION = "inspect_sqlite_database";

const matchesSelectedSchema = (
  schema: SqliteDatabase["schema"],
  table: string,
): boolean =>
  sqliteSchemaHasObjectDeclaration(table)
    ? schema.tables.length === 1 &&
      schema.tables[0]?.name === table &&
      schema.indexes.every((index) => index.table === table) &&
      schema.triggers.every((trigger) => trigger.table === table) &&
      schema.views.length === 0
    : schema.tables.length === 0 &&
      schema.indexes.length === 0 &&
      schema.views.length === 0 &&
      schema.triggers.length === 0;

const matchesSelectedDatabase = (
  report: SqliteDatabase,
  input: InspectSqliteDatabaseInput,
  subject: EvidenceSubjectTarget,
): boolean =>
  report.artifact.path === input.path &&
  subject.path === input.path &&
  subject.sha256 === report.artifact.sha256 &&
  subject.format === "file" &&
  // Fresh executions must report known settings; only historical parsing permits omission.
  report.worker_timeout_ms ===
    (input.worker_timeout_ms ?? DEFAULT_SQLITE_WORKER_TIMEOUT_MS) &&
  (report.wal === null || report.wal.path === `${input.path}-wal`) &&
  report.schema.scope === sqliteSchemaScope(input) &&
  (report.schema.scope !== "selected_table" ||
    (input.table !== undefined &&
      matchesSelectedSchema(report.schema, input.table))) &&
  (input.table === undefined
    ? report.rows === null
    : report.rows?.table === input.table &&
      report.rows.row_limit === (input.row_limit ?? SQLITE_ROW_LIMIT_DEFAULT) &&
      (input.columns === undefined ||
        (report.rows.columns.length === input.columns.length &&
          report.rows.columns.every(
            (name, index) => name === input.columns?.[index],
          ))));

/** Shared snapshot inspection and caller-selection validation for CLI and MCP. */
export class SqliteDatabaseService {
  constructor(readonly provider: SqliteDatabasePort) {}

  /** Await provider shutdown, retaining failed cleanup owners for retry. */
  close(): Promise<void> {
    return this.provider.close?.() ?? Promise.resolve();
  }

  /** Inspect an explicit database snapshot and preserve its original database/WAL identity. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(
        new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        }),
      );
    const input = inspectSqliteDatabaseInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    const inspected = await this.provider.inspect(input.data, options);
    if (!inspected.ok) return inspected;
    const execution = inspected.value;
    const report = sqliteDatabaseSchema.safeParse(execution.result);
    if (
      !report.success ||
      execution.subject == null ||
      !matchesSelectedDatabase(report.data, input.data, execution.subject)
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "SQLite adapter returned malformed data or changed the selected database identity/table/row limit/worker budget.",
        ),
      );
    return ok(
      createEvidence(execution.subject, execution.provider, {
        operation: OPERATION,
        parameters: sqliteInspectionParameters(input.data),
        result: report.data,
        ...(execution.rawResult === null
          ? {}
          : { rawResult: execution.rawResult }),
        confidence: "observed",
        locations: execution.locations,
        limitations: execution.limitations,
      }),
    );
  }
}
