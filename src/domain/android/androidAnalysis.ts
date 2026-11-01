import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";

const target = {
  path: localPathStringSchema.describe(
    "Local APK path; the target is never executed",
  ),
};
const classTarget = {
  ...target,
  class_name: z.string().min(1).describe("Exact fully qualified class name"),
};

/** Caller intent for static Android inspection, independent of its engine. */
export const androidInputSchemas = {
  inspect_android_package: z.strictObject(target),
  search_android_classes: z.strictObject({
    ...target,
    query: z
      .string()
      .describe("Case-sensitive class-name substring; empty lists all classes"),
  }),
  inspect_android_class: z.strictObject(classTarget),
  inspect_android_method: z.strictObject({
    ...classTarget,
    method_name: z.string().min(1),
    overload_index: z
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Explicit index among same-name methods; required when ambiguous",
      ),
  }),
  trace_android_references: z.strictObject({
    ...classTarget,
    method_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Omit for class references; select ambiguous methods with overload_index",
      ),
    overload_index: z
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Index among same-name methods from inspect_android_class; requires method_name",
      ),
  }),
} as const;

/** Optional retained delivery is separate from the engine's APK request. */
export const androidPackageInspectionInputSchema =
  androidInputSchemas.inspect_android_package.extend({
    detail: z.enum(["complete", "summary"]).optional(),
  });

/** Supported static Android operations. */
export type AndroidOperation = keyof typeof androidInputSchemas;
/** Validated Android requests carry their selected operation. */
export type AndroidRequest = {
  [Name in AndroidOperation]: {
    operation: Name;
    input: z.infer<(typeof androidInputSchemas)[Name]>;
  };
}[AndroidOperation];

/** Validate operation and input together so their types remain correlated. */
export const androidRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_android_package"),
    input: androidInputSchemas.inspect_android_package,
  }),
  z.strictObject({
    operation: z.literal("search_android_classes"),
    input: androidInputSchemas.search_android_classes,
  }),
  z.strictObject({
    operation: z.literal("inspect_android_class"),
    input: androidInputSchemas.inspect_android_class,
  }),
  z.strictObject({
    operation: z.literal("inspect_android_method"),
    input: androidInputSchemas.inspect_android_method,
  }),
  z.strictObject({
    operation: z.literal("trace_android_references"),
    input: androidInputSchemas.trace_android_references,
  }),
]);

const textCoverage = z.strictObject({
  status: z.enum(["complete", "partial"]),
  text: z.string(),
  reported_total_bytes: z.int().nonnegative().nullable(),
});

const manifestComponent = z.strictObject({
  kind: z.enum([
    "activity",
    "activity-alias",
    "service",
    "receiver",
    "provider",
  ]),
  declared_name: z.string(),
  name: z.string(),
  exported: z.boolean().nullable(),
  exported_default: z.boolean().nullable(),
  permission: z.string().nullable(),
  permission_source: z.enum(["component", "application", "none", "unknown"]),
  intent_filter_count: z.number().int().nonnegative(),
  actions: z.array(z.string()),
  categories: z.array(z.string()),
  foreground_service_type: z.string().nullable(),
  authorities: z.array(z.string()).nullable(),
  target_activity: z.string().nullable(),
});

/**
 * Static component projection of the decoded manifest. The export default is
 * Android's documented rule for an absent android:exported when one applies;
 * null also means the default is unknown or an explicit declaration is
 * required. This is not a merged-manifest or runtime observation.
 */
const manifestComponents = z.strictObject({
  status: z.enum(["complete", "partial", "unavailable"]),
  items: z.array(manifestComponent),
  limitations: z.array(z.string()),
});
/** A DEX prototype; hex parentheses also keep the advertised class valid in v mode. */
export const dexDescriptorSchema = z
  .string()
  .regex(
    /^\((?:\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))*\)(?:V|\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))$/u,
  );

const integral = <Type extends string>(type: Type, min: number, max: number) =>
  z.strictObject({
    type: z.literal(type),
    value: z.int().min(min).max(max),
  });
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;
/** Finite text must name a value of the given width; only zero text may round to zero. */
const floating = <Type extends "float" | "double">(
  type: Type,
  round: (value: number) => number,
) =>
  z.strictObject({
    type: z.literal(type),
    value: z
      .string()
      .regex(/^(?:NaN|-?Infinity|-?\d+\.\d+(?:E-?\d+)?)$/u)
      .refine((text) => {
        if (/^(?:NaN|-?Infinity)$/u.test(text)) return true;
        const rounded = round(Number(text));
        return (
          Number.isFinite(rounded) &&
          (rounded !== 0 || /^-?0\.0+(?:E-?\d+)?$/u.test(text))
        );
      }),
  });
