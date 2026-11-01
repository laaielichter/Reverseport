import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { parseBinary } from "plist";

import { appleResourceKeyFields } from "../../domain/apple/appleAssetCatalog.js";
import {
  interfaceBuilderConnectionFieldNames,
  interfaceBuilderRuntimeClassName,
  requireInterfaceBuilderArchive,
  isInterfaceBuilderConnectionClass,
  isSourceLessAppKitAnnotationConnector,
  isUIKitRuntimeConnectionClass,
} from "../../domain/apple/interfaceBuilderKeyedArchive.js";
import { streamChunkToBuffer } from "../StreamBytes.js";
import { DirectoryArtifactReader } from "../DirectoryArtifactReader.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { ArtifactTraversalObservation } from "../ArtifactTraversalObservation.js";
import {
  projectPlistValue,
  binaryDatePrecisionOverlapLimitation,
  negativeZeroRealLimitation,
  nonFiniteRealLimitation,
  unknownDateLimitation,
  unknownScalarLimitation,
} from "../../domain/apple/plistValue.js";
import {
  omittedPrototypeKeysLimitation,
  parseXmlPropertyList,
} from "../../domain/propertyListKeys.js";
import {
  decodeNibArchive,
  nibCollectionMembers,
  type NibArchiveDocument,
} from "./NibArchive.js";
import { preflightPropertyListDecode } from "./PropertyListDecodeBudget.js";
import {
  interfaceBuilderDecodeBudgetFailure,
  InterfaceBuilderDecodeBudget,
  InterfaceBuilderDecodeBudgetExceeded,
} from "./InterfaceBuilderDecodeBudget.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReaderTraversal,
} from "../ArtifactReader.js";
import {
  buildInterfaceBuilderAnalysis,
  interfaceBuilderLimitsSchema,
  type InterfaceBuilderDocumentInput,
} from "../../domain/apple/interfaceBuilderGraph.js";
import {
  mergeNibHierarchies,
  projectNibViewHierarchy,
  type NibHierarchyNode,
} from "./NibViewHierarchy.js";
import { jsonValueSchema, type JsonValue } from "../../domain/jsonValue.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";

import { decodeXmlPlistText } from "../../domain/propertyListXmlText.js";
import {
  decodeBinaryPlistScalars,
  retainBinaryPlistUidIdentity,
  scanBinaryPlistScalars,
  UnsupportedBinaryPlistUidError,
  type BinaryPlistScalarDecodePlan,
} from "./PlistScalars.js";
import type { PlistNumberLiterals } from "../../domain/apple/plistNumbers.js";
import {
  hasBinaryPlistSignature,
  hasNibArchiveSignature,
} from "../../domain/apple/appleArchiveFormat.js";

const MAX_AGGREGATE_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_AGGREGATE_DECODE_BYTES = 256 * 1024 * 1024;
const MAX_REPORTED_OMITTED_ARCHIVES = 64;

interface OmittedArchive {
  readonly path: string;
  readonly reason: string;
  readonly limitations: readonly string[];
}

interface InterfaceBuilderBundleInput {
  readonly bundlePath: string;
  readonly targetSha256: string | null;
  readonly resourceRoot?: import("../../domain/apple/bundleResourceRoot.js").BundleResourceRoot;
  readonly limits?: unknown;
  readonly signal?: AbortSignal;
  readonly resources?: ArtifactResourceScope;
}

/** Own decoding and directory finalization under the caller's resource scope. */
export const analyzeInterfaceBuilderBundle = (
  input: InterfaceBuilderBundleInput,
) => {
  const resources = input.resources ?? new ArtifactResourceScope();
  return resources.run(() => decodeInterfaceBuilderBundle(input, resources));
};

