import {
  JsonSchemaReferences,
  type JsonSchemaScope,
} from "./jsonSchemaReferences.js";
import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
  schemaLiteralValues,
} from "./jsonSchemaKeywords.js";

// Kimi expands schema-local references before sending tools to Moonshot.
// Compact advertisements must fit after expansion, independently of client
// reference handling. Canonical server-side validation remains unchanged.

/** Annotation keys that carry guidance but no validation semantics. */
const annotationKeys = new Set(["description", "examples", "default", "title"]);

const definitionKeys = new Set(["$defs", "definitions"]);
// An empty schema accepts every JSON value. Kimi otherwise infers string.
const jsonValueTypes = [
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
];
// An empty item schema accepts every JSON value, including arbitrarily nested
// arrays, while satisfying clients that require `items` for array types.
const jsonValueSchema = () => ({ type: [...jsonValueTypes], items: {} });

const enumValueTypes = (values: readonly unknown[]): readonly string[] => [
  ...new Set(
    values.map((value) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      if (typeof value === "object") return "object";
      return typeof value;
    }),
  ),
];

export type AdvertisedInputSchemaPresentation = "inline" | "reduced";

/** Budget selected by the caller for compact MCP input-schema presentation. */
export interface CompactInputSchemaPresentation {
  readonly budgetBytes: number;
}

export interface CompactedInputSchema {
  readonly schema: Record<string, unknown>;
  readonly presentation: AdvertisedInputSchemaPresentation;
}

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const schemaDepth = (value: unknown, depth = 0): number => {
  if (Array.isArray(value))
    return Math.max(
      depth,
      ...value.map((child) => schemaDepth(child, depth + 1)),
    );
  if (!isSchemaObject(value)) return depth;
  return Math.max(
    depth,
    ...Object.values(value).map((child) => schemaDepth(child, depth + 1)),
  );
};

/** Strict clients commonly reject advertised schemas deeper than ten nodes. */
const COMPACT_SCHEMA_MAX_DEPTH = 10;

/** Rewrite every schema-valued position; literal data stays opaque. */
const rebuildSchemaPositions = (
  node: unknown,
  rebuild: (child: unknown) => unknown,
): unknown => {
  if (Array.isArray(node)) return node.map((child) => rebuild(child));
  if (!isSchemaObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (schemaLiteralValues.has(key)) {
      out[key] = value;
      continue;
    }
    if (schemaMaps.has(key) && isSchemaObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, rebuild(child)]),
      );
      continue;
    }
    if (schemaArrays.has(key) && Array.isArray(value)) {
      out[key] = value.map((child) => rebuild(child));
      continue;
    }
    if (schemaChildren.has(key)) {
      out[key] = Array.isArray(value)
        ? value.map((child) => rebuild(child))
        : rebuild(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

/**
 * Drop annotation prose from every subschema while preserving all validation
 * keywords. The root keeps its own description because the root-union
 * projection encodes accepted input groups there; the root's echoed literal
 * examples leave with the rest of the annotation prose.
 */
const stripAnnotations = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const rebuilt = rebuildSchemaPositions(
    schema,
    stripChildAnnotations,
  ) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rebuilt)) {
    if (annotationKeys.has(key) && key !== "description") continue;
    out[key] = value;
  }
  return out;
};

const stripChildAnnotations = (child: unknown): unknown => {
  const rebuilt = rebuildSchemaPositions(child, stripChildAnnotations);
  if (!isSchemaObject(rebuilt)) return rebuilt;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rebuilt))
    if (!annotationKeys.has(key)) kept[key] = value;
  return kept;
};

