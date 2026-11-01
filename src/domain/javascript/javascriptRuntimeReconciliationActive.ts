import { isAbsolute } from "node:path";

import { digestCanonicalValue } from "../canonicalDigest.js";
import { isPathWithinRoot } from "../localPath.js";
import { z } from "zod";
import {
  assertEvidenceIdentity,
  invalidInput,
  parseInputAtPath,
} from "./javascriptRuntimeReconciliationInputValidation.js";

import { classifyBrowserCompleteness } from "../browserCompleteness.js";
import {
  electronActiveObservationResultSchema,
  type ElectronActiveObservationResult,
} from "./electronActiveObservation.js";
import type { Evidence } from "../evidence.js";
import type { ParsedRuntimeCapture } from "./javascriptRuntimeReconciliationCaptureParsing.js";

/** Parse active Electron Evidence as a bounded, target-only runtime capture. */
export const parseActiveElectronCapture = (
  evidence: Evidence,
  path: readonly (string | number)[],
): ParsedRuntimeCapture => {
  assertEvidenceIdentity(
    evidence,
    {
      operation: "capture_electron_scenario",
      predicate: "rea.electron-active-scenario",
      providerId: "rea-playwright-electron-active",
      providerName: "REA Playwright active Electron observation provider",
      providerVersion: "1",
      authority: "controlled-replay",
      confidence: "observed",
    },
    path,
  );
  const result = parseInputAtPath(
    electronActiveObservationResultSchema,
    evidence.normalized_result,
    [...path, "normalized_result"],
  );
  const parameters = parseInputAtPath(
    z
      .object({
        application_path: absolutePathSchema,
        application_root: absolutePathSchema,
      })
      .passthrough(),
    evidence.parameters,
    [...path, "parameters"],
  );
  if (
    result.application.application_path !== parameters.application_path ||
    !isPathWithinRoot(
      parameters.application_root,
      result.application.application_path,
    )
  )
    throw invalidInput(
      [...path, "normalized_result", "application", "application_path"],
      "Active Electron Evidence application path disagrees with its configured root",
    );
  return {
    kind: "electron-active",
    evidence,
    inspection: normalizeInspection(result),
    captureSha256: digestCanonicalValue(result, "Runtime reconciliation"),
    scriptsCompleteWithinScope: false,
    codeInventoryCompleteWithinScope: false,
  };
};

const absolutePathSchema = z.string().min(1).refine(isAbsolute);

const normalizeInspection = (
  result: ElectronActiveObservationResult,
): Extract<
  ParsedRuntimeCapture,
  { kind: "electron-active" }
>["inspection"] => ({
  target: {
    target_id: `electron-active:${digestCanonicalValue(result.application.application_path, "Runtime reconciliation").slice(0, 32)}`,
    type: "electron-application",
    title: result.application.application_path,
    attached: true,
    file_path: result.application.application_path,
  },
  frames: [],
  scripts: { items: [] },
  workers: [],
  completeness: classifyBrowserCompleteness({
    policyFilteredSections: new Set(),
    attachLimitedSections: new Set(),
    truncatedSections: new Set(),
    unavailableSections: new Set([
      "frames",
      "scripts",
      "script_sources",
      "workers",
    ]),
    excluded: [],
    droppedEvents: {
      scripts: 0,
      network_requests: 0,
      console_events: 0,
      websocket_connections: 0,
      websocket_frames: 0,
      webmcp_tools: 0,
      timeline_events: 0,
    },
  }),
});
