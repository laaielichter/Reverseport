import {
  devicetreeViewRequestSchema,
  devicetreeViewItemsSchema,
  devicetreeSummarySchema,
  devicetreePageContextSchema,
  projectDevicetreeView,
} from "./devicetreeView.js";
import {
  apkSignatureViewRequestSchema,
  apkSignatureViewItemsSchema,
} from "../apkSignature/apkSignatureQuery.js";
import {
  projectApkSignatureView,
  apkSignatureSummarySchema,
  apkSignatureSourceCoverageSchema,
} from "./apkSignatureView.js";
import { byteEntropySchema } from "../native/byteEntropy.js";
import {
  erlangBeamViewRequestSchema,
  erlangBeamViewPageSchema,
  erlangBeamSummarySchema,
  projectErlangBeamView,
} from "./erlangBeamView.js";
import {
  pythonPycViewRequestSchema,
  pythonPycViewItemsSchema,
  pythonPycSummarySchema,
  projectPythonPycView,
} from "./pythonPycView.js";
import {
  nativeExportsViewRequestSchema,
  nativeExportsViewItemsSchema,
  nativeExportsSummarySchema,
  projectNativeExportsView,
} from "./nativeExportsView.js";
import {
  byteEntropySummarySchema,
  projectByteEntropyView,
} from "./byteEntropyView.js";
import {
  parseAnalysisViewResult,
  analysisViewResultInputError,
} from "./analysisViewParent.js";
import {
  javaScriptRoutesViewRequestSchema,
  javaScriptRoutesViewItemsSchema,
  javaScriptRoutesViewSummarySchema,
  javaScriptRoutesSourceReferenceSchema,
  projectJavaScriptRoutesView,
} from "./javascriptRoutesView.js";
import { javaScriptRouteInventorySchema } from "../javascript/javascriptRouteInventory.js";
import {
  sourceToBundleViewRequestSchema,
  sourceToBundleViewItemsSchema,
  sourceToBundleViewContextSchema,
  projectSourceToBundleView,
} from "./sourceToBundleView.js";
import {
  gpuCodeObjectsViewRequestSchema,
  gpuCodeObjectsSummarySchema,
  gpuCodeObjectsItemsSchema,
  gpuCodeObjectsPtxPageSchema,
  projectGpuCodeObjectsView,
} from "./gpuCodeObjectsView.js";
import { gpuCodeObjectsObjectSchema } from "../gpu/gpuCodeObjects.js";
import { modelArtifactViewRequestSchema } from "../model/modelArtifactQuery.js";
import {
  projectModelArtifactView,
  modelArtifactSummarySchema,
  modelArtifactViewItemsSchema,
  modelArtifactViewContextSchema,
} from "./modelArtifactView.js";
import {
  commandSummaryContext,
  gdbCommandSummarySchema,
  projectCommandObservationView,
} from "./commandObservationView.js";
import {
  fridaSessionStatusSummarySchema,
  fridaSessionStatusViewContext,
  projectFridaSessionStatusView,
} from "./fridaSessionStatusView.js";
import { commandObservationSchema } from "../commandObservation.js";
import {
  rustBinaryViewPageSchema,
  rustBinaryViewRequestSchema,
} from "../rust/rustBinaryQuery.js";
import {
  goBinarySummarySchema,
  goBinaryViewContextSchema,
  goBinaryViewPageSchema,
  goBinaryViewRequestSchema,
  projectGoBinaryView,
} from "./goBinaryView.js";
import {
  rustBinarySummarySchema,
  rustBinaryViewContextSchema,
  projectRustBinaryView,
} from "./rustBinaryView.js";
import {
  projectNativeFunctionMatchingView,
  nativeFunctionMatchingViewRequestSchema,
  nativeFunctionMatchingViewItemsSchema,
  nativeFunctionMatchingViewContextSchema,
} from "./nativeFunctionMatchingView.js";
import {
  protobufViewRequestSchema,
  protobufViewItemsSchema,
  protobufViewContextSchema,
} from "./protobufCaptureView.js";
import {
  nativeInventoryViewRequestSchema,
  nativeInventoryViewRowSchema,
  nativeInventoryViewContext,
  nativeInventorySummarySchema,
  projectNativeInventoryView,
} from "./nativeInventoryView.js";
import {
  NATIVE_INVENTORY_OPERATIONS,
  nativeInventoryOperationSchema,
} from "../native/nativeInventory.js";

import { absoluteLocalPathStringSchema } from "../localPath.js";
import { z } from "zod";
import {
  desktopViewRequestSchema,
  desktopViewItemsSchema,
  desktopSummarySchema,
  projectDesktopApplicationView,
} from "./desktopApplicationView.js";
import { desktopCoverageSchema } from "../desktopApplication.js";
import {
  javascriptModuleReferencesRequestSchema,
  javascriptModuleReferenceSchema,
} from "./javascriptModuleReferences.js";
import { javascriptApplicationSourceCoverageSchema } from "./javascriptApplicationCoverage.js";
import {
  javascriptFactsViewRequestSchema,
  javascriptFactRowSchema,
} from "./javascriptFactsView.js";
import { javaScriptSourceSelectionSchema } from "../javascript/javascriptSourceSelection.js";

