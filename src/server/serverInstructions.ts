import { toolFamilyId } from "../contracts/toolFamilies.js";
import { UNTRUSTED_CONTENT_INSTRUCTIONS } from "./toolResultEncoding.js";
import { recoveryInstructions } from "./recoveryInstructions.js";

const TARGET_FREE_INSTRUCTIONS =
  "Deep-analysis tools for local artifacts, native binaries, managed code, browser pages, and runtimes. Use the tool that directly answers the question; binary_session reports status, capabilities and why a tool is unavailable. Native executable or library: open_binary, then binary_overview, search_procedures or search_strings, then analyze_function (one dossier per function) or procedure_pseudo_code, and xrefs. .NET: inspect_managed_artifact. APK code: inspect_android_package. Electron or JavaScript directories: analyze_javascript_application. Open browser page: list_browser_targets. For large results pass detail: summary and page with inspect_analysis_view. Results include inline Evidence and report their coverage and limitations.";

// Only advertise the lifecycle when `session` is in scope: otherwise
// `open_binary` and `close_binary` are disabled and the guidance would direct
// initialization to a call that always fails.
const SESSION_LIFECYCLE_INSTRUCTIONS =
  "An opened target persists across turns. When finished, export needed Evidence and call close_binary; its snapshot_path can retain analysis.";

const ACTIVE_TARGET_INSTRUCTIONS =
  "Deep analysis of the active reverse-engineering target. Use the analysis tool that answers the question directly. Search with search_procedures or search_strings before listing everything. For large results pass detail: summary and page with inspect_analysis_view.";

// Only name the enhanced-family dossier tool when that family is in scope:
// otherwise `analyze_function` is disabled and the recommendation always fails.
const FUNCTION_DOSSIER_INSTRUCTIONS =
  "analyze_function provides a function dossier, focused procedure tools return individual facets, and xrefs shows references.";

/** Whether the scope advertises the family that owns a named tool. */
const advertisesToolFamily = (
  advertisedToolFamilies: ReadonlySet<string> | undefined,
  tool: string,
): boolean => {
  if (advertisedToolFamilies === undefined) return true;
  const family = toolFamilyId(tool);
  return family !== undefined && advertisedToolFamilies.has(family);
};

export const serverInstructions = (
  hasSession: boolean,
  advertisedToolFamilies: ReadonlySet<string> | undefined,
): string => {
  const guidance = (tool: string, text: string): string =>
    advertisesToolFamily(advertisedToolFamilies, tool) ? ` ${text}` : "";
  const recovery = recoveryInstructions(
    advertisesToolFamily(advertisedToolFamilies, "update_analysis_settings"),
  );
  if (!hasSession)
    return `${ACTIVE_TARGET_INSTRUCTIONS}${guidance("analyze_function", FUNCTION_DOSSIER_INSTRUCTIONS)} ${recovery} ${UNTRUSTED_CONTENT_INSTRUCTIONS}`;
  return `${TARGET_FREE_INSTRUCTIONS}${guidance("close_binary", SESSION_LIFECYCLE_INSTRUCTIONS)} ${recovery} ${UNTRUSTED_CONTENT_INSTRUCTIONS}`;
};