/** Decode compiled archives while keeping their reader's completion distinct from cleanup. */
const decodeInterfaceBuilderBundle = async (
  input: InterfaceBuilderBundleInput,
  resources: ArtifactResourceScope,
) => {
  const limits = interfaceBuilderLimitsSchema.parse(input.limits ?? {});
  const reader = new DirectoryArtifactReader(input.bundlePath);
  const documents: InterfaceBuilderDocumentInput[] = [];
  const invalid: string[] = [];
  const omittedArchives: OmittedArchive[] = [];
  let unreportedOmittedArchives = 0;
  const incompleteHierarchies = new Map<string, number>();
  const unexaminedSources = new Map<string, readonly NibUnexaminedSource[]>();
  const unresolvedConnections = new Map<string, number>();
  const prototypeKeyOmissions = new Map<string, number | null>();
  const unknownDates = new Map<string, number>();
  const datePrecisionOverlaps = new Map<string, number>();
  const unknownScalars = new Map<string, number>();
  const nonFiniteReals = new Map<string, number>();
  const negativeZeroReals = new Map<string, number>();
  let omitted = 0;
  let attempted = 0;
  let aggregateInputBytes = 0;
  const traversal = new ArtifactTraversalObservation();
  const decodeBudget = new InterfaceBuilderDecodeBudget(
    MAX_AGGREGATE_DECODE_BYTES,
  );
  let outcome: { kind: "completed" } | { kind: "failed"; cause: unknown } = {
    kind: "completed",
  };
  const recordOmittedArchive = (
    path: string,
    reason: string,
    limitations: readonly string[] = [],
  ): void => {
    if (omittedArchives.length < MAX_REPORTED_OMITTED_ARCHIVES)
      omittedArchives.push({ path, reason, limitations });
    else unreportedOmittedArchives += 1;
  };
  try {
    const selection = await selectInterfaceBuilderCandidates(
      reader,
      input.signal,
      limits.max_documents,
      traversal,
    );
    omitted = selection.omitted;
    for (const entry of selection.omittedSamples)
      recordOmittedArchive(entry.path, "max_documents");
    for (const entry of selection.symlinkSamples)
      recordOmittedArchive(
        entry.path,
        "symlink_not_followed",
        entry.limitations,
      );
    unreportedOmittedArchives += selection.unreportedOmitted;
    for (const entry of selection.selected) {
      // Plist representation reserved for this document before decoding.
      let plistReservation = 0;
      try {
        const remainingInputBytes =
          MAX_AGGREGATE_INPUT_BYTES - aggregateInputBytes;
        if (
          entry.declaredSize !== null &&
          entry.declaredSize > remainingInputBytes
        ) {
          omitted += 1;
          recordOmittedArchive(entry.path, "aggregate_decode_budget_exhausted");
          continue;
        }
        attempted += 1;
        const bytes = await readEntry(
          reader,
          entry,
          input.signal,
          remainingInputBytes,
        );
        aggregateInputBytes += bytes.length;
        const isNibArchive = hasNibArchiveSignature(bytes);
        let nib: ReturnType<typeof projectNibArchive> | null = null;
        let xmlText: string | undefined;
        let binaryPrototypeKeyObserved = false;
        let scalarPlan: BinaryPlistScalarDecodePlan = {
          reachableDateOffsets: [],
          overlappingDateOffsets: [],
          reachableWideIntegerOffsets: [],
          overlappingWideIntegerOffsets: [],
          reachableNumericOffsets: [],
          uidOffsetsToNormalize: [],
        };
        let datePrecisionOverlapCount = 0;
        if (isNibArchive) {
          const documentBudget = new InterfaceBuilderDecodeBudget(
            decodeBudget.remainingBytes,
          );
          nib = projectNibArchive(
            decodeNibArchive(bytes, documentBudget),
            documentBudget,
            limits.max_objects,
          );
          decodeBudget.reserve(
            documentBudget.usedBytes,
            "NIBArchive representation exceeds the aggregate Interface Builder decode budget",
          );
        } else {
          if (!hasBinaryPlistSignature(bytes))
            xmlText = decodeXmlPlistText(bytes);
          const decodedReservation = preflightPropertyListDecode(
            bytes,
            decodeBudget.remainingBytes,
            xmlText,
            {
              numberProjection: true,
              uidProjection: true,
              budget: "the aggregate Interface Builder decode budget",
              fail: interfaceBuilderDecodeBudgetFailure,
            },
          );
          decodeBudget.reserve(
            decodedReservation.estimatedBytes,
            "plist representation exceeds the aggregate Interface Builder decode budget",
          );
          plistReservation = decodedReservation.estimatedBytes;
          binaryPrototypeKeyObserved =
            decodedReservation.binaryPrototypeKeyObserved;
          scalarPlan = decodedReservation;
          datePrecisionOverlapCount =
            decodedReservation.datePrecisionOverlapCount;
        }
        const {
          value: raw,
          omittedPrototypeKeys,
          unknownDateCount,
          unknownScalarCount,
          numberLiterals,
        } = nib === null
          ? decodePlist(bytes, xmlText, binaryPrototypeKeyObserved, scalarPlan)
          : {
              value: nib.raw,
              omittedPrototypeKeys: 0,
              unknownDateCount: 0,
              unknownScalarCount: 0,
              numberLiterals: undefined,
            };
        requireInterfaceBuilderArchive(raw);
        if (nib !== null && nib.unexaminedSources.length > 0)
          unexaminedSources.set(entry.path, nib.unexaminedSources);
        if (nib !== null && nib.omitted > 0)
          incompleteHierarchies.set(entry.path, nib.omitted);
        if (nib !== null && nib.unresolvedConnections > 0)
          unresolvedConnections.set(entry.path, nib.unresolvedConnections);
        if (nib !== null && nib.nonFiniteRealCount > 0)
          nonFiniteReals.set(entry.path, nib.nonFiniteRealCount);
        if (nib !== null && nib.negativeZeroRealCount > 0)
          negativeZeroReals.set(entry.path, nib.negativeZeroRealCount);
        if (omittedPrototypeKeys !== 0)
          prototypeKeyOmissions.set(entry.path, omittedPrototypeKeys);
        if (unknownDateCount !== 0)
          unknownDates.set(entry.path, unknownDateCount);
        if (datePrecisionOverlapCount > 0)
          datePrecisionOverlaps.set(entry.path, datePrecisionOverlapCount);
        if (unknownScalarCount !== 0)
          unknownScalars.set(entry.path, unknownScalarCount);
        const documentHash = createHash("sha256").update(bytes).digest("hex");
        documents.push({
          relativePath: entry.path,
          archiveSha256: documentHash,
          documentKind: entry.path.includes(".storyboardc/")
            ? "storyboard_scene"
            : "nib",
          raw,
          ...(numberLiterals === undefined ? {} : { numberLiterals }),
          ...(nib === null || nib.omitted === 0
            ? {}
            : { omittedSerializedHierarchyReferences: nib.omitted }),
        });
      } catch (cause: unknown) {
        // Failed documents retain no plist representation, whatever phase
        // rejected them. Do not charge that representation to later archives.
        decodeBudget.release(plistReservation);
        if (input.signal?.aborted === true) throw cause;
        // Read/identity failures describe source acquisition, not bad content.
        if (cause instanceof ArtifactReaderFailure) throw cause;
        if (cause instanceof InterfaceBuilderDecodeBudgetExceeded) {
          // A document rejected while decoding, e.g. beyond the shared depth
          // limit, retains no representation; later documents keep its share.
          omitted += 1;
          recordOmittedArchive(entry.path, cause.reason);
          continue;
        }
        if (cause instanceof UnsupportedBinaryPlistUidError) {
          omitted += 1;
          recordOmittedArchive(entry.path, "unsupported_uid_exact_range");
          continue;
        }
        invalid.push(
          `${entry.path}: ${cause instanceof Error ? cause.message : "archive decode failed"}`,
        );
      }
    }
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  const released = await resources.release({
    kind: "reader",
    reader,
    resource: input.bundlePath,
  });
  if (released.kind === "failed")
    throw resources.cleanupFailure(outcome, [released]);
  if (outcome.kind === "failed") throw outcome.cause;
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: input.targetSha256,
    ...(input.resourceRoot === undefined
      ? {}
      : { resourceRoot: input.resourceRoot }),
    toolVersion: "rea-interface-builder/1",
    documents,
    limits,
  });
  return finalizeHierarchyCoverage(result, {
    unexaminedSources,
    incompleteHierarchies,
    unresolvedConnections,
    prototypeKeyOmissions,
    unknownDates,
    datePrecisionOverlaps,
    unknownScalars,
    nonFiniteReals,
    negativeZeroReals,
    invalid,
    omittedArchives,
    unreportedOmittedArchives,
    attempted,
    omitted,
    traversal: traversal.snapshot(),
  });
};

