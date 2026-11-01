import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import { compareArtifacts } from "../domain/artifactComparison.js";
import { ARTIFACT_COMPARISON_PROVIDER } from "../domain/comparisonEvidenceIdentity.js";
import { createEvidence } from "../domain/evidence.js";
import { readEvidence } from "../domain/evidenceValidation.js";
import { resolveArtifactComparisonEvidence } from "../application/artifacts/ArtifactComparisonEvidence.js";
import type { RecordUnknownInput } from "../domain/residualUnknown.js";
import { recordDerivedEvidence } from "./recordDerivedEvidence.js";
import { runDerivedOperation } from "./runDerivedOperation.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { withAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import { recordEvidenceSources } from "../application/investigation/recordEvidenceSources.js";

/** Register Evidence-backed deterministic artifact comparison. */
export const registerArtifactComparisonTool = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  contract: ReturnType<typeof toolContract<"compare_artifacts">>,
): void => {
  const admission = withAdmittedAnalysis({ kind: "session", session });
  const evidenceById = session.evidenceForAnalysis.bind(session);
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        admission,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const computed = await runDerivedOperation(
            context,
            contract.name,
            () => {
              const suppliedLeft = readEvidence(input.left);
              if (!suppliedLeft.ok) throw suppliedLeft.error;
              const suppliedRight = readEvidence(input.right);
              if (!suppliedRight.ok) throw suppliedRight.error;
              const resolvedLeft = resolveArtifactComparisonEvidence(
                suppliedLeft.value,
                evidenceById,
              );
              if (!resolvedLeft.ok) throw resolvedLeft.error;
              const resolvedRight = resolveArtifactComparisonEvidence(
                suppliedRight.value,
                evidenceById,
              );
              if (!resolvedRight.ok) throw resolvedRight.error;
              const left = resolvedLeft.value;
              const right = resolvedRight.value;
              return { left, right, comparison: compareArtifacts(left, right) };
            },
          );
          if (!computed.ok)
            return server.delivery.toCallToolResult(computed, contract);
          const { left, right, comparison } = computed.value;
          const recordedSources = recordEvidenceSources(
            (source) => session.recordEvidence(source),
            [left, right],
          );
          if (!recordedSources.ok)
            return server.delivery.toCallToolResult(recordedSources, contract);
          const leftEvidenceIds = [left.evidence_id];
          const rightEvidenceIds = [right.evidence_id];
          const evidence = createEvidence(
            undefined,
            ARTIFACT_COMPARISON_PROVIDER,
            {
              predicateType: "rea.artifact-comparison",
              operation: contract.name,
              parameters: {
                left_evidence_ids: leftEvidenceIds,
                right_evidence_ids: rightEvidenceIds,
              },
              result: comparison,
              confidence: "derived",
              authority: "analyst-inference",
              limitations: comparison.limitations,
              evidenceLinks: [...leftEvidenceIds, ...rightEvidenceIds],
            },
          );
          return server.delivery.toEvidenceToolResult(
            evidence,
            contract,
            recordDerivedEvidence(
              session,
              evidence,
              artifactUnknownInput(
                left,
                right,
                comparison,
                evidence.evidence_id,
              ),
            ),
          );
        },
      ),
  );
};

const artifactUnknownInput = (
  left: { readonly evidence_id: string },
  right: { readonly evidence_id: string },
  comparison: ReturnType<typeof compareArtifacts>,
  comparisonEvidenceId: string,
): RecordUnknownInput | undefined => {
  const { status } = comparison;
  if (status === "unchanged") return undefined;
  const sourceIds = [...new Set([left.evidence_id, right.evidence_id])];
  const contradictingIds = comparison.integrity_mismatch_evidence_ids ?? [];
  const contentContradictions =
    status === "changed" && left.evidence_id !== right.evidence_id
      ? [right.evidence_id]
      : [];
  const contradictions =
    contradictingIds.length > 0 ? contradictingIds : contentContradictions;
  return {
    question: `Artifact comparison is ${status} (comparison ${comparisonEvidenceId})`,
    severity:
      status === "unknown" || status === "truncated" ? "high" : "medium",
    domain: "artifact-comparison",
    supporting_evidence_ids: sourceIds.filter(
      (id) => !contradictions.includes(id),
    ),
    contradicting_evidence_ids: contradictions,
    required_authority: "shipped-artifact",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [
      {
        operation: "inspect_artifact",
        rationale: "Inspect both artifacts and compare their complete graphs.",
      },
    ],
    relationships: [],
  };
};
