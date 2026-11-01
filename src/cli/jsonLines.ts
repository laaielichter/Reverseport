import { err, ok, type Result } from "../domain/result.js";

import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { jsonParts } from "../domain/jsonSerialization.js";

/** Reserved control-record marker, not an advertised external JSON Schema. */
export const JSON_LINES_PROTOCOL = "jsonl/v1";

interface JsonLinesErrorRecord {
  readonly $rea: typeof JSON_LINES_PROTOCOL;
  readonly type: "error";
  readonly ok: false;
  readonly result: unknown;
}

interface JsonLinesMetadataRecord {
  readonly $rea: typeof JSON_LINES_PROTOCOL;
  readonly type: "metadata";
  readonly records: {
    readonly path: readonly string[];
    readonly emitted: number;
    readonly source: number | null;
    readonly filter?: string;
  };
  readonly context: Readonly<Record<string, unknown>> | null;
}

const COLLECTION_KEYS = ["rows", "items", "records", "occurrences"] as const;

interface Collection {
  readonly records: readonly unknown[];
  readonly path: readonly string[];
}

/** Parsed once, before output or token counting acquires the stream. */
export interface JsonLinesPlan extends Collection {
  readonly context: Readonly<Record<string, unknown>> | undefined;
  readonly sourceRecords: number | null;
  readonly filter: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const atPath = (value: unknown, path: readonly string[]): unknown => {
  for (const key of path) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
};

const collections = (
  value: unknown,
  prefix: readonly string[],
): Collection[] => {
  if (Array.isArray(value)) return [{ records: value, path: prefix }];
  if (!isRecord(value)) return [];
  const found: Collection[] = [];
  const collect = (
    object: Record<string, unknown>,
    path: readonly string[],
  ) => {
    for (const key of COLLECTION_KEYS) {
      const records = object[key];
      if (Object.hasOwn(object, key) && Array.isArray(records))
        found.push({ records, path: [...path, key] });
    }
  };
  collect(value, prefix);
  if (Object.hasOwn(value, "page") && isRecord(value.page))
    collect(value.page, [...prefix, "page"]);
  return found;
};

const documentCollections = (
  value: unknown,
  fullOutput: boolean,
): Collection[] => {
  const prefix = fullOutput ? ["data"] : [];
  const data = atPath(value, prefix);
  return [
    ...collections(data, prefix),
    ...collections(atPath(data, ["normalized_result"]), [
      ...prefix,
      "normalized_result",
    ]),
  ];
};

/** Shallow copies only ancestors of the emitted array; every other fact survives. */
const withoutRecords = (
  source: unknown,
  selected: unknown,
  path: readonly string[],
  filtered: boolean,
): Record<string, unknown> | undefined => {
  if (path.length === 0 || !isRecord(source)) return undefined;
  const context = { ...source };
  const selectedObject = isRecord(selected) ? selected : undefined;
  // A data filter intentionally excludes raw observation payloads. Keep its
  // selected raw value if requested, while always retaining Evidence provenance.
  if (
    filtered &&
    Object.hasOwn(source, "evidence_id") &&
    typeof source.evidence_id === "string" &&
    Object.hasOwn(source, "normalized_result")
  ) {
    if (selectedObject && Object.hasOwn(selectedObject, "raw_result"))
      context.raw_result = selectedObject.raw_result;
    else delete context.raw_result;
  }
  const [key, ...rest] = path;
  if (key === undefined) return context;
  if (rest.length === 0) delete context[key];
  else
    context[key] = withoutRecords(
      source[key],
      selectedObject?.[key],
      rest,
      filtered,
    );
  return context;
};

/** Project a clear collection without interpreting or whitelisting its context. */
export const prepareJsonLines = (
  selected: unknown,
  options: {
    readonly command: string;
    readonly source?: unknown;
    readonly filter?: string;
    readonly fullOutput?: boolean;
  },
): Result<JsonLinesPlan, AnalysisOutputError> => {
  const found = documentCollections(selected, options.fullOutput === true);
  const reject = (reason: string) =>
    err(
      new AnalysisOutputError(options.command, reason, {
        remediationAction:
          "Use --format json for the complete document, or select one record collection with --filter-output.",
      }),
    );
  if (found.length !== 1)
    return reject(
      found.length === 0
        ? "JSON Lines requires an array or one explicit rows, items, records, or occurrences collection."
        : "JSON Lines cannot choose between multiple record collections. Select one collection explicitly.",
    );
  const collection = found[0];
  if (collection === undefined)
    return reject("The record collection is unavailable.");
  for (const record of collection.records) {
    if (isRecord(record) && Object.hasOwn(record, "$rea"))
      return reject(
        "A data record uses the reserved $rea JSON Lines control marker.",
      );
  }
  const source = Object.hasOwn(options, "source") ? options.source : selected;
  const originalRecords = atPath(source, collection.path);
  const sourceMatches = Array.isArray(originalRecords);
  let context = withoutRecords(
    sourceMatches ? source : selected,
    selected,
    collection.path,
    options.filter !== undefined,
  );
  if (options.filter !== undefined && sourceMatches) {
    // Excluded peer rows are data, not context. A filter can disambiguate them
    // without restoring an unselected collection into the final record.
    for (const peer of documentCollections(
      source,
      options.fullOutput === true,
    )) {
      if (peer.path.join(".") !== collection.path.join("."))
        context = withoutRecords(context, selected, peer.path, true);
    }
  }
  return ok({
    ...collection,
    context,
    sourceRecords: sourceMatches ? originalRecords.length : null,
    filter: options.filter,
  });
};

/** The caller supplies the outcome; error-shaped data is never reclassified here. */
export const jsonLinesErrorRecord = (
  result: unknown,
): JsonLinesErrorRecord => ({
  $rea: JSON_LINES_PROTOCOL,
  type: "error" as const,
  ok: false as const,
  result,
});

export function* jsonLinesParts(plan: JsonLinesPlan): Generator<string> {
  for (const record of jsonLinesRecords(plan)) {
    yield* jsonLineParts(record);
  }
}

/** One record stays one line even when the record itself is an array. */
export function* jsonLineParts(record: unknown): Generator<string> {
  yield* jsonParts(record);
  yield "\n";
}

/** Newline-separated records also bound the token estimator's working set. */
export function* jsonLinesRecords(plan: JsonLinesPlan): Generator<unknown> {
  yield* plan.records;
  if (plan.context !== undefined || plan.path.length > 0) {
    const metadata: JsonLinesMetadataRecord = {
      $rea: JSON_LINES_PROTOCOL,
      type: "metadata",
      records: {
        path: plan.path,
        emitted: plan.records.length,
        source: plan.sourceRecords,
        ...(plan.filter === undefined ? {} : { filter: plan.filter }),
      },
      context: plan.context ?? null,
    };
    yield metadata;
  }
}