/** Select lexically earliest document paths independent of host traversal order. */
const selectInterfaceBuilderCandidates = async (
  reader: DirectoryArtifactReader,
  signal: AbortSignal | undefined,
  maximumDocuments: number,
  traversal: ArtifactTraversalObservation,
): Promise<{
  readonly selected: readonly ArtifactEntry[];
  readonly omittedSamples: readonly ArtifactEntry[];
  readonly symlinkSamples: readonly ArtifactEntry[];
  readonly omitted: number;
  readonly unreportedOmitted: number;
}> => {
  const capacity = maximumDocuments + MAX_REPORTED_OMITTED_ARCHIVES;
  const candidates: ArtifactEntry[] = [];
  const symlinkSamples: ArtifactEntry[] = [];
  let symlinks = 0;
  let unclassifiedSymlinks = 0;
  let firstUnclassifiedSymlink: string | undefined;
  let total = 0;
  for await (const entry of reader.entries(signal, traversal)) {
    if (entry.kind === "symlink") {
      if (
        isInterfaceBuilderArchive(entry.path) ||
        entry.path.toLowerCase().endsWith(".storyboardc")
      ) {
        symlinks += 1;
        retainCandidate(symlinkSamples, entry, MAX_REPORTED_OMITTED_ARCHIVES);
      } else {
        unclassifiedSymlinks += 1;
        firstUnclassifiedSymlink ??= entry.path;
      }
      continue;
    }
    if (entry.kind !== "file" || !isInterfaceBuilderArchive(entry.path))
      continue;
    total += 1;
    retainCandidate(candidates, entry, capacity);
  }
  if (unclassifiedSymlinks > 0)
    traversal.onCoverage({
      status: "unknown",
      limitations: [
        `Interface Builder discovery did not follow ${unclassifiedSymlinks} symlink(s); whether they contain archives is unknown. First path: ${JSON.stringify(firstUnclassifiedSymlink)}.`,
      ],
    });
  const omittedSamples = candidates.slice(maximumDocuments, capacity);
  return {
    selected: candidates.slice(0, maximumDocuments),
    omittedSamples,
    symlinkSamples,
    omitted: Math.max(0, total - maximumDocuments) + symlinks,
    unreportedOmitted:
      Math.max(0, total - maximumDocuments - omittedSamples.length) +
      symlinks -
      symlinkSamples.length,
  };
};