/** Stop serialization at the budget before allocating an expanded schema. */
const inlineWithinBudget = (
  root: Record<string, unknown>,
  budgetBytes: number,
): Record<string, unknown> | undefined => {
  const references = new JsonSchemaReferences(root);
  const identity = Object.fromEntries(
    ["$id", "$anchor", "$schema"].flatMap((key) =>
      Object.hasOwn(root, key) ? [[key, root[key]]] : [],
    ),
  );
  const identityBytes =
    Object.keys(identity).length === 0 ? 0 : serializedBytes(identity) - 2;
  if (identityBytes > budgetBytes) return undefined;
  let resolved = true;
  function* serialize(
    value: unknown,
    position: "schema" | "map" | "data",
    scope: JsonSchemaScope | undefined,
    active: ReadonlyMap<JsonSchemaScope, ReadonlySet<string>>,
  ): Generator<string> {
    if (Array.isArray(value)) {
      yield "[";
      for (const [index, child] of value.entries()) {
        if (index > 0) yield ",";
        yield* serialize(child, position, scope, active);
      }
      yield "]";
    } else if (isSchemaObject(value)) {
      const currentScope =
        position === "schema" ? references.enter(value, scope) : scope;
      if (
        position === "schema" &&
        (currentScope === undefined ||
          currentScope.dialect !== references.rootScope.dialect ||
          [
            "$dynamicRef",
            "$recursiveRef",
            "$dynamicAnchor",
            "$recursiveAnchor",
          ].some((key) => Object.hasOwn(value, key)))
      ) {
        resolved = false;
        return;
      }
      if (position === "schema" && Object.keys(value).length === 0) {
        yield JSON.stringify(jsonValueSchema());
        return;
      }
      if (position === "schema" && typeof value.$ref === "string") {
        const target = references.resolve(currentScope, value.$ref);
        if (
          target.kind !== "target" ||
          currentScope === undefined ||
          active.get(currentScope)?.has(value.$ref)
        ) {
          resolved = false;
          return;
        }
        const {
          $ref,
          $id: _id,
          $anchor: _anchor,
          $schema: _schema,
          ...siblings
        } = value;
        const nextActive = new Map(active);
        nextActive.set(
          currentScope,
          new Set([...(active.get(currentScope) ?? []), $ref]),
        );
        // Draft 7 ignores siblings, while clients such as Ajv also apply them.
        // Do not label either interpretation an equivalent inline advertisement.
        if (
          currentScope.dialect === "draft-07" &&
          Object.keys(siblings).length > 0
        ) {
          resolved = false;
          return;
        }
        const expanded =
          Object.keys(siblings).length === 0
            ? target.value
            : { allOf: [target.value, siblings] };
        yield* serialize(expanded, "schema", currentScope, nextActive);
        return;
      }
      yield "{";
      let first = true;
      for (const [key, child] of Object.entries(value)) {
        if (
          position === "schema" &&
          (definitionKeys.has(key) ||
            key === "$id" ||
            key === "$anchor" ||
            key === "$schema")
        )
          continue;
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(key) + ":";
        const childPosition =
          position === "map"
            ? "schema"
            : position === "schema" && schemaMaps.has(key)
              ? "map"
              : position === "schema" &&
                  (schemaArrays.has(key) || schemaChildren.has(key))
                ? "schema"
                : "data";
        yield* serialize(child, childPosition, currentScope, active);
      }
      yield "}";
    } else {
      yield JSON.stringify(value);
    }
  }
  const chunks: string[] = [];
  let bytes = identityBytes;
  for (const chunk of serialize(
    root,
    "schema",
    references.rootScope,
    new Map(),
  )) {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > budgetBytes || !resolved) return undefined;
    chunks.push(chunk);
  }
  if (!resolved) return undefined;
  const expanded: unknown = JSON.parse(chunks.join(""));
  if (!isSchemaObject(expanded)) return undefined;
  // Every emitted dependency is now static and reference-free. Nested resource
  // identifiers/anchors can leave without duplicating identities at call sites.
  const schema = { ...identity, ...expanded };
  return serializedBytes(schema) <= budgetBytes ? schema : undefined;
};