import { AnalysisUnsupportedTargetError } from "../analysisErrorCore.js";
import {
  INSPECT_ANALYSIS_VIEW_OPERATION,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { evidenceSchema, type Evidence } from "../evidence.js";
import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import {
  binaryLayoutSchema,
  safeParseOwnedBinaryLayout,
} from "../native/binaryLayout.js";
import { bundleResourceRootSchema } from "../apple/bundleResourceRoot.js";
import {
  functionDossierSchema,
  functionFacetAvailabilitySchema,
} from "../hopperValues.js";
import {
  artifactGraphManifestSchema,
  artifactInventoryCoverageSchema,
} from "../artifactGraph.js";
import { artifactInspectionResultSchema } from "../artifactInspection.js";
import {
  parseOwnedJavaScriptApplicationAnalysisSteps,
  type JavaScriptApplicationAnalysisResult,
} from "../javascript/javascriptApplicationAnalysis.js";
import { projectBinaryLayoutView } from "./binaryLayoutView.js";
import { projectJavaScriptApplicationView } from "./javascriptApplicationView.js";
import {
  createApiSurfaceAccumulator,
  projectWebNetworkApiSurfaceView,
  apiSurfaceFields,
  apiSurfaceViewSchema,
} from "./webNetworkApiSurfaceView.js";
import { projectNativeFunctionView } from "./nativeFunctionView.js";
import {
  projectEvmInterfaceView,
  evmViewRequestSchema,
  evmViewItemSchema,
  evmSummarySchema,
} from "./evmInterfaceView.js";
import {
  projectArtifactInventoryView,
  artifactInventoryViewRequestSchema,
  artifactInventoryItemsSchema,
  artifactInventorySummarySchema,
} from "./artifactInventoryView.js";
import {
  projectManagedArtifactView,
  managedViewRequestSchema,
  managedViewItemSchema,
  managedSummarySchema,
  managedViewContextSchema,
} from "./managedArtifactView.js";
import {
  projectManagedMemberView,
  managedMembersViewRequestSchema,
  managedMembersViewPageSchema,
  managedMemberSummarySchema,
  managedMembersViewContextSchema,
} from "./managedMemberView.js";
import {
  projectWasmArtifactView,
  wasmViewRequestSchema,
  wasmViewItemSchema,
  wasmSummarySchema,
} from "./wasmArtifactView.js";
import {
  machoSummarySchema,
  machoViewContextSchema,
  machoViewItemSchema,
  machoViewRequestSchema,
  projectMachoView,
} from "./machoView.js";
import {
  interfaceBuilderSummarySchema,
  interfaceBuilderViewContextSchema,
  interfaceBuilderViewItemsSchema,
  interfaceBuilderViewRequestSchema,
  projectInterfaceBuilderView,
} from "./interfaceBuilderView.js";
import {
  projectWebNetworkCaptureView,
  captureViewRequestSchema,
  captureViewItemsSchema,
  captureSummarySchema,
} from "./webNetworkCaptureView.js";
import type { WebNetworkApiSurfaceAccumulator } from "./WebNetworkApiSurfaceAccumulator.js";
import type { EnvironmentManifestAccumulator } from "./EnvironmentManifestAccumulator.js";
import type { EnvironmentStateAccumulator } from "./EnvironmentStateAccumulator.js";
import { admitAnalysisViewData } from "./analysisViewDataAdmission.js";
import {
  createEnvironmentManifestAccumulator,
  projectEnvironmentManifestView,
  environmentManifestFields,
  environmentManifestViewRequestSchema,
} from "./environmentManifestView.js";
import {
  createEnvironmentStateAccumulator,
  environmentStateFields,
  environmentStateViewRequestSchema,
  projectEnvironmentStateView,
} from "./environmentStateView.js";
import {
  environmentCoverageFields,
  environmentCoverageViewRequestSchema,
  projectEnvironmentCoverageView,
} from "./environmentCoverageView.js";
import {
  pcapViewRequestSchema,
  pcapViewPageSchema,
  pcapSummarySchema,
  projectPcapCaptureView,
} from "./pcapCaptureView.js";
import {
  qlogViewRequestSchema,
  qlogViewPageSchema,
  qlogViewContextSchema,
} from "./qlogCaptureView.js";
import {
  projectAndroidPackageView,
  androidPackageSummarySchema,
  androidViewRequestSchema,
  androidManifestViewItemSchema,
} from "./androidPackageView.js";
import {
  projectDartAotView,
  dartAotSummarySchema,
  dartAotViewRequestSchema,
  dartAotViewContextSchema,
} from "./dartAotView.js";
import {
  projectIl2cppMetadataView,
  il2cppMetadataSummarySchema,
  il2cppMetadataViewRequestSchema,
  il2cppMetadataViewContextSchema,
  il2cppMetadataViewItemsSchema,
} from "./il2cppMetadataView.js";

const summaryViewSchema = z.strictObject({ kind: z.literal("summary") });
const facetViewSchema = z.strictObject({
  kind: z.literal("facet"),
  facet: z.enum(["mitigations", "linkage"]),
});
const indexSelectorSchema = z.strictObject({
  index: z.int().nonnegative(),
});
const nameSelectorSchema = z.strictObject({ name: z.string() });
const pathSelectorSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "Exact observed module path or original source-map reference from a module page; an empty reference is valid.",
    ),
});
const nodeIdSelectorSchema = z.strictObject({
  node_id: prefixedDigestSchema("jag_node"),
});
const moduleItemViewSchema = z.strictObject({
  kind: z.literal("item"),
  collection: z.literal("modules"),
  selector: z.union([pathSelectorSchema, nodeIdSelectorSchema]),
});
const sectionOrSymbolItemViewSchema = z.strictObject({
  kind: z.literal("item"),
  collection: z.enum(["sections", "symbols"]),
  selector: z.union([indexSelectorSchema, nameSelectorSchema]),
});
/**
 * The collection-specific selector alternatives are expressed in the owning
 * contract so the advertised JSON Schema preserves them: modules accept
 * path/node_id, sections and symbols accept index/name. Refinement-only
 * constraints do not survive JSON Schema conversion, so the advertised
 * schema previously accepted combinations that runtime input validation
 * rejects.
 */
const itemViewSchema = z.discriminatedUnion("collection", [
  moduleItemViewSchema,
  sectionOrSymbolItemViewSchema,
]);
const pageViewSchema = z.strictObject({
  kind: z.literal("page"),
  collection: z.enum(["sections", "symbols", "modules"]),
  offset: z.int().nonnegative(),
  limit: z.int().positive(),
});