/** Keep the earliest bounded path set; directory iteration order is host-defined. */
const retainCandidate = (
  candidates: ArtifactEntry[],
  entry: ArtifactEntry,
  maximum: number,
): void => {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const existing = candidates[middle];
    if (
      existing !== undefined &&
      compareUnicodeCodePoints(existing.path, entry.path) < 0
    )
      low = middle + 1;
    else high = middle;
  }
  candidates.splice(low, 0, entry);
  if (candidates.length > maximum) candidates.pop();
};

const finalizeHierarchyCoverage = (
  result: ReturnType<typeof buildInterfaceBuilderAnalysis>,
  counts: {
    unexaminedSources: ReadonlyMap<string, readonly NibUnexaminedSource[]>;
    incompleteHierarchies: ReadonlyMap<string, number>;
    unresolvedConnections: ReadonlyMap<string, number>;
    prototypeKeyOmissions: ReadonlyMap<string, number | null>;
    unknownDates: ReadonlyMap<string, number>;
    datePrecisionOverlaps: ReadonlyMap<string, number>;
    unknownScalars: ReadonlyMap<string, number>;
    nonFiniteReals: ReadonlyMap<string, number>;
    negativeZeroReals: ReadonlyMap<string, number>;
    invalid: readonly string[];
    omittedArchives: readonly OmittedArchive[];
    unreportedOmittedArchives: number;
    attempted: number;
    omitted: number;
    traversal: ArtifactReaderTraversal;
  },
) => {
  const {
    unexaminedSources,
    incompleteHierarchies,
    unresolvedConnections,
    prototypeKeyOmissions,
    unknownDates,
    datePrecisionOverlaps,
    unknownScalars,
    nonFiniteReals,
    negativeZeroReals,
    invalid,
    omittedArchives,
    unreportedOmittedArchives,
  } = counts;
  const archiveDecodePartial =
    invalid.length > 0 ||
    unexaminedSources.size > 0 ||
    prototypeKeyOmissions.size > 0 ||
    counts.omitted > 0 ||
    counts.traversal.status === "unknown";
  return {
    ...result,
    documents: result.documents.map((document) => ({
      ...document,
      hierarchy_complete:
        document.hierarchy_complete &&
        !(unexaminedSources.get(document.relative_path) ?? []).some((source) =>
          source.facets.includes("hierarchy"),
        ),
      connection_count:
        document.connection_count +
        (unresolvedConnections.get(document.relative_path) ?? 0),
    })),
    graph: {
      ...result.graph,
      coverage: [
        ...result.graph.coverage.map((facet) => {
          const omittedConnection = unresolvedConnections.get(
            facet.facet.replace(/^connections:/u, ""),
          );
          const [kind, ...pathParts] = facet.facet.split(":");
          const source = (
            unexaminedSources.get(pathParts.join(":")) ?? []
          ).find((source) =>
            source.facets.some((affected) => affected === kind),
          );
          if (source !== undefined)
            return {
              ...facet,
              status: "partial" as const,
              reason: facet.reason ?? source.reason,
            };
          return facet.facet.startsWith("connections:") &&
            omittedConnection !== undefined
            ? {
                ...facet,
                status: "partial" as const,
                // A connection dropped by the limit is recoverable by raising
                // it, so that cause keeps the reason the graph already named.
                // Only a facet with no other cause reports the omission.
                reason: facet.reason ?? "connection_unresolved",
                omitted: facet.omitted + omittedConnection,
              }
            : facet;
        }),
        {
          facet: "archive_decode",
          status: archiveDecodePartial
            ? ("partial" as const)
            : ("complete" as const),
          reason: omittedArchives.some(
            ({ reason }) => reason === "aggregate_decode_budget_exhausted",
          )
            ? "aggregate_decode_budget_exhausted"
            : omittedArchives.some(({ reason }) => reason === "max_documents")
              ? "document_limit_reached"
              : omittedArchives.some(
                    ({ reason }) => reason === "symlink_not_followed",
                  )
                ? "archive_symlink_not_followed"
                : omittedArchives.length > 0
                  ? "archive_decode_budget_exhausted"
                  : invalid.length > 0
                    ? "one_or_more_archives_invalid"
                    : prototypeKeyOmissions.size > 0
                      ? "dictionary_entries_omitted"
                      : unexaminedSources.size > 0
                        ? "serialized_archive_content_unexamined"
                        : counts.traversal.status === "unknown"
                          ? "source_traversal_unknown"
                          : null,
          examined: counts.attempted,
          omitted: counts.omitted,
        },
      ],
      truncated:
        result.graph.truncated ||
        counts.omitted > 0 ||
        archiveDecodePartial ||
        unresolvedConnections.size > 0,
    },
    limitations: [
      ...result.limitations,
      ...counts.traversal.limitations,
      ...[...unexaminedSources].flatMap(([path, sources]) =>
        sources.map((source) => `${path}: ${source.description}`),
      ),
      "Compiled Interface Builder archives are private serialized object graphs. The decoder reports only recognized keyed-archive objects and connections; unrecognized object classes and fields remain unknown.",
      ...(incompleteHierarchies.size === 0
        ? []
        : [
            "Some serialized hierarchy links could not be projected within the bounded hierarchy; their parentage remains unknown.",
          ]),
      ...(unresolvedConnections.size === 0
        ? []
        : [
            "Some recognized NIBArchive connectors declare no resolvable owner; they carry no connection evidence and are reported as omissions.",
          ]),
      ...(invalid.length === 0
        ? []
        : [
            `Some Interface Builder archives could not be decoded: ${invalid.slice(0, 16).join("; ")}`,
          ]),
      ...[...prototypeKeyOmissions].map(
        ([path, count]) => `${path}: ${omittedPrototypeKeysLimitation(count)}`,
      ),
      ...[...unknownDates].map(
        ([path, count]) => `${path}: ${unknownDateLimitation(count)}`,
      ),
      ...[...datePrecisionOverlaps].map(([path, count]) => {
        return `${path}: ${binaryDatePrecisionOverlapLimitation(count)}`;
      }),
      ...[...unknownScalars].map(
        ([path, count]) => `${path}: ${unknownScalarLimitation(count)}`,
      ),
      ...[...nonFiniteReals].map(
        ([path, count]) => `${path}: ${nonFiniteRealLimitation(count)}`,
      ),
      ...[...negativeZeroReals].map(
        ([path, count]) => `${path}: ${negativeZeroRealLimitation(count)}`,
      ),
      ...omittedArchives.flatMap(({ path, reason, limitations }) => [
        `${path}: omitted because ${reason.replaceAll("_", " ")}.`,
        ...limitations.map((limitation) => `${path}: ${limitation}`),
      ]),
      ...(unreportedOmittedArchives === 0
        ? []
        : [
            `${unreportedOmittedArchives} additional omitted archive path(s) and their reasons were not retained; reporting is bounded to ${MAX_REPORTED_OMITTED_ARCHIVES} paths.`,
          ]),
    ],
  };
};

