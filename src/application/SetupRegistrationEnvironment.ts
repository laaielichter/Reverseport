import type { DoctorProviderInspection } from "./Doctor.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

const SELECTED_REGISTRATION_SETTINGS = [
  "REA_ANALYSIS_PROVIDER",
  "REA_ASAR_MAX_HEADER_BYTES",
  "REA_BRIDGE_MAX_REQUEST_BYTES",
  "REA_CAPTURE_DECODER_OLD_GENERATION_MIB",
  "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
  "REA_GHIDRA_STARTUP_TIMEOUT_MS",
  "REA_HOPPER_STARTUP_TIMEOUT_MS",
  "REA_JEB_MCP_TIMEOUT_MS",
  "REA_MCP_INPUT_SCHEMA_PROFILE",
  "REA_REGEX_MATCHING_DEADLINE_MS",
  "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
  "REA_MCP_INITIALIZE_BUDGET_MS",
  "REA_MCP_TOOLS_LIST_BUDGET_MS",
  "REA_MCP_FIRST_CATALOG_BUDGET_MS",
  "REA_MCP_DOCTOR_DEADLINE_MS",
] as const;

/** Preserve selected setup settings without copying unrelated process values. */
export const explicitSetupRegistrationEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    SELECTED_REGISTRATION_SETTINGS.flatMap((key) => {
      const value = environment[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

/** Preserve adapter-published settings independently of runtime readiness. */
export const providerRegistrationEnvironment = (
  inspections: readonly DoctorProviderInspection[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    inspections
      .flatMap(({ registrationEnvironment }) =>
        Object.entries(registrationEnvironment),
      )
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right)),
  );