/** Bounded native function facets of already authenticated analyze_function Evidence. */
const nativeViewSchema = z.strictObject({
  kind: z.literal("native"),
  facet: z.enum([
    "procedure",
    "pseudocode",
    "assembly",
    "basic_blocks",
    "comments",
    "callers",
    "callees",
    "incoming_references",
    "outgoing_references",
    "unresolved_calls",
    "referenced_strings",
    "referenced_names",
    "swift_string_literals",
    "swift_string_literal_omissions",
    "native_api",
    "value_flow_summary",
    "value_flow_operations",
    "value_flow_def_use",
    "value_flow_effects",
    "value_flow_parameters",
    "value_flow_parameter_uses",
  ]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

/** Caller-selected projection of already completed analysis Evidence. */
export const analysisViewRequestSchema = z.discriminatedUnion("kind", [
  devicetreeViewRequestSchema,
  erlangBeamViewRequestSchema,
  pythonPycViewRequestSchema,
  nativeExportsViewRequestSchema,
  javaScriptRoutesViewRequestSchema,
  nativeFunctionMatchingViewRequestSchema,
  sourceToBundleViewRequestSchema,
  summaryViewSchema,
  goBinaryViewRequestSchema,
  rustBinaryViewRequestSchema,
  desktopViewRequestSchema,
  facetViewSchema,
  itemViewSchema,
  pageViewSchema,
  javascriptModuleReferencesRequestSchema,
  javascriptFactsViewRequestSchema,
  nativeViewSchema,
  nativeInventoryViewRequestSchema,
  artifactInventoryViewRequestSchema,
  wasmViewRequestSchema,
  machoViewRequestSchema,
  interfaceBuilderViewRequestSchema,
  evmViewRequestSchema,
  managedViewRequestSchema,
  managedMembersViewRequestSchema,
  androidViewRequestSchema,
  apiSurfaceViewSchema,
  environmentManifestViewRequestSchema,
  environmentStateViewRequestSchema,
  environmentCoverageViewRequestSchema,
  captureViewRequestSchema,
  protobufViewRequestSchema,
  qlogViewRequestSchema,
  pcapViewRequestSchema,
  dartAotViewRequestSchema,
  il2cppMetadataViewRequestSchema,
  apkSignatureViewRequestSchema,
  modelArtifactViewRequestSchema,
  gpuCodeObjectsViewRequestSchema,
]);

// The application owns admission and authenticated Evidence parsing. SDK and
// CLI envelope parsing must borrow this unknown value rather than clone it
// before admission. Advertise the owning Evidence contract in both dialects.
const inlineEvidenceInputSchema = z.unknown().nonoptional();
inlineEvidenceInputSchema._zod.processJSONSchema =
  evidenceSchema._zod.processJSONSchema;

/** Unauthenticated inline input, an exact same-session retained reference, or one local Evidence file. */
export const analysisViewSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("retained-evidence"),
    evidence_id: prefixedDigestSchema("ev"),
  }),
  z.strictObject({
    kind: z.literal("inline"),
    evidence: inlineEvidenceInputSchema,
  }),
  z.strictObject({
    kind: z.literal("evidence-file"),
    path: absoluteLocalPathStringSchema.describe(
      "Absolute local path of one completed Evidence JSON file, or of an Evidence bundle written by --evidence_output or export_evidence_bundle. REA reads and authenticates it, then projects it like retained Evidence, so large captures are not charged as inline input.",
    ),
    evidence_id: prefixedDigestSchema("ev")
      .exactOptional()
      .describe(
        "The record to project when the file is an Evidence bundle, such as a summary's normalized_result.parent_evidence_id. A bundle holding exactly one record needs no selection.",
      ),
  }),
]);

/** Public inspect_analysis_view input. */
export const inspectAnalysisViewInputSchema = z.strictObject({
  source: analysisViewSourceSchema,
  view: analysisViewRequestSchema,
});

const coverageSchema = z.strictObject({
  status: z.enum(["complete-within-view", "page", "empty"]),
  examined: z.int().nonnegative(),
  total: z.int().nonnegative(),
  next_offset: z.int().nonnegative().nullable(),
  exhausted: z.boolean(),
});

const artifactSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "Selected artifact path, or the canonical resource root when resource-only Evidence has no executable subject.",
    ),
  sha256: digestSchema.nullable(),
});

const layoutSummarySchema = z.strictObject({
  bytes: binaryLayoutSchema.shape.artifact.shape.bytes,
  format: binaryLayoutSchema.shape.format,
  architecture: binaryLayoutSchema.shape.architecture,
  image_type: binaryLayoutSchema.shape.image_type,
  entry: z.strictObject({
    reported_value: z.string().min(1),
    meaning: z.enum(["linked-virtual-address", "not-applicable", "absent"]),
    execution_status: z.literal("unknown"),
  }),
  counts: z.strictObject({
    sections: z.int().nonnegative(),
    segments: z.int().nonnegative(),
    symbols: z.int().nonnegative(),
    relocations: z.int().nonnegative(),
  }),
  limitation_count: z.int().nonnegative(),
});

const javascriptSummarySchema = z.strictObject({
  input_path: z.string().min(1),
  format: z.enum(["asar", "directory"]),
  root_artifact_sha256: digestSchema,
  source_selection: javaScriptSourceSelectionSchema.exactOptional(),
  statistics: jsonObjectSchema,
  electron: jsonObjectSchema,
  coverage: jsonObjectSchema,
  limitation_count: z.int().nonnegative(),
});

const viewResultBase = {
  parent_evidence_id: prefixedDigestSchema("ev"),
  parent_operation: z.enum([
    "inspect_python_pyc",
    "inspect_erlang_beam",
    "inspect_devicetree",
    "inspect_byte_entropy",
    "inspect_native_exports",
    "inspect_binary_layout",
    "inspect_go_binary",
    "gdb_console",
    "frida_session_status",
    "inspect_with_objdump",
    "inspect_desktop_application",
    "analyze_javascript_application",
    "analyze_web_bundle",
    "analyze_function",
    "inspect_artifact",
    "inventory_artifact",
    "inspect_wasm_artifact",
    "inspect_macho",
    "decode_interface_builder",
    "inspect_evm_interface",
    "inspect_managed_artifact",
    "inspect_managed_members",
    "inspect_web_network_capture",
    "inspect_android_package",
    "inspect_pcap_capture",
    "inspect_dart_aot",
    "inspect_il2cpp_metadata",
    "inspect_model_artifact",
    "inspect_gpu_code_objects",
    ...NATIVE_INVENTORY_OPERATIONS,
    "match_native_functions",
  ]),
  parent_digest: digestSchema,
  view_digest: digestSchema,
  artifact: artifactSchema,
  coverage: coverageSchema,
  limitations: z.array(z.string()),
  unknowns: z.array(z.string()),
} as const;

const summaryViewResultBase = {
  kind: z.literal("summary"),
  view: summaryViewSchema,
  ...viewResultBase,
} as const;

export const byteEntropySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: byteEntropySummarySchema,
  parent_operation: z.literal("inspect_byte_entropy"),
});