interface NibUnexaminedSource {
  readonly reason: string;
  readonly facets: readonly (
    | "objects"
    | "connections"
    | "hierarchy"
    | "classes"
  )[];
  readonly description: string;
}

/** Project decoded NIB records into the same bounded graph input as ibtool. */
const projectNibArchive = (
  archive: NibArchiveDocument,
  budget: InterfaceBuilderDecodeBudget,
  maxHierarchyNodes: number,
) => {
  const unexaminedSources: NibUnexaminedSource[] = [];
  for (const object of archive.objects) {
    const name = object.class_name.replace(/\0+$/u, "");
    if (
      name === "UINib" &&
      ["UINib.archiveData", "archiveData"].some((key) =>
        Object.hasOwn(object.values, key),
      )
    )
      unexaminedSources.push({
        reason: "embedded_nib_archive_not_decoded",
        facets: ["objects", "connections", "hierarchy", "classes"],
        description: `UINib object ${object.id} retains embedded archive data whose objects, connections, classes and hierarchy are not decoded.`,
      });
    if (name === "UIStoryboardShowSegueTemplate")
      unexaminedSources.push({
        reason: "storyboard_segue_template_not_decoded",
        facets: ["connections"],
        description: `Storyboard segue template object ${object.id} is retained as source data; its connection is not decoded.`,
      });
  }
  const byId = new Map(archive.objects.map((object) => [object.id, object]));
  const normalizedClassNames = new Map<string, string>();
  const normalizeClassName = (value: string): string => {
    const known = normalizedClassNames.get(value);
    if (known !== undefined) return known;
    const normalized = value.replace(/\0+$/u, "");
    normalizedClassNames.set(value, normalized);
    return normalized;
  };
  const decodedStrings = new Map<number, string | null>();
  const unavailableStringIds = new Set<number>();
  const decodedString = (
    objectId: number,
    object: NibArchiveDocument["objects"][number],
  ): string | null => {
    if (decodedStrings.has(objectId))
      return decodedStrings.get(objectId) ?? null;
    const data = object.values["NS.bytes"];
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      decodedStrings.set(objectId, null);
      return null;
    }
    const encoded = data.$nib_data_base64;
    if (typeof encoded !== "string") {
      decodedStrings.set(objectId, null);
      return null;
    }
    budget.reserve(
      64 + encoded.length * 2,
      "NIBArchive string projection exceeds the aggregate Interface Builder decode budget",
    );
    let value: string;
    try {
      // NSString's NS.bytes representation is UTF-8. A failed conversion
      // does not establish a replacement-character class, title or selector.
      value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Buffer.from(encoded, "base64"),
      );
    } catch {
      unavailableStringIds.add(objectId);
      decodedStrings.set(objectId, null);
      return null;
    }
    decodedStrings.set(objectId, value);
    return value;
  };
  let projectedFields = 0;
  for (const object of archive.objects)
    projectedFields +=
      Object.keys(object.values).length +
      Object.values(object.repeated_values ?? {}).reduce(
        (count, values) => count + values.length,
        0,
      );
  budget.reserve(
    archive.objects.length * 128 + projectedFields * 128,
    "NIBArchive graph projection exceeds the aggregate Interface Builder decode budget",
  );
  budget.reserve(
    archive.classes.length * 96,
    "NIBArchive class projection exceeds the aggregate Interface Builder decode budget",
  );
  let nonFiniteRealCount = 0;
  let negativeZeroRealCount = 0;
  const projectedValues = new Map<
    number,
    Readonly<Record<string, JsonValue>>
  >();
  const projectedRepeatedValues = new Map<number, JsonValue>();
  for (const object of archive.objects) {
    const projected = projectPlistValue(object.values);
    nonFiniteRealCount += projected.nonFiniteRealCount;
    negativeZeroRealCount += projected.negativeZeroRealCount;
    projectedValues.set(
      object.id,
      projected.value as Readonly<Record<string, JsonValue>>,
    );
    if (object.repeated_values !== undefined) {
      const repeated = projectPlistValue(object.repeated_values);
      nonFiniteRealCount += repeated.nonFiniteRealCount;
      negativeZeroRealCount += repeated.negativeZeroRealCount;
      projectedRepeatedValues.set(object.id, repeated.value);
    }
  }
  const dereference = (value: JsonValue | undefined): JsonValue | undefined => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return value;
    const encodedData = value.$nib_data_base64;
    if (typeof encodedData === "string") {
      budget.reserveBase64JsonStringOccurrence(encodedData);
      return value;
    }
    const ref = value.$nib_object_ref;
    if (typeof ref !== "number") return value;
    const target = byId.get(ref);
    if (target === undefined) return undefined;
    if (normalizeClassName(target.class_name) === "NSString") {
      const string = decodedString(ref, target);
      if (string !== null) {
        budget.reserveJsonStringOccurrence(string);
        return string;
      }
    }
    return { objectID: String(ref) };
  };
  const referencedString = (value: JsonValue | undefined): string | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const ref = value.$nib_object_ref;
    if (typeof ref !== "number") return null;
    const target = byId.get(ref);
    if (
      target === undefined ||
      normalizeClassName(target.class_name) !== "NSString"
    )
      return null;
    const string = decodedString(ref, target);
    if (string === null) return null;
    budget.reserveJsonStringOccurrence(string);
    return string;
  };
  const runtimeClasses = new Map<number, string | null>();
  const runtimeClass = (objectId: number): string | null => {
    if (runtimeClasses.has(objectId))
      return runtimeClasses.get(objectId) ?? null;
    const object = byId.get(objectId);
    if (object === undefined) return null;
    const storedClass = normalizeClassName(object.class_name);
    const resolvedClass = interfaceBuilderRuntimeClassName(
      storedClass,
      (field) => {
        const value = object.values[field];
        return typeof value === "string" ? value : referencedString(value);
      },
    );
    runtimeClasses.set(objectId, resolvedClass);
    return resolvedClass;
  };
  const projectObject = (
    object: NibArchiveDocument["objects"][number],
  ): readonly [string, JsonValue] => {
    const className =
      runtimeClass(object.id) ?? normalizeClassName(object.class_name);
    budget.reserveJsonStringOccurrence(className);
    let name = className;
    for (const [key, value] of Object.entries(object.values)) {
      if (!/(?:title|label|identifier|accessibility|name|contents)/iu.test(key))
        continue;
      const resolved = dereference(value);
      if (typeof resolved !== "string") continue;
      name = resolved;
      break;
    }
    budget.reserveJsonStringOccurrence(name);
    const nibValues = Object.fromEntries(
      Object.entries(projectedValues.get(object.id) ?? {}).map(
        ([key, value]) => {
          budget.reserveJsonPropertyNameOccurrence(key);
          return [key, dereference(value) ?? null];
        },
      ),
    );
    // Normalize only recognized scalar fields at the format owner. A keyed
    // archive's authored nibValues dictionary must not gain this meaning.
    const resourceFields = appleResourceKeyFields(nibValues);
    for (const [field, value] of resourceFields) {
      budget.reserveJsonPropertyNameOccurrence(field);
      budget.reserveJsonStringOccurrence(value);
    }
    return [
      String(object.id),
      {
        customClass: className,
        label: name,
        objectID: String(object.id),
        nibValues,
        ...(projectedRepeatedValues.has(object.id)
          ? { nibRepeatedValues: projectedRepeatedValues.get(object.id)! }
          : {}),
        ...(className === normalizeClassName(object.class_name)
          ? {}
          : {
              interface_builder_archived_class_name: normalizeClassName(
                object.class_name,
              ),
            }),
        ...Object.fromEntries(resourceFields),
      },
    ];
  };
  const objects = Object.fromEntries(
    archive.objects
      .filter((object) => {
        const name = normalizeClassName(object.class_name);
        return (
          !/^(?:NSObject|NSIBObjectData|NSString|NSMutableString|NSNumber|NSArray|NSMutableArray|NSSet|NSMutableSet|NSDictionary|NSMutableDictionary|NSApplication|NSNib.*Connector)$/u.test(
            name,
          ) && !isUIKitRuntimeConnectionClass(name)
        );
      })
      .map(projectObject),
  );
  const connections: Record<string, JsonValue[]> = {};
  const hierarchy: NibHierarchyNode[] = [];
  // A recognized connector whose owner reference cannot be resolved produces no
  // connection entry, so the omission has to be counted here: the projected
  // dictionary carries no trace of it for a downstream consumer to find.
  let unresolvedConnections = 0;
  const reference = (value: JsonValue | undefined): number | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    return typeof value.$nib_object_ref === "number"
      ? value.$nib_object_ref
      : null;
  };
  for (const object of archive.objects) {
    const className = normalizeClassName(object.class_name);
    // AppKit connectors use NS-prefixed keys; UIKit's runtime outlet and
    // event connections use UI-prefixed keys with the same roles.
    if (!isInterfaceBuilderConnectionClass(className)) continue;
    const values = object.values;
    const connectionFields = interfaceBuilderConnectionFieldNames(className);
    // A source-less known AppKit annotation names one object, not a connection.
    // Unknown connectors and annotations with an encoded source remain evidence.
    if (isSourceLessAppKitAnnotationConnector(className, values)) continue;
    const source = reference(values[connectionFields.source]);
    if (source === null) {
      unresolvedConnections += 1;
      continue;
    }
    const destination = reference(values[connectionFields.destination]);
    const label = referencedString(values[connectionFields.label]);
    const type = className.includes("Outlet")
      ? "outlet"
      : className.includes("Control") || className.includes("Event")
        ? "action"
        : className;
    budget.reserveJsonStringOccurrence(type);
    const eventMask = values.UIEventMask;
    // The source is the outlet owner or the sending control; the destination
    // is the outlet value or the action target, and a nil target is the
    // first responder.
    const members =
      className === "UIRuntimeOutletCollectionConnection"
        ? nibCollectionMembers(
            destination === null ? undefined : byId.get(destination),
          )
        : undefined;
    if (
      className === "UIRuntimeOutletCollectionConnection" &&
      members === undefined
    ) {
      unresolvedConnections += 1;
      continue;
    }
    if (members !== undefined && members.length === 0) {
      unexaminedSources.push({
        reason: "empty_outlet_collection_not_projected",
        facets: ["connections"],
        description: `Outlet collection object ${object.id} has no serialized members; its raw collection endpoint is not projected as a relationship.`,
      });
      continue;
    }
    const destinations =
      members === undefined ? [destination] : members.map(reference);
    for (const [memberIndex, member] of destinations.entries()) {
      if (members !== undefined && member === null) {
        unresolvedConnections += 1;
        continue;
      }
      (connections[String(source)] ??= []).push({
        type,
        "destination-id": member === null ? null : String(member),
        label,
        source_id: String(source),
        archive_object_id: String(object.id),
        ...(members === undefined
          ? {}
          : {
              archive_collection_id: destination,
              archive_collection_member_index: memberIndex,
            }),
        ...(typeof eventMask === "number" ? { ui_event_mask: eventMask } : {}),
      });
    }
  }
  // Retain only string sources whose shared lazy interpretation failed.
  // Reuse the ordinary projection and graph admission for their raw bytes.
  for (const id of unavailableStringIds) {
    const object = byId.get(id);
    if (object !== undefined) {
      const [key, value] = projectObject(object);
      objects[key] = value;
    }
  }
  if (unavailableStringIds.size > 0)
    unexaminedSources.push({
      reason: "nib_string_utf8_unavailable",
      facets: ["objects", "connections", "classes"],
      description: `NSString NS.bytes is not valid UTF-8 for ${unavailableStringIds.size} source objects; their bytes and object IDs are retained, while dependent class names, titles and selectors remain unknown.`,
    });
  let hierarchyOmitted = 0;
  let hierarchyNodeCount = 0;
  const hierarchyFor = (
    objectId: number,
    seen: Set<number>,
    depth: number,
  ): NibHierarchyNode | null => {
    if (depth > 32 || seen.has(objectId)) {
      hierarchyOmitted += 1;
      return null;
    }
    if (hierarchyNodeCount >= maxHierarchyNodes) {
      hierarchyOmitted += 1;
      return null;
    }
    if (!budget.tryReserve(128)) {
      hierarchyOmitted += 1;
      return null;
    }
    const object = byId.get(objectId);
    if (object === undefined) {
      hierarchyOmitted += 1;
      return null;
    }
    hierarchyNodeCount += 1;
    const nextSeen = new Set(seen).add(objectId);
    const children: NibHierarchyNode[] = [];
    for (const [key, value] of Object.entries(object.values)) {
      if (!/(?:subviews|contentview|childviewcontrollers|view)$/iu.test(key))
        continue;
      const direct = reference(value);
      if (direct === null) continue;
      const target = byId.get(direct);
      if (target === undefined) {
        hierarchyOmitted += 1;
        continue;
      }
      if (/array|set/iu.test(target.class_name)) {
        for (const candidate of nibCollectionMembers(target) ?? []) {
          const child = reference(candidate);
          const nested =
            child === null ? null : hierarchyFor(child, nextSeen, depth + 1);
          if (nested !== null) children.push(nested);
        }
      } else {
        const nested = hierarchyFor(direct, nextSeen, depth + 1);
        if (nested !== null) children.push(nested);
      }
    }
    return { objectID: String(objectId), children };
  };
  const ibData = archive.objects.find(
    ({ class_name }) => normalizeClassName(class_name) === "NSIBObjectData",
  );
  const rootId = reference(ibData?.values.NSRoot);
  const hierarchyRoots = rootId === null ? [] : [rootId];
  for (const hierarchyRoot of hierarchyRoots) {
    const root = hierarchyFor(hierarchyRoot, new Set(), 0);
    if (root !== null) hierarchy.push(root);
  }
  const viewHierarchy = projectNibViewHierarchy(
    archive.objects,
    new Set(Object.keys(objects).map(Number)),
    () => budget.tryReserve(128),
    maxHierarchyNodes,
  );
  const merged = mergeNibHierarchies(
    hierarchy,
    viewHierarchy.hierarchy ?? [],
    () => budget.tryReserve(96),
    maxHierarchyNodes,
  );
  return {
    omitted: viewHierarchy.omitted + hierarchyOmitted + merged.omitted,
    unexaminedSources,
    unresolvedConnections,
    nonFiniteRealCount,
    negativeZeroRealCount,
    raw: jsonValueSchema.parse({
      "com.apple.ibtool.document.objects": objects,
      "com.apple.ibtool.document.connections": connections,
      "com.apple.ibtool.document.hierarchy": merged.hierarchy,
      "com.apple.ibtool.document.classes": Object.fromEntries(
        archive.classes.map((name) => {
          const className = normalizeClassName(name);
          budget.reserveJsonPropertyNameOccurrence(className);
          return [className, {}];
        }),
      ),
    }),
  };
};

