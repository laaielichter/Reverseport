import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { PythonPycService } from "../application/python/PythonPycService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import {
  requireAnalysisViewRetention,
  projectRetainedAnalysis,
} from "../application/analysisView/AnalysisViewService.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err } from "../domain/result.js";

/** Register the explicit-file CPython pyc workflow and retain its complete Evidence. */
export const registerPythonPycTool = (
  server: EvidenceMcpServer,
  service: PythonPycService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = toolContract("inspect_python_pyc");
  const handler = createEvidenceToolHandler(
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
      const { detail, view, ...input } = parsed.data;
      const retention = { recordEvidence, evidenceById };
      if (detail === "summary") {
        const ready = requireAnalysisViewRetention(contract.name, retention);
        if (!ready.ok) return ready;
      }
      const inspected = await service.inspect(input, options);
      return detail === "summary" && inspected.ok
        ? projectRetainedAnalysis(
            inspected.value,
            retention,
            view ?? { kind: "summary" },
          )
        : inspected;
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