export const nativeExportsSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_native_exports"),
  summary: nativeExportsSummarySchema,
});

export const devicetreeSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_devicetree"),
  summary: devicetreeSummarySchema,
});
export const erlangBeamSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_erlang_beam"),
  summary: erlangBeamSummarySchema,
});
export const erlangBeamTableViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("beam"),
  parent_operation: z.literal("inspect_erlang_beam"),
  view: erlangBeamViewRequestSchema,
  beam: erlangBeamSummarySchema,
  page: erlangBeamViewPageSchema,
});

export const pythonPycSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_python_pyc"),
  summary: pythonPycSummarySchema,
});

export const pythonPycCodeObjectsViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("python-pyc"),
  parent_operation: z.literal("inspect_python_pyc"),
  view: pythonPycViewRequestSchema,
  pyc: pythonPycSummarySchema,
  items: pythonPycViewItemsSchema,
});

/** Opt-in command delivery keeps output once and retains the complete parent. */
export const gdbCommandSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...commandSummaryContext,
  parent_operation: z.literal("gdb_console"),
  artifact: artifactSchema.nullable(),
  summary: gdbCommandSummarySchema,
});

export const objdumpSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...commandSummaryContext,
  parent_operation: z.literal("inspect_with_objdump"),
  artifact: artifactSchema.nullable(),
  summary: commandObservationSchema,
});

export const fridaSessionStatusSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...fridaSessionStatusViewContext,
  parent_operation: z.literal("frida_session_status"),
  artifact: artifactSchema.nullable(),
  summary: fridaSessionStatusSummarySchema,
});

/** Opt-in Go delivery retains original bytes and exposes build identity/counts. */
export const goBinarySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...goBinaryViewContextSchema.shape,
  parent_operation: z.literal("inspect_go_binary"),
  summary: goBinarySummarySchema,
});

/** Compact source identity and counts, retaining the complete embedded graph. */
export const rustBinarySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...rustBinaryViewContextSchema.shape,
  parent_operation: z.literal("inspect_rust_binary"),
  summary: rustBinarySummarySchema,
});

export const rustBinaryPageViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...rustBinaryViewContextSchema.shape,
  kind: z.literal("rust"),
  parent_operation: z.literal("inspect_rust_binary"),
  view: rustBinaryViewRequestSchema,
  rust: rustBinarySummarySchema,
  page: rustBinaryViewPageSchema,
});

/** Summary `inspect_binary_layout` detail returns; no other view kind. */
export const binaryLayoutSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: layoutSummarySchema,
  parent_operation: z.literal("inspect_binary_layout"),
});

/** Summary `analyze_javascript_application` detail returns; no other view kind. */
export const javascriptApplicationSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  summary: javascriptSummarySchema,
  parent_operation: z.literal("analyze_javascript_application"),
});

/** Typed reference page; full item observations remain available separately. */
export const javascriptModuleReferencesViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("javascript"),
  view: javascriptModuleReferencesRequestSchema,
  parent_operation: z.literal("analyze_javascript_application"),
  rows: z.array(javascriptModuleReferenceSchema),
  source_coverage: javascriptApplicationSourceCoverageSchema,
});

/** Paged retained observations with exact selected properties and provenance. */
const javascriptFactsViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("javascript-facts"),
  view: javascriptFactsViewRequestSchema,
  parent_operation: z.literal("analyze_javascript_application"),
  rows: z.array(javascriptFactRowSchema),
  source_coverage: javascriptApplicationSourceCoverageSchema,
});

/** Exact summary carrier for artifact inspection's optional delivery contract. */
export const artifactInventorySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.enum(["inspect_artifact", "inventory_artifact"]),
  summary: artifactInventorySummarySchema,
});

export const desktopApplicationSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_desktop_application"),
  summary: desktopSummarySchema,
});

/** Exact summary carrier for WASM inspection's optional delivery contract. */
export const wasmArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_wasm_artifact"),
  summary: wasmSummarySchema,
});

/** Exact slice identity and collection counts for Mach-O's selected delivery. */
export const machoSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_macho"),
  summary: machoSummarySchema,
});

/** Decoded documents and graph counts for Interface Builder's selected delivery. */
export const interfaceBuilderSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("decode_interface_builder"),
  resource_root: bundleResourceRootSchema.optional(),
  summary: interfaceBuilderSummarySchema,
});

/** Exact inferred-interface summary for EVM's caller-selected delivery. */
export const evmInterfaceSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_evm_interface"),
  summary: evmSummarySchema,
});

/** Exact metadata overview for the managed artifact's selected delivery. */
export const managedArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_managed_artifact"),
  summary: managedSummarySchema,
});

/** Exact member selection, coverage and counts for the selected delivery. */
export const managedMemberSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_managed_members"),
  summary: managedMemberSummarySchema,
});

/** Exact historical capture summary, with no body or member-inventory payload. */
export const webNetworkCaptureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_web_network_capture"),
  summary: captureSummarySchema,
});

/** Exact package declarations with retained decoded manifest text. */
export const androidPackageSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_android_package"),
  summary: androidPackageSummarySchema,
});

export const pcapCaptureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_pcap_capture"),
  summary: pcapSummarySchema,
});

/** Exact snapshot and pool-coverage carrier for selected AOT delivery. */
export const dartAotSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_dart_aot"),
  summary: dartAotSummarySchema,
});

export const javaScriptRoutesViewResultSchema = z.strictObject({
  ...viewResultBase,
  artifact: artifactSchema.nullable(),
  kind: z.literal("javascript-routes"),
  parent_operation: z.enum([
    "analyze_javascript_application",
    "analyze_web_bundle",
  ]),
  view: javaScriptRoutesViewRequestSchema,
  inventory_id: javaScriptRouteInventorySchema.shape.inventory_id,
  source_manifest_sha256: digestSchema,
  source_coverage: javaScriptRouteInventorySchema.shape.coverage,
  inventory_capacity: javaScriptRouteInventorySchema.shape.capacity,
  capture_url: z.string().nullable(),
  items: javaScriptRoutesViewItemsSchema,
  sources: z.array(javaScriptRoutesSourceReferenceSchema),
  summary: javaScriptRoutesViewSummarySchema.nullable(),
  byte_limited: z.boolean(),
});