const isInterfaceBuilderArchive = (path: string): boolean => {
  const lower = path.toLowerCase();
  return lower.endsWith(".nib") || lower.endsWith("/objects.nib");
};

const readEntry = async (
  reader: DirectoryArtifactReader,
  entry: ArtifactEntry,
  signal?: AbortSignal,
  maxInputBytes = MAX_AGGREGATE_INPUT_BYTES,
): Promise<Buffer> => {
  if (entry.declaredSize !== null && entry.declaredSize > maxInputBytes)
    throw new InterfaceBuilderDecodeBudgetExceeded(
      "aggregate_decode_budget_exhausted",
      "archive exceeds the aggregate Interface Builder decode budget",
    );
  const stream = await reader.open(entry, signal);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = streamChunkToBuffer(chunk);
    length += bytes.length;
    if (length > maxInputBytes) {
      stream.destroy();
      throw new InterfaceBuilderDecodeBudgetExceeded(
        "aggregate_decode_budget_exhausted",
        "archive exceeded the aggregate Interface Builder decode budget",
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
};

/**
 * The shared parser bounds plist value nesting before its recursive decode and
 * reports the limit as a RangeError; that is an omitted archive, not a
 * malformed one.
 */
const parseXmlWithinDecodeBudget = (text: string) => {
  try {
    return parseXmlPropertyList(text);
  } catch (cause: unknown) {
    if (cause instanceof RangeError)
      throw new InterfaceBuilderDecodeBudgetExceeded(
        "aggregate_decode_budget_exhausted",
        cause.message,
      );
    throw cause;
  }
};

/** Project decoded plist data and dates while retaining omitted-key coverage. */
const decodePlist = (
  bytes: Buffer,
  xmlText: string | undefined,
  binaryPrototypeKeyObserved: boolean,
  scalarPlan: BinaryPlistScalarDecodePlan,
): {
  readonly value: JsonValue;
  readonly omittedPrototypeKeys: number | null;
  readonly unknownDateCount: number;
  readonly unknownScalarCount: number;
  readonly numberLiterals: PlistNumberLiterals;
} => {
  const binary = hasBinaryPlistSignature(bytes);
  const binaryScalarMetadata = binary
    ? scanBinaryPlistScalars(bytes, scalarPlan)
    : undefined;
  const { value, omittedPrototypeKeys, numberLiterals } = binary
    ? {
        value: retainBinaryPlistUidIdentity(
          parseBinary(
            decodeBinaryPlistScalars(bytes, binaryScalarMetadata!, scalarPlan),
          ),
          scalarPlan,
        ),
        omittedPrototypeKeys: binaryPrototypeKeyObserved ? null : 0,
        numberLiterals: binaryScalarMetadata!.literals,
      }
    : parseXmlWithinDecodeBudget(xmlText ?? decodeXmlPlistText(bytes));
  const projected = projectPlistValue(value);
  return {
    value: projected.value,
    omittedPrototypeKeys,
    unknownDateCount: projected.unknownDateCount,
    unknownScalarCount: projected.unknownScalarCount,
    numberLiterals,
  };
};
