import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { DesktopApplicationService } from "../application/artifacts/DesktopApplicationService.js";
import type { Logger } from "pino";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { toolContract } from "../contracts/toolContracts.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import { retainedSummaryDelivery } from "./retainedSummaryDelivery.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err } from "../domain/result.js";

/** Bind the named contract and refuse unretained summary delivery before I/O. */
export const registerDesktopApplicationTool = (
  server: EvidenceMcpServer,
  service: DesktopApplicationService,
  logger: Logger,
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  withAdmittedAnalysis: WithAdmittedAnalysis,
  evidenceById: EvidenceLookup | undefined,
): void => {
  const contract = toolContract("inspect_desktop_application");
  const delivery = retainedSummaryDelivery(new Set([contract.name]), {
    recordEvidence,
    evidenceById,
  });
  const handler = createEvidenceToolHandler(
    server,
    async (raw, options) => {
      const parsed = contract.inputSchema.safeParse(raw);
      if (!parsed.success)
        return err(
          analysisInputErrorFromIssues(contract.name, parsed.error.issues, raw),
        );
      const { detail, ...input } = parsed.data;
      const parameters = { detail };
      const ready = delivery.preflight(contract.name, parameters);
      if (!ready.ok) return ready;
      const result = await service.inspect(input, options);
      return result.ok
        ? delivery.projectEvidence(contract.name, parameters, result.value)
        : result;
    },
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler(contract),
  );
};
