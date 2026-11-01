import { Cli } from "incur";
import { z } from "zod";

import { captureBrowserScenario } from "./application/BrowserScenarioCaptureService.js";
import { withCommandCancellation } from "./cli/commandCancellation.js";
import { CLI_COMMANDS } from "./cliCommandNames.js";
import { parseCliJsonInput, resolveCliJsonPaths } from "./cliJsonInput.js";
import { logCliCommand } from "./cliLogging.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";
import {
  BrowserObservationError,
  browserCleanupObservation,
} from "./domain/browserObservationError.js";
import { analysisInputErrorFromIssues } from "./domain/inputIssueProjection.js";
import { browserScenarioSchema } from "./domain/browserScenario.js";
import type { BrowserScenarioCapturePort } from "./application/BrowserScenarioCapturePort.js";
import type { JsonValue } from "./domain/jsonValue.js";
import type { Logger } from "pino";

const OPERATION = "capture_browser_scenario";

/** Register the one-shot controlled browser scenario command. */
export const registerBrowserScenarioCommands = (
  cli: ReturnType<typeof Cli.create>,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly createProvider?: (
      environment: Readonly<Record<string, string | undefined>>,
    ) => BrowserScenarioCapturePort;
  } = {},
): void => {
  cli.command(CLI_COMMANDS.captureBrowserScenario, {
    description:
      "Run one bounded Playwright browser scenario and return Evidence",
    args: z.object({
      inputJson: z
        .string()
        .describe("Inline browser scenario JSON or JSON file path"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.captureBrowserScenario, async () => {
          const input = await parseCliJsonInput(
            args.inputJson,
            OPERATION,
            signal,
          );
          if (!input.ok) return input.error;
          const scenario = browserScenarioSchema.safeParse(
            resolveCliJsonPaths(input.value, [["browser", "executable_path"]]),
          );
          if (!scenario.success)
            return cliError(
              analysisInputErrorFromIssues(
                OPERATION,
                scenario.error.issues,
                input.value,
                { cause: scenario.error },
              ),
            );
          // Load Playwright only for this command, not during CLI startup.
          const provider =
            options.createProvider === undefined
              ? await import("./composition/browserScenario.js").then(
                  ({ createBrowserScenarioProvider }) =>
                    createBrowserScenarioProvider(environment),
                )
              : options.createProvider(environment);
          let result:
            | Awaited<ReturnType<typeof captureBrowserScenario>>
            | undefined;
          try {
            result = await captureBrowserScenario(provider, scenario.data, {
              signal,
            });
            return result.ok ? result.value : cliError(result.error);
          } finally {
            try {
              await provider?.close?.();
            } catch (cause: unknown) {
              // Failed captures already retain their primary error and partial
              // observations. A cleanup retry must not replace that outcome.
              if (result?.ok)
                throw new BrowserObservationError(OPERATION, "cleanup_failed", {
                  cause,
                  cleanup: browserCleanupObservation(cause),
                  partialObservation: result.value,
                });
            }
          }
        }),
      ),
  });
};

const cliError = (
  error: Parameters<typeof projectAnalysisError>[0],
): JsonValue => ({
  error: "Browser scenario capture failed",
  ...projectAnalysisError(error),
});
