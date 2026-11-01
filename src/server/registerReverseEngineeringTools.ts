import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import {
  resolveRizinCommandRequest,
  type ReverseEngineeringService,
} from "../application/reverse/ReverseEngineeringService.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";

/** Register objdump and Rizin operations against their exact named contracts. */
export const registerReverseEngineeringTools = (
  server: McpServer,
  service: ReverseEngineeringService,
  logger: Logger,
  delivery: ToolResultDelivery,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  invalidateSnapshotForExternalMutation?: () => void,
  withAdmittedExternalMutation?: <Value>(
    path: string | undefined,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result<Value, AnalysisError>>,
    retirementFailure: (
      value: Result<Value, AnalysisError>,
      error: AnalysisError,
    ) => AnalysisError,
  ) => Promise<Result<Result<Value, AnalysisError>, AnalysisError>>,
  evidenceById?: EvidenceLookup,
): void => {
  const objdump = toolContract("inspect_with_objdump");
  const rizin = toolContract("execute_rizin_command");
  server.registerTool(
    objdump.name,
    toolRegistrationOptions(objdump),
    (input, context: ServerContext) =>
      runAdmitted(
        objdump,
        context,
        withAdmittedAnalysis,
        delivery,
        async () => {
          const result = await logToolExecution(logger, objdump.name, () =>
            service.inspectWithObjdump(
              input,
              {
                signal: context.mcpReq.signal,
              },
              { recordEvidence, evidenceById },
            ),
          );
          if (!result.ok)
            return delivery.toPartialErrorToolResult(
              result.error,
              objdump.returnsTargetContent,
              recordEvidence,
            );
          return delivery.toEvidenceToolResult(
            result.value,
            objdump,
            recordEvidence?.(result.value),
          );
        },
      ),
  );
  server.registerTool(
    rizin.name,
    toolRegistrationOptions(rizin),
    async (input, context: ServerContext) => {
      const parsed = resolveRizinCommandRequest(input);
      if (parsed.ok && withAdmittedExternalMutation !== undefined) {
        const cleanup = await service.retryCleanup(rizin.name);
        if (!cleanup.ok)
          return delivery.toPartialErrorToolResult(
            cleanup.error,
            rizin.returnsTargetContent,
            recordEvidence,
          );
        const admitted = await withAdmittedExternalMutation(
          parsed.value.path,
          context.mcpReq.signal,
          async () => {
            invalidateSnapshotForExternalMutation?.();
            return logToolExecution(logger, rizin.name, () =>
              service.executeRizinCommandValidated(parsed.value, {
                signal: context.mcpReq.signal,
              }),
            );
          },
          (value, cause) => {
            if (!value.ok)
              return value.error.retainSecondaryFailure(cause, {
                retirement_error: projectAnalysisError(cause),
              });
            const observation = value.value;
            return new AnalysisOutputError(
              rizin.name,
              "Rizin may have changed the bound artifact, but the active analysis session could not be retired.",
              {
                cause,
                ...(cause.cleanup === undefined
                  ? {}
                  : { cleanup: cause.cleanup }),
                ...(cause.capturedOutput === undefined
                  ? {}
                  : { capturedOutput: cause.capturedOutput }),
                ...(observation === undefined
                  ? {}
                  : { partialObservation: observation }),
              },
            );
          },
        );
        if (!admitted.ok)
          return delivery.toPartialErrorToolResult(
            admitted.error,
            rizin.returnsTargetContent,
            recordEvidence,
          );
        const result = admitted.value;
        if (!result.ok)
          return delivery.toPartialErrorToolResult(
            result.error,
            rizin.returnsTargetContent,
            recordEvidence,
          );
        return delivery.toEvidenceToolResult(
          result.value,
          rizin,
          recordEvidence?.(result.value),
        );
      }
      return runAdmitted(
        rizin,
        context,
        withAdmittedAnalysis,
        delivery,
        async () => {
          if (invalidateSnapshotForExternalMutation !== undefined && parsed.ok)
            invalidateSnapshotForExternalMutation();
          const result = await logToolExecution(logger, rizin.name, () =>
            parsed.ok
              ? service.executeRizinCommandValidated(parsed.value, {
                  signal: context.mcpReq.signal,
                })
              : Promise.resolve(parsed),
          );
          if (!result.ok)
            return delivery.toPartialErrorToolResult(
              result.error,
              rizin.returnsTargetContent,
              recordEvidence,
            );
          return delivery.toEvidenceToolResult(
            result.value,
            rizin,
            recordEvidence?.(result.value),
          );
        },
      );
    },
  );
};

const runAdmitted = async (
  contract: ToolContract,
  context: ServerContext,
  admission: WithAdmittedAnalysis | undefined,
  delivery: ToolResultDelivery,
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  if (admission === undefined) return operation();
  const admitted = await admission(
    contract.name,
    context.mcpReq.signal,
    async () => operation(),
  );
  return admitted.ok
    ? admitted.value
    : delivery.toErrorToolResult(admitted.error, contract.returnsTargetContent);
};
