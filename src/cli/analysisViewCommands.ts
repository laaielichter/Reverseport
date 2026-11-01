import { z } from "incur";

import { inspectAnalysisView } from "../application/analysisView/AnalysisViewService.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ANALYSIS_VIEW_PROVIDER } from "../domain/investigationProviders.js";
import { readEvidenceBundle } from "../application/EvidenceBundleFiles.js";
import { inspectEvidenceBundle } from "../application/investigation/InspectEvidenceBundle.js";
import {
  getEvidenceBundleInputSchema,
  importEvidenceBundleInputSchema,
} from "../contracts/sessionToolSchemas.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput, resolveCliJsonPaths } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Project selected views of completed analysis Evidence through the CLI. */
export const registerAnalysisViewCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectEvidenceBundle, {
    description:
      "Inspect complete or selected discovery metadata from a local Evidence bundle",
    args: z.object({
      inputJson: z
        .string()
        .describe(
          "JSON or JSON file with absolute path, detail and optional record filters",
        ),
    }),
    run: ({ args }) =>
      logCliCommand(logger, CLI_COMMANDS.inspectEvidenceBundle, async () => {
        const input = await parseCliJsonInput(
          args.inputJson,
          CLI_COMMANDS.inspectEvidenceBundle,
        );
        if (!input.ok) return input.error;
        const schema = getEvidenceBundleInputSchema.safeExtend({
          path: importEvidenceBundleInputSchema.shape.path,
        });
        const parsed = schema.safeParse(input.value);
        if (!parsed.success)
          return {
            error: "Evidence bundle inspection failed",
            ...projectAnalysisError(
              analysisInputErrorFromIssues(
                CLI_COMMANDS.inspectEvidenceBundle,
                parsed.error.issues,
                input.value,
              ),
            ),
          };
        const loaded = await readEvidenceBundle(
          parsed.data.path,
          undefined,
          undefined,
          "get_evidence_bundle",
        );
        if (!loaded.ok)
          return {
            error: "Evidence bundle inspection failed",
            ...projectAnalysisError(loaded.error),
          };
        const result = inspectEvidenceBundle(loaded.value, parsed.data);
        return result.ok
          ? result.value
          : {
              error: "Evidence bundle inspection failed",
              ...projectAnalysisError(result.error),
            };
      }),
  });
  cli.command(CLI_COMMANDS.inspectAnalysisView, {
    description:
      "Project a selected view of completed Evidence JSON for a supported analysis operation",
    args: z.object({
      inputJson: z.string().describe("Inline workflow JSON or JSON file path"),
    }),
    options: z.object({
      evidenceBundle: localPathStringSchema
        .optional()
        .describe(
          "Read the exact retained-evidence source ID from this local Evidence bundle without reopening the target; omit for inline Evidence",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectAnalysisView, async () => {
          const input = await parseCliJsonInput(
            args.inputJson,
            CLI_COMMANDS.inspectAnalysisView,
            signal,
          );
          if (!input.ok) return input.error;
          // An evidence-file path is resolved against the operator's working directory.
          const value = resolveCliJsonPaths(input.value, [["source", "path"]]);
          const resources = new ArtifactResourceScope();
          const bundlePath = options.evidenceBundle;
          const result = await finishAnalysisCommand(
            () =>
              inspectAnalysisView(value, undefined, {
                signal,
                resources,
                ...(bundlePath === undefined
                  ? {}
                  : { evidenceBundlePath: bundlePath }),
              }),
            resources,
            ANALYSIS_VIEW_PROVIDER.id,
            "inspect_analysis_view",
            signal,
          );
          // Preserve the inline command's existing error label without copying
          // the authenticated completed Evidence or its partial observation.
          return bundlePath === undefined && "code" in result
            ? { error: "Application workflow failed", ...result }
            : result;
        }),
      ),
  });
};
