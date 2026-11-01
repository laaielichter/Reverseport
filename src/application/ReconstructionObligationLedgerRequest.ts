import { z } from "zod";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import {
  readEvidenceBundle,
  type EvidenceBundle,
} from "../domain/evidenceBundle.js";
import {
  reconstructionObligationLedgerInputSchema,
  type ReviewedReconstructionObligation,
  type ReconstructionObligationManifest,
} from "../domain/reconstructionObligationLedgerSchemas.js";
import { err, ok, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";

const OPERATION = "build_reconstruction_obligation_ledger";
const requestSchema = reconstructionObligationLedgerInputSchema.extend({
  evidence_bundle: z.unknown(),
});

/** Authenticated bundle and its single request-owned record index. */
export interface ReconstructionObligationSources {
  readonly bundle: EvidenceBundle;
  readonly records: ReadonlyMap<string, Evidence>;
}

export interface ResolvedReconstructionObligationRequest {
  readonly sources: ReconstructionObligationSources;
  readonly reviewedObligations: readonly ReviewedReconstructionObligation[];
  readonly manifest: ReconstructionObligationManifest;
}

/** Authenticate the source bundle and bind every selected review reference. */
export const resolveReconstructionObligationLedgerRequest = (
  input: unknown,
): Result<ResolvedReconstructionObligationRequest, AnalysisError> => {
  const frame = requestSchema.safeParse(input);
  if (!frame.success)
    return err(
      analysisInputErrorFromIssues(OPERATION, frame.error.issues, input, {
        cause: frame.error,
      }),
    );
  const bundle = readEvidenceBundle(frame.data.evidence_bundle);
  if (!bundle.ok) return bundle;
  const records = new Map(
    bundle.value.records.map((record) => [record.evidence_id, record]),
  );
  for (const [index, obligation] of frame.data.reviewed_obligations.entries()) {
    for (const [
      referenceIndex,
      id,
    ] of obligation.review_evidence_ids.entries()) {
      if (records.has(id)) continue;
      const message = `Reviewed obligation Evidence is missing: ${id}`;
      return err(
        new AnalysisInputError(OPERATION, { userMessage: message }, [
          {
            path: [
              "reviewed_obligations",
              index,
              "review_evidence_ids",
              referenceIndex,
            ],
            reason: "invalid_value",
            message,
          },
        ]),
      );
    }
  }
  return ok({
    sources: { bundle: bundle.value, records },
    reviewedObligations: frame.data.reviewed_obligations,
    manifest: frame.data.manifest,
  });
};