export const gpuCodeObjectsSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_gpu_code_objects"),
  summary: gpuCodeObjectsSummarySchema,
});
export const gpuCodeObjectsPageViewResultSchema = z.strictObject({
  kind: z.literal("gpu-code-objects"),
  view: gpuCodeObjectsViewRequestSchema,
  items: gpuCodeObjectsItemsSchema,
  ptx: gpuCodeObjectsPtxPageSchema.nullable(),
  source_coverage: gpuCodeObjectsObjectSchema.shape.coverage,
  ...viewResultBase,
  parent_operation: z.literal("inspect_gpu_code_objects"),
});

export const apkSignatureSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_apk_signature"),
  summary: apkSignatureSummarySchema,
});
export const apkSignaturePageViewResultSchema = z.strictObject({
  ...viewResultBase,
  kind: z.literal("apk-signature"),
  parent_operation: z.literal("inspect_apk_signature"),
  view: apkSignatureViewRequestSchema,
  items: apkSignatureViewItemsSchema,
  source_coverage: apkSignatureSourceCoverageSchema,
});

export const modelArtifactSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_model_artifact"),
  summary: modelArtifactSummarySchema,
});

export const modelArtifactPageViewResultSchema = z.strictObject({
  kind: z.literal("model-artifact"),
  view: modelArtifactViewRequestSchema,
  items: modelArtifactViewItemsSchema,
  ...viewResultBase,
  ...modelArtifactViewContextSchema.shape,
  parent_operation: z.literal("inspect_model_artifact"),
});

/** Metadata identity and row counts for selected IL2CPP delivery. */
export const il2cppMetadataSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("inspect_il2cpp_metadata"),
  summary: il2cppMetadataSummarySchema,
});

/** Exact inventory summary with the original observation's provider and query. */
export const nativeInventorySummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  ...nativeInventoryViewContext,
  parent_operation: nativeInventoryOperationSchema,
  artifact: artifactSchema.nullable(),
  summary: nativeInventorySummarySchema,
});

/** Compact native matching discovery retains the complete matching report. */
export const nativeFunctionMatchingSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: z.null(),
  parent_operation: z.literal("match_native_functions"),
  summary: nativeFunctionMatchingViewContextSchema,
});

/** Rows observed for one facet, or null when the provider declared that facet unavailable. */
const declaredFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when facet_availability declares the facet unavailable, so no rows is not evidence of none.",
  );

/** Rows of an optional dossier record, or null when the dossier omitted it. */
const recordedFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when the dossier did not record the facet (the native facet view reports it not recorded), so no rows is not evidence of none.",
  );

/** Rows of one value-flow facet, or null when value flow is unavailable. */
const valueFlowFacetCountSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .describe(
    "Observed rows; null when value_flow.available is false because native_value_flow was not recorded or the provider declared it unavailable (unknowns names which), so no rows is not evidence of none.",
  );

/** Compact analyze_function dossier; the complete dossier stays retained for facet paging. */
export const nativeFunctionSummarySchema = z.strictObject({
  procedure: z.strictObject({
    name: z.string(),
    address: z.string(),
  }),
  pseudocode: z.strictObject({
    available: z
      .boolean()
      .describe(
        "Provider facet_availability for pseudocode when declared; otherwise whether decompiled text is present. The flag is authoritative over raw length.",
      ),
    code_units: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Pseudocode length in UTF-16 code units, the unit inspect_analysis_view pages pseudocode by.",
      ),
  }),
  value_flow: z.strictObject({
    available: z.boolean(),
    truncated: z
      .boolean()
      .describe(
        "True only when value-flow is available and the provider truncated it; false when value-flow is unavailable (see available).",
      ),
  }),
  facet_availability: functionFacetAvailabilitySchema
    .nullable()
    .describe(
      "The provider's declared availability per facet, or null when it declared none. Unavailable facets name their reason here and in unknowns.",
    ),
  counts: z.strictObject({
    assembly: declaredFacetCountSchema,
    basic_blocks: declaredFacetCountSchema,
    comments: declaredFacetCountSchema,
    callers: declaredFacetCountSchema,
    callees: declaredFacetCountSchema,
    incoming_references: declaredFacetCountSchema,
    outgoing_references: declaredFacetCountSchema,
    unresolved_calls: recordedFacetCountSchema,
    referenced_strings: declaredFacetCountSchema,
    referenced_names: declaredFacetCountSchema,
    swift_string_literals: recordedFacetCountSchema,
    swift_string_literal_omissions: recordedFacetCountSchema,
    value_flow_operations: valueFlowFacetCountSchema,
    value_flow_def_use: valueFlowFacetCountSchema,
    value_flow_effects: valueFlowFacetCountSchema,
    value_flow_parameters: valueFlowFacetCountSchema,
    value_flow_parameter_uses: valueFlowFacetCountSchema,
  }),
  limitation_count: z.number().int().nonnegative(),
});

/** Compact analyze_function summary that retains the complete native dossier Evidence. */
export const nativeFunctionSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  parent_operation: z.literal("analyze_function"),
  procedure_address: z.string().nullable(),
  summary: nativeFunctionSummarySchema,
});

export const sourceToBundleSummaryViewResultSchema = z.strictObject({
  ...summaryViewResultBase,
  artifact: z.null(),
  parent_operation: z.literal("compare_source_to_bundle"),
  summary: sourceToBundleViewContextSchema,
});
export const sourceToBundlePageViewResultSchema = z.strictObject({
  ...viewResultBase,
  ...sourceToBundleViewContextSchema.shape,
  kind: z.literal("source-to-bundle"),
  artifact: z.null(),
  parent_operation: z.literal("compare_source_to_bundle"),
  view: sourceToBundleViewRequestSchema,
  items: sourceToBundleViewItemsSchema,
});