/** Preserve every possible type, including referenced and nullable unions. */
const detectedTypes = (
  schema: unknown,
  references: JsonSchemaReferences,
  inherited: JsonSchemaScope | undefined,
  active: ReadonlySet<object> = new Set(),
): readonly string[] | undefined => {
  if (!isSchemaObject(schema)) return undefined;
  const scope = references.enter(schema, inherited);
  if (scope === undefined) return undefined;
  if (typeof schema.$ref === "string") {
    if (active.has(schema)) return undefined;
    const target = references.resolve(scope, schema.$ref);
    return target.kind === "target"
      ? detectedTypes(
          target.value,
          references,
          scope,
          new Set([...active, schema]),
        )
      : undefined;
  }
  if (typeof schema.type === "string") return [schema.type];
  if (
    Array.isArray(schema.type) &&
    schema.type.every((type) => typeof type === "string")
  )
    return schema.type;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const enumTypes = enumValueTypes(schema.enum);
    if (enumTypes.every((type) => jsonValueTypes.includes(type)))
      return enumTypes;
  }
  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  if (alternatives.length === 0) return undefined;
  const types = alternatives.map((branch) =>
    detectedTypes(branch, references, scope, active),
  );
  if (types.some((type) => type === undefined)) return undefined;
  return [...new Set(types.flatMap((type) => type ?? []))];
};

/** Give homogeneous array-item unions the type required by strict gateways. */
const typeArrayItemUnions = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const references = new JsonSchemaReferences(schema);
  const visit = (node: unknown): unknown => {
    const rebuilt = rebuildSchemaPositions(node, visit);
    if (!isSchemaObject(rebuilt) || rebuilt.type !== "array") return rebuilt;
    const items = rebuilt.items;
    if (
      !isSchemaObject(items) ||
      items.type !== undefined ||
      (!Array.isArray(items.oneOf) && !Array.isArray(items.anyOf))
    )
      return rebuilt;
    const types = detectedTypes(items, references, references.rootScope);
    return types?.length === 1
      ? { ...rebuilt, items: { ...items, type: types[0] } }
      : rebuilt;
  };
  return visit(schema) as Record<string, unknown>;
};

/**
 * Strict gateways reject some nested combinators, primitive enums without a
 * type, and array items whose union has no explicit type. Homogeneous item
 * unions gain their shared type; remaining incompatible shapes use the shallow
 * projection while canonical runtime validation stays intact.
 */
const hasGatewayIncompatibleShape = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(hasGatewayIncompatibleShape);
  if (!isSchemaObject(schema)) return false;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length === 0) return true;
  if (
    schema.type === "array" &&
    isSchemaObject(schema.items) &&
    schema.items.type === undefined &&
    (Array.isArray(schema.items.oneOf) || Array.isArray(schema.items.anyOf))
  )
    return true;
  if (Array.isArray(schema.required) && isSchemaObject(schema.properties)) {
    for (const name of schema.required) {
      const property = schema.properties[name];
      if (isSchemaObject(property) && containsGatewayCombinator(property))
        return true;
    }
  }
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.type === undefined
  ) {
    const types = enumValueTypes(schema.enum);
    if (
      types.length === 1 &&
      types.every((type) =>
        ["string", "number", "boolean", "null"].includes(type),
      )
    )
      return true;
  }
  return schemaChildrenAndMaps(schema).some(hasGatewayIncompatibleShape);
};

const containsGatewayCombinator = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(containsGatewayCombinator);
  if (!isSchemaObject(schema)) return false;
  if (schema.oneOf !== undefined || schema.allOf !== undefined) return true;
  return schemaChildrenAndMaps(schema).some(containsGatewayCombinator);
};

/** Traverse only schema-valued positions; property names remain opaque data. */
const schemaChildrenAndMaps = (
  schema: Readonly<Record<string, unknown>>,
): readonly unknown[] =>
  Object.entries(schema).flatMap(([key, value]) => {
    if (schemaMaps.has(key) && isSchemaObject(value))
      return Object.values(value);
    if (schemaArrays.has(key) && Array.isArray(value)) return value;
    if (schemaChildren.has(key)) return Array.isArray(value) ? value : [value];
    return [];
  });

