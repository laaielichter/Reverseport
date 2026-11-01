import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { ARTIFACT_TOOL_CONTRACTS } from "../contracts/artifactToolContracts.js";
import { createArtifactExtractionDestination } from "../application/artifacts/ArtifactExtractionDestination.js";
import { registerEvidenceTools } from "./registerEvidenceTools.js";
import {
  retainedSummaryDelivery,
  withoutDeliveryDetail,
  type EvidenceToolFamilyOptions,
} from "./retainedSummaryDelivery.js";

/** Operations whose MCP delivery may be a retained summary view. */
const SUMMARY_DELIVERY: ReadonlySet<string> = new Set([
  "inspect_artifact",
  "decode_interface_builder",
]);
const executionWithoutDelivery = withoutDeliveryDetail(SUMMARY_DELIVERY);
/** inspect_artifact keeps an explicit detail in its Evidence parameters. */
const decodeWithoutDelivery = withoutDeliveryDetail(
  new Set(["decode_interface_builder"]),
);

/** Register deterministic artifact inventory and safe extraction operations. */
export const registerArtifactTools = (
  server: EvidenceMcpServer,
  options: EvidenceToolFamilyOptions,
): void => {
  registerEvidenceTools(server, ARTIFACT_TOOL_CONTRACTS, {
    ...options,
    ...retainedSummaryDelivery(SUMMARY_DELIVERY, options),
    parametersForExecution: (operation, parameters) =>
      operation === "extract_artifact"
        ? { ...parameters, output_root: createArtifactExtractionDestination() }
        : executionWithoutDelivery(operation, parameters),
    parametersForEvidence: decodeWithoutDelivery,
  });
};