/** A static final field's DEX static value; wide and floating values keep Java text. */
export const dexStaticValueSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
  integral("byte", -128, 127),
  integral("short", -32_768, 32_767),
  integral("char", 0, 65_535),
  integral("int", -2_147_483_648, 2_147_483_647),
  z.strictObject({
    type: z.literal("long"),
    value: z
      .string()
      .regex(/^(?:0|-?[1-9]\d*)$/u)
      .refine((text) => BigInt(text) >= LONG_MIN && BigInt(text) <= LONG_MAX),
  }),
  floating("float", Math.fround),
  floating("double", (value) => value),
  z.strictObject({ type: z.literal("string"), value: z.string() }),
]);

const method = z.strictObject({
  name: z.string(),
  reported_signature: z.string(),
  overload_index: z.int().nonnegative(),
  is_constructor: z.boolean(),
  dex_descriptor: dexDescriptorSchema,
});
const engine = z.strictObject({
  name: z.string().min(1),
  version: z.string().nullable(),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  source_revision: z.string().nullable(),
  worker_count: z.int().positive(),
  heap_limit_mib: z.int().positive().nullable(),
});
const common = { engine };

/** Portable observations with explicit decompiler and identity limitations. */
export const androidResultSchemas = {
  inspect_android_package: z.strictObject({
    ...common,
    package_name: z.string().nullable(),
    version_name: z.string().nullable(),
    version_code: z.string().nullable(),
    min_sdk: z.string().nullable(),
    target_sdk: z.string().nullable(),
    permissions: z.array(z.string()),
    manifest: textCoverage,
    // Evidence retained before the component projection existed re-parses
    // with an explicit unavailable inventory; current results always carry it.
    components: manifestComponents.default(() => ({
      status: "unavailable" as const,
      items: [],
      limitations: [
        "This Evidence predates the manifest component projection; run inspect_android_package again to obtain it.",
      ],
    })),
    class_count: z.int().nonnegative(),
    resource_count: z.int().nonnegative(),
    signature_verification: z.literal("not_performed"),
  }),
  search_android_classes: z.strictObject({
    ...common,
    query: z.string(),
    total_classes: z.int().nonnegative(),
    matches: z.array(z.string()),
    duplicate_names: z.array(
      z.strictObject({
        name: z.string(),
        occurrences: z.int().min(2),
      }),
    ),
    coverage: z.literal("complete"),
  }),
  inspect_android_class: z.strictObject({
    ...common,
    class_name: z.string(),
    methods: z.array(method),
    fields: z.array(
      z.strictObject({
        name: z.string(),
        reported_type: z.string(),
        /** Null unless a static final field encodes a supported non-null value; initializers are not applied. */
        dex_static_value: dexStaticValueSchema.nullable(),
      }),
    ),
    inner_classes: z.array(z.string()),
  }),
  inspect_android_method: z.strictObject({
    ...common,
    class_name: z.string(),
    method: method,
    overload_count: z.int().positive(),
    representation: z.enum(["java", "smali"]),
    body_status: z.enum(["available", "not_available"]),
    fell_back: z.boolean(),
    markers: z.array(z.string()),
    source: textCoverage,
  }),
  trace_android_references: z.strictObject({
    ...common,
    class_name: z.string(),
    method_name: z.string().nullable(),
    overload_index: z.int().nonnegative().nullable(),
    reported_signature: z.string().nullable(),
    dex_descriptor: dexDescriptorSchema.nullable(),
    total: z.int().nonnegative(),
    references: z.array(
      z.strictObject({
        kind: z.string(),
        name: z.string(),
        reported_full_name: z.string(),
        containing_class: z.string(),
        top_class: z.string(),
        source_line: z.null(),
        dex_offset: z.null(),
        /** false means transport-bounded instruction evidence; null is unknown. */
        direct_invokes_exhaustive: z.boolean().nullable(),
        /** Raw direct invoke instructions inside this using node, when available. */
        direct_invokes: z
          .array(
            z.strictObject({
              dex_entry: z.string().min(1),
              source_raw_method_id: z.string().min(1),
              dex_code_unit_offset: z.int().nonnegative(),
              dex_method_index: z.int().nonnegative(),
              opcode: z.string().regex(/^INVOKE_/u),
            }),
          )
          .nullable(),
      }),
    ),
    coverage: z.literal("complete"),
    reference_unit: z.literal("using_node"),
  }),
} as const;