const REDUCED_ANNOTATION =
  "Advertised in reduced form by the compact input schema profile; the server still validates complete canonical inputs.";

/**
 * Present only the root property shape with per-property guidance. Used for
 * schemas whose validation structure alone exceeds the compact budget; the
 * canonical schema still rejects malformed calls server-side.
 */
const reduceToShallowProperties = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const properties = isSchemaObject(schema.properties) ? schema.properties : {};
  const description = [
    typeof schema.description === "string" ? schema.description : undefined,
    ...Object.entries(
      isSchemaObject(schema.dependentRequired)
        ? schema.dependentRequired
        : isSchemaObject(schema.dependencies)
          ? schema.dependencies
          : {},
    ).flatMap(([property, partners]) =>
      Array.isArray(partners) &&
      partners.every((partner) => typeof partner === "string")
        ? [
            `When ${property} is provided, also provide ${partners.join(" and ")}.`,
          ]
        : [],
    ),
    REDUCED_ANNOTATION,
  ]
    .filter((text) => text !== undefined)
    .join(" ");
  const references = new JsonSchemaReferences(schema);
  const shallow = Object.fromEntries(
    Object.entries(properties).map(([name, value]) => {
      const types = detectedTypes(value, references, references.rootScope);
      const type = types?.length === 1 ? types[0] : types;
      const description =
        isSchemaObject(value) && typeof value.description === "string"
          ? { description: value.description }
          : {};
      return [
        name,
        {
          ...(type === undefined ? {} : { type }),
          // Reduced inputs intentionally omit nested validation, but clients
          // still require an item schema to accept an array declaration.
          ...(types?.includes("array") ? { items: jsonValueSchema() } : {}),
          ...description,
        },
      ];
    }),
  );
  return {
    ...(typeof schema.$schema === "string" ? { $schema: schema.$schema } : {}),
    type: "object",
    description,
    properties: shallow,
    ...(Array.isArray(schema.required)
      ? { required: [...schema.required] }
      : {}),
    ...(typeof schema.minProperties === "number"
      ? { minProperties: schema.minProperties }
      : {}),
    ...(schema.additionalProperties === false
      ? { additionalProperties: false }
      : {}),
  };
};

/**
 * Render an advertised input schema within a per-schema byte budget for
 * providers that validate the literal serialized schema size. Validation
 * keywords and the canonical contract are preserved; only
 * annotation prose and, for structurally oversized schemas, nested
 * validation detail leave the advertised form.
 */
export const compactAdvertisedInputSchema = (
  schema: Record<string, unknown>,
  budgetBytes: number,
): CompactedInputSchema => {
  const expanded = inlineWithinBudget(stripAnnotations(schema), budgetBytes);
  const inline =
    expanded === undefined ? undefined : typeArrayItemUnions(expanded);
  if (
    inline !== undefined &&
    serializedBytes(inline) <= budgetBytes &&
    schemaDepth(inline) <= COMPACT_SCHEMA_MAX_DEPTH &&
    !hasGatewayIncompatibleShape(inline)
  )
    return { schema: inline, presentation: "inline" };
  const reduced = reduceToShallowProperties(schema);
  if (serializedBytes(reduced) <= budgetBytes)
    return { schema: reduced, presentation: "reduced" };
  // A future contract with an extreme root-property count still advertises
  // an honest, budget-fitting shape instead of an oversized one.
  return {
    schema: reduceToShallowProperties({
      type: "object",
      description:
        (typeof schema.description === "string"
          ? `${schema.description} `
          : "") + REDUCED_ANNOTATION,
    }),
    presentation: "reduced",
  };
};

/** Return the JSON schema clients receive for the selected input presentation. */
export const presentAdvertisedInputSchema = (
  schema: Record<string, unknown>,
  compactPresentation: CompactInputSchemaPresentation | undefined,
): Record<string, unknown> =>
  compactPresentation === undefined
    ? schema
    : compactAdvertisedInputSchema(schema, compactPresentation.budgetBytes)
        .schema;
