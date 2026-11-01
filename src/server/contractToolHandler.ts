import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import type { z } from "zod";

import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { AnalysisViewRetention } from "../application/analysisView/AnalysisViewService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import { err, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { logToolExecution } from "./toolLogging.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import { retainedSummaryDelivery } from "./retainedSummaryDelivery.js";

/** Application service executing one named contract operation. */
export interface ContractToolService<TOperation extends string> {
  execute(
    operation: TOperation,
    input: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>>;
}

/** Record and deliver one Evidence result using the tool's exact contract. */
export const deliverEvidenceResult = (
  server: EvidenceMcpServer,
  result: Result<Evidence, AnalysisError>,
  contract: ToolContract,
  recordEvidence?: EvidenceWriter["recordEvidence"],
): CallToolResult => {
  if (!result.ok)
    return server.delivery.toPartialErrorToolResult(
      result.error,
      contract.returnsTargetContent,
      recordEvidence,
    );
  const recorded = recordEvidence?.(result.value);
  return server.delivery.toEvidenceToolResult(result.value, contract, recorded);
};

/**
 * Bind one service-backed handler to its exact named contract through the
 * shared log/execute/record/deliver workflow.
 */
export const createContractToolHandler =
  <TOperation extends string>(
    server: EvidenceMcpServer,
    service: ContractToolService<TOperation>,
    logger: Logger,
    recordEvidence?: EvidenceWriter["recordEvidence"],
    withAdmittedAnalysis?: WithAdmittedAnalysis,
  ) =>
  (contract: ToolContract<TOperation>) =>
    createEvidenceToolHandler(
      server,
      (input, options) => service.execute(contract.name, input, options),
      logger,
      recordEvidence,
      withAdmittedAnalysis,
    )(contract);

/** Validate delivery selection before inspection and retain its complete source for summaries. */
export const createRetainedSummaryToolHandler = <
  Name extends string,
  InputSchema extends z.ZodType<
    Readonly<Record<string, unknown>> & {
      readonly detail: "complete" | "summary";
    }
  >,
>(
  server: EvidenceMcpServer,
  contract: ToolContract<Name, InputSchema>,
  inspect: (
    input: Omit<z.output<InputSchema>, "detail">,
    options: ExecutionOptions,
  ) => Promise<Result<Evidence, AnalysisError>>,
  logger: Logger,
  retention: AnalysisViewRetention,
  withAdmittedAnalysis?: WithAdmittedAnalysis,
) => {
  const delivery = retainedSummaryDelivery(new Set([contract.name]), retention);
  return createEvidenceToolHandler(
    server,
    async (rawInput, options) => {
      const parsed = contract.inputSchema.safeParse(rawInput);
      if (!parsed.success)
        return err(
          analysisInputErrorFromIssues(
            contract.name,
            parsed.error.issues,
            rawInput,
            { cause: parsed.error },
          ),
        );
      const { detail, ...input } = parsed.data;
      const parameters = { detail };
      const ready = delivery.preflight(contract.name, parameters);
      if (!ready.ok) return ready;
      const inspected = await inspect(input, options);
      return inspected.ok
        ? delivery.projectEvidence(contract.name, parameters, inspected.value)
        : inspected;
    },
    logger,
    retention.recordEvidence,
    withAdmittedAnalysis,
  )(contract);
};

/** Bind a named Evidence-producing operation to shared logging and delivery. */
export const createEvidenceToolHandler =
  (
    server: EvidenceMcpServer,
    operation: (
      input: unknown,
      options: ExecutionOptions,
    ) => Promise<Result<Evidence, AnalysisError>>,
    logger: Logger,
    recordEvidence?: EvidenceWriter["recordEvidence"],
    withAdmittedAnalysis?: WithAdmittedAnalysis,
  ) =>
  <TOperation extends string>(contract: ToolContract<TOperation>) => {
    const name = contract.name;
    return async (input: unknown, context: ServerContext) => {
      const executeAndRecord = async () => {
        const result = await logToolExecution(logger, name, () =>
          operation(input, { signal: context.mcpReq.signal }),
        );
        return deliverEvidenceResult(server, result, contract, recordEvidence);
      };
      return runAdmittedToolOperation(
        server,
        withAdmittedAnalysis,
        name,
        context.mcpReq.signal,
        executeAndRecord,
      );
    };
  };