/** Projected facts for one selected view of retained analysis Evidence. */
export const analysisViewResultSchema = z.discriminatedUnion("kind", [
  javaScriptRoutesViewResultSchema,
  sourceToBundlePageViewResultSchema,
  z.strictObject({
    ...viewResultBase,
    ...nativeFunctionMatchingViewContextSchema.shape,
    kind: z.literal("function-matches"),
    artifact: z.null(),
    view: nativeFunctionMatchingViewRequestSchema,
    items: nativeFunctionMatchingViewItemsSchema,
    parent_operation: z.literal("match_native_functions"),
  }),
  z.strictObject({
    ...viewResultBase,
    ...apiSurfaceFields,
    kind: z.literal("api-surface"),
    parent_operation: z.literal("inspect_web_network_capture"),
    view: apiSurfaceViewSchema,
    artifact: z.strictObject({
      path: z.string(),
      sha256: digestSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentManifestFields,
    kind: z.literal("environment-manifest"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentManifestViewRequestSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentStateFields,
    kind: z.literal("environment-state"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentStateViewRequestSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...environmentCoverageFields,
    kind: z.literal("environment-coverage"),
    parent_operation: z.enum([
      "inspect_web_network_capture",
      "capture_browser_scenario",
    ]),
    view: environmentCoverageViewRequestSchema,
  }),
  z.discriminatedUnion("parent_operation", [
    erlangBeamSummaryViewResultSchema,
    devicetreeSummaryViewResultSchema,
    pythonPycSummaryViewResultSchema,
    nativeExportsSummaryViewResultSchema,
    byteEntropySummaryViewResultSchema,
    gdbCommandSummaryViewResultSchema,
    objdumpSummaryViewResultSchema,
    fridaSessionStatusSummaryViewResultSchema,
    goBinarySummaryViewResultSchema,
    rustBinarySummaryViewResultSchema,
    binaryLayoutSummaryViewResultSchema,
    desktopApplicationSummaryViewResultSchema,
    javascriptApplicationSummaryViewResultSchema,
    artifactInventorySummaryViewResultSchema,
    wasmArtifactSummaryViewResultSchema,
    machoSummaryViewResultSchema,
    interfaceBuilderSummaryViewResultSchema,
    evmInterfaceSummaryViewResultSchema,
    managedArtifactSummaryViewResultSchema,
    managedMemberSummaryViewResultSchema,
    webNetworkCaptureSummaryViewResultSchema,
    androidPackageSummaryViewResultSchema,
    pcapCaptureSummaryViewResultSchema,
    dartAotSummaryViewResultSchema,
    il2cppMetadataSummaryViewResultSchema,
    apkSignatureSummaryViewResultSchema,
    modelArtifactSummaryViewResultSchema,
    gpuCodeObjectsSummaryViewResultSchema,
    nativeInventorySummaryViewResultSchema,
    nativeFunctionMatchingSummaryViewResultSchema,
    nativeFunctionSummaryViewResultSchema,
    sourceToBundleSummaryViewResultSchema,
  ]),
  z.strictObject({
    ...viewResultBase,
    kind: z.literal("devicetree"),
    parent_operation: z.literal("inspect_devicetree"),
    view: devicetreeViewRequestSchema,
    devicetree: devicetreePageContextSchema,
    items: devicetreeViewItemsSchema,
  }),
  erlangBeamTableViewResultSchema,
  pythonPycCodeObjectsViewResultSchema,
  z.strictObject({
    ...viewResultBase,
    kind: z.literal("native-exports"),
    parent_operation: z.literal("inspect_native_exports"),
    view: nativeExportsViewRequestSchema,
    exports: nativeExportsSummarySchema,
    items: nativeExportsViewItemsSchema,
  }),
  z.strictObject({
    ...viewResultBase,
    ...nativeInventoryViewContext,
    kind: z.literal("native-inventory"),
    parent_operation: nativeInventoryOperationSchema,
    artifact: artifactSchema.nullable(),
    view: nativeInventoryViewRequestSchema,
    rows: z.array(nativeInventoryViewRowSchema),
  }),
  z.strictObject({
    kind: z.literal("protobuf"),
    view: protobufViewRequestSchema,
    items: protobufViewItemsSchema,
    ...viewResultBase,
    ...protobufViewContextSchema.shape,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("capture"),
    view: captureViewRequestSchema,
    items: captureViewItemsSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("qlog"),
    view: qlogViewRequestSchema,
    page: qlogViewPageSchema,
    context: qlogViewContextSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_web_network_capture"),
  }),
  z.strictObject({
    kind: z.literal("pcap"),
    view: pcapViewRequestSchema,
    page: pcapViewPageSchema,
    source_coverage: z.enum(["complete", "partial"]),
    ...viewResultBase,
    parent_operation: z.literal("inspect_pcap_capture"),
  }),
  z.strictObject({
    kind: z.literal("facet"),
    view: facetViewSchema,
    facet: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    ...viewResultBase,
    ...goBinaryViewContextSchema.shape,
    kind: z.literal("go"),
    parent_operation: z.literal("inspect_go_binary"),
    view: goBinaryViewRequestSchema,
    page: goBinaryViewPageSchema,
  }),
  rustBinaryPageViewResultSchema,
  z.strictObject({
    kind: z.literal("item"),
    view: itemViewSchema,
    item: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("page"),
    view: pageViewSchema,
    items: z.array(jsonValueSchema),
    ...viewResultBase,
  }),
  javascriptModuleReferencesViewResultSchema,
  javascriptFactsViewResultSchema,
  z.strictObject({
    kind: z.literal("native"),
    view: nativeViewSchema,
    procedure_address: z.string().nullable(),
    item: jsonValueSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("wasm"),
    view: wasmViewRequestSchema,
    item: wasmViewItemSchema,
    ...viewResultBase,
  }),
  z.strictObject({
    kind: z.literal("desktop-application"),
    view: desktopViewRequestSchema,
    items: desktopViewItemsSchema,
    ...viewResultBase,
    source_coverage: desktopCoverageSchema,
    parent_operation: z.literal("inspect_desktop_application"),
  }),
  z.strictObject({
    kind: z.literal("macho"),
    view: machoViewRequestSchema,
    item: machoViewItemSchema,
    ...viewResultBase,
    ...machoViewContextSchema.shape,
    parent_operation: z.literal("inspect_macho"),
  }),
  z.strictObject({
    kind: z.literal("interface-builder"),
    view: interfaceBuilderViewRequestSchema,
    items: interfaceBuilderViewItemsSchema,
    ...viewResultBase,
    resource_root: bundleResourceRootSchema.optional(),
    ...interfaceBuilderViewContextSchema.shape,
    parent_operation: z.literal("decode_interface_builder"),
  }),
  z.strictObject({
    kind: z.literal("evm"),
    view: evmViewRequestSchema,
    item: evmViewItemSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_evm_interface"),
  }),
  z.strictObject({
    kind: z.literal("managed"),
    view: managedViewRequestSchema,
    item: managedViewItemSchema,
    ...viewResultBase,
    ...managedViewContextSchema.shape,
    parent_operation: z.literal("inspect_managed_artifact"),
  }),
  z.strictObject({
    kind: z.literal("managed-members"),
    view: managedMembersViewRequestSchema,
    page: managedMembersViewPageSchema,
    ...viewResultBase,
    ...managedMembersViewContextSchema.shape,
    parent_operation: z.literal("inspect_managed_members"),
  }),
  z.strictObject({
    kind: z.literal("android"),
    view: androidViewRequestSchema,
    item: androidManifestViewItemSchema,
    ...viewResultBase,
    parent_operation: z.literal("inspect_android_package"),
  }),
  z.strictObject({
    kind: z.literal("dart-aot"),
    view: dartAotViewRequestSchema,
    items: z.array(z.string()),
    ...viewResultBase,
    ...dartAotViewContextSchema.shape,
    parent_operation: z.literal("inspect_dart_aot"),
  }),
  apkSignaturePageViewResultSchema,
  modelArtifactPageViewResultSchema,
  gpuCodeObjectsPageViewResultSchema,
  z.strictObject({
    kind: z.literal("il2cpp-metadata"),
    view: il2cppMetadataViewRequestSchema,
    items: il2cppMetadataViewItemsSchema,
    ...viewResultBase,
    ...il2cppMetadataViewContextSchema.shape,
    parent_operation: z.literal("inspect_il2cpp_metadata"),
  }),
  z.strictObject({
    kind: z.literal("inventory"),
    view: artifactInventoryViewRequestSchema,
    source_coverage: artifactInventoryCoverageSchema.exactOptional(),
    manifest: artifactGraphManifestSchema,
    inventory_evidence_ids: z.array(prefixedDigestSchema("ev")).min(1),
    source_complete: z.boolean(),
    items: artifactInventoryItemsSchema,
    ...viewResultBase,
  }),
]);

export type AnalysisViewRequest = z.output<typeof analysisViewRequestSchema>;
export type InspectAnalysisViewInput = z.output<
  typeof inspectAnalysisViewInputSchema
>;
export type AnalysisViewResult = z.output<typeof analysisViewResultSchema>;
export type AnalysisViewCoverage = z.output<typeof coverageSchema>;

/** Parent record already resolved from inline Evidence or a session reference. */
export interface AnalysisViewParent {
  readonly evidenceId: string;
  readonly operation: string;
  readonly normalizedResult: unknown;
  readonly provider?: Evidence["provider"];
  readonly analysisProfileDigest?: string | null;
  /** The owner proved normalizedResult belongs to a sealed, deep-frozen Evidence snapshot. */
  readonly sealedResult?: boolean;
  /** Preserve the authenticated source identity, including explicit absence. */
  readonly subject?: Evidence["subject"];
  readonly limitations: readonly string[];
  readonly artifact?: { readonly path: string; readonly sha256: string } | null;
  /** Parent Evidence parameters, when the parent operation records them. */
  readonly parameters?: unknown;
}

/** View payload before the content digest is attached. */
type WithoutViewDigest<T> = T extends { readonly view_digest: string }
  ? Omit<T, "view_digest">
  : never;
export type UnsignedAnalysisView = WithoutViewDigest<AnalysisViewResult>;

/** Attach the content digest that must change when projected bytes change. */
export const sealAnalysisView = (
  projection: UnsignedAnalysisView,
): AnalysisViewResult =>
  analysisViewResultSchema.parse({
    ...projection,
    view_digest: digestCanonicalValue(projection, "Analysis view"),
  });

const parentDigest = (evidenceId: string): string => evidenceId.slice(3);

const parseJavaScriptParent = (
  input: unknown,
): Result<JavaScriptApplicationAnalysisResult, AnalysisError> => {
  try {
    // The format owner authenticates imported results completely before reuse;
    // mutable or merely frozen inputs still receive canonical validation.
    const steps = parseOwnedJavaScriptApplicationAnalysisSteps(input);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return ok(step.value);
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err(analysisViewResultInputError(input, cause));
  }
};

const unsupportedParent = (
  parent: AnalysisViewParent,
): AnalysisUnsupportedTargetError =>
  new AnalysisUnsupportedTargetError(
    INSPECT_ANALYSIS_VIEW_OPERATION,
    parentArtifactPath(parent),
    parent.operation === "capture_browser_scenario"
      ? `Parent Evidence operation "capture_browser_scenario" supports only the environment-manifest, environment-state and environment-coverage views.`
      : `Parent Evidence operation ${JSON.stringify(parent.operation)} does not support analysis views. Use completed Evidence from a supported parent operation with a compatible view. For a summary receipt, use its normalized_result.parent_evidence_id rather than the receipt's own evidence_id.`,
  );

const parentArtifactPath = (parent: AnalysisViewParent): string => {
  if (
    typeof parent.normalizedResult === "object" &&
    parent.normalizedResult !== null &&
    "artifact" in parent.normalizedResult &&
    typeof parent.normalizedResult.artifact === "object" &&
    parent.normalizedResult.artifact !== null &&
    "path" in parent.normalizedResult.artifact &&
    typeof parent.normalizedResult.artifact.path === "string"
  )
    return parent.normalizedResult.artifact.path;
  if (
    typeof parent.normalizedResult === "object" &&
    parent.normalizedResult !== null &&
    "input_path" in parent.normalizedResult &&
    typeof parent.normalizedResult.input_path === "string"
  )
    return parent.normalizedResult.input_path;
  return parent.evidenceId;
};

/** Named source owners for views that need no extra decoder or accumulator. */
const retainedViewProjectors = new Map<string, typeof projectWasmArtifactView>([
  ["inspect_erlang_beam", projectErlangBeamView],
  ["inspect_devicetree", projectDevicetreeView],
  ["inspect_native_exports", projectNativeExportsView],
  ["inspect_python_pyc", projectPythonPycView],
  ["frida_session_status", projectFridaSessionStatusView],
  ["gdb_console", projectCommandObservationView],
  ["inspect_with_objdump", projectCommandObservationView],
  ["inspect_go_binary", projectGoBinaryView],
  ["inspect_rust_binary", projectRustBinaryView],
  ...NATIVE_INVENTORY_OPERATIONS.map(
    (operation) => [operation, projectNativeInventoryView] as const,
  ),
  ["inspect_desktop_application", projectDesktopApplicationView],
  ["inspect_wasm_artifact", projectWasmArtifactView],
  ["inspect_macho", projectMachoView],
  ["decode_interface_builder", projectInterfaceBuilderView],
  ["inspect_evm_interface", projectEvmInterfaceView],
  ["inspect_managed_artifact", projectManagedArtifactView],
  ["inspect_managed_members", projectManagedMemberView],
  ["inspect_android_package", projectAndroidPackageView],
  ["inspect_dart_aot", projectDartAotView],
  ["inspect_il2cpp_metadata", projectIl2cppMetadataView],
  ["inspect_apk_signature", projectApkSignatureView],
  ["inspect_model_artifact", projectModelArtifactView],
  ["inspect_gpu_code_objects", projectGpuCodeObjectsView],
  ["match_native_functions", projectNativeFunctionMatchingView],
  ["compare_source_to_bundle", projectSourceToBundleView],
  ["inspect_artifact", projectArtifactInventoryView],
  ["inventory_artifact", projectArtifactInventoryView],
]);

/** Budgets retained across source admission and the selected grouping projection. */
export interface AnalysisViewAccumulators {
  readonly apiSurface?: WebNetworkApiSurfaceAccumulator | undefined;
  readonly manifest?: EnvironmentManifestAccumulator | undefined;
  readonly state?: EnvironmentStateAccumulator | undefined;
}

/** Prepare one view's source admission and projection under the same owned budget. */
export const prepareAnalysisViewProjection = (
  view: AnalysisViewRequest,
): {
  admitInlineEvidence(value: unknown): Result<void, AnalysisError>;
  project(
    parent: AnalysisViewParent,
  ): Result<AnalysisViewResult, AnalysisError>;
} => {
  const accumulators: AnalysisViewAccumulators = {
    apiSurface:
      view.kind === "api-surface"
        ? createApiSurfaceAccumulator(view)
        : undefined,
    manifest:
      view.kind === "environment-manifest"
        ? createEnvironmentManifestAccumulator(view)
        : undefined,
    state:
      view.kind === "environment-state" || view.kind === "environment-coverage"
        ? createEnvironmentStateAccumulator(view)
        : undefined,
  };
  const accumulator =
    accumulators.apiSurface ?? accumulators.manifest ?? accumulators.state;
  return {
    admitInlineEvidence: (value) =>
      accumulator === undefined
        ? admitAnalysisViewData(value, true)
        : accumulator.admitInlineEvidence(value),
    project: (parent) => projectAnalysisView(parent, view, accumulators),
  };
};

/** Views that group a capture's records into tools. */
export type GroupingViewKind =
  | "api-surface"
  | "environment-manifest"
  | "environment-state"
  | "environment-coverage";

type GroupingViewRequest = Extract<
  AnalysisViewRequest,
  { kind: GroupingViewKind }
>;

const isGroupingView = (
  view: AnalysisViewRequest,
): view is GroupingViewRequest =>
  view.kind === "api-surface" ||
  view.kind === "environment-manifest" ||
  view.kind === "environment-state" ||
  view.kind === "environment-coverage";

/** Views that group a capture's records, each under the budget its caller created. */
const projectGroupingView = (
  parent: AnalysisViewParent,
  view: GroupingViewRequest,
  accumulators: AnalysisViewAccumulators,
): Result<UnsignedAnalysisView, AnalysisError> => {
  if (view.kind === "api-surface")
    return projectWebNetworkApiSurfaceView(
      parent,
      view,
      accumulators.apiSurface,
    );
  if (view.kind === "environment-manifest")
    return projectEnvironmentManifestView(parent, view, accumulators.manifest);
  if (view.kind === "environment-coverage")
    return projectEnvironmentCoverageView(parent, view, accumulators.state);
  return projectEnvironmentStateView(parent, view, accumulators.state);
};

/** Project one selected view from authenticated parent analysis Evidence. */
export const projectAnalysisView = (
  parent: AnalysisViewParent,
  view: AnalysisViewRequest,
  accumulators: AnalysisViewAccumulators = {},
): Result<AnalysisViewResult, AnalysisError> => {
  const digest = parentDigest(parent.evidenceId);
  if (!digestSchema.safeParse(digest).success)
    return err(
      analysisViewInputError([
        {
          path: ["source"],
          reason: "invalid_format",
          message: "Parent Evidence ID is not a digest-backed identifier.",
        },
      ]),
    );
  if (view.kind === "javascript-routes") {
    const projected = projectJavaScriptRoutesView(parent, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (isGroupingView(view)) {
    const grouped = projectGroupingView(parent, view, accumulators);
    return grouped.ok ? ok(sealAnalysisView(grouped.value)) : grouped;
  }
  if (parent.operation === "inspect_web_network_capture") {
    const projected = projectWebNetworkCaptureView(parent, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (parent.operation === "inspect_pcap_capture") {
    const projected = projectPcapCaptureView(parent, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (parent.operation === "inspect_byte_entropy") {
    const report = parseAnalysisViewResult(byteEntropySchema, parent);
    if (!report.ok) return report;
    const projected = projectByteEntropyView(parent, report.value, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (parent.operation === "inspect_binary_layout") {
    const layout = parseAnalysisViewResult(
      { safeParse: safeParseOwnedBinaryLayout },
      parent,
    );
    if (!layout.ok) return layout;
    const projected = projectBinaryLayoutView(parent, layout.value, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (parent.operation === "analyze_javascript_application") {
    const analysis = parseJavaScriptParent(parent.normalizedResult);
    if (!analysis.ok) return analysis;
    const projected = projectJavaScriptApplicationView(
      parent,
      analysis.value,
      view,
    );
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  if (parent.operation === "analyze_function") {
    const native = parseAnalysisViewResult(functionDossierSchema, parent);
    if (!native.ok) return native;
    const projected = projectNativeFunctionView(parent, native.value, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  const project = retainedViewProjectors.get(parent.operation);
  if (project !== undefined) {
    const projected = project(parent, view);
    return projected.ok ? ok(sealAnalysisView(projected.value)) : projected;
  }
  return err(unsupportedParent(parent));
};
