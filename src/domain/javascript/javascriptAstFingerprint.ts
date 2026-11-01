import { createHash } from "node:crypto";

import * as t from "@babel/types";

import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";

import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";

import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { semanticStaticPropertyKey } from "./javascriptAstValues.js";
import { stringValue } from "./javascriptStaticAnalysisHelpers.js";
import {
  resolveSemanticBindingState,
  type JavaScriptBindingIndex,
} from "./javascriptSemanticState.js";

/** Static CommonJS export names. */
export interface StaticExports {
  readonly values: readonly string[];
}

/** Derive a rename-resistant syntax fingerprint without code execution. */
export const fingerprintJavaScriptAst = (node: t.Node): string => {
  const tokens: string[] = [];
  traverseJavaScriptAst(node, {
    enter: (current) => {
      tokens.push(...semanticTokens(current));
      return undefined;
    },
  });
  return createHash("sha256").update(JSON.stringify(tokens)).digest("hex");
};

/** Calling-convention roles established by the bundler adapter. */
export interface JavaScriptFactoryExportBindings {
  readonly exports: t.Identifier | undefined;
  readonly module: t.Identifier | undefined;
  readonly loader: t.Identifier | undefined;
}

/** Collect statically declared CommonJS/bundler export names from one factory. */
export const collectJavaScriptExports = (
  node: t.Node,
  factory?: {
    readonly roles: JavaScriptFactoryExportBindings;
    readonly index: Pick<
      JavaScriptBindingIndex,
      "bindings" | "effectsForReferenceWithinActivationAt"
    >;
  },
): StaticExports => {
  const roles = factory?.roles;
  const index = factory?.index;
  const bindings = index?.bindings;
  const exports = new Set<string>();
  const bindingId = (
    reference: t.Node | null | undefined,
  ): string | undefined =>
    bindings !== undefined && t.isIdentifier(reference)
      ? resolveSemanticBindingState(bindings, reference, reference.name)
          ?.bindingId
      : undefined;
  const identity = (
    role: keyof JavaScriptFactoryExportBindings,
    fallback: string,
  ) => {
    const id = bindingId(roles?.[role]);
    return (reference: t.Node | null): boolean => {
      if (!t.isIdentifier(reference)) return false;
      if (roles === undefined) return reference.name === fallback;
      if (id === undefined || bindings === undefined) return false;
      const binding = resolveSemanticBindingState(
        bindings,
        reference,
        reference.name,
      );
      if (binding?.bindingId !== id) return false;
      // The calling convention owns the parameter's entry value, not every
      // later value assigned to the same lexical binding.
      const read = semanticBindingAtRead(
        binding,
        reference,
        bindings.parentsByNode,
      );
      return (
        read.status === "ordered" &&
        read.binding.initializers.length === 0 &&
        read.binding.referenceInitializers.length === 0
      );
    };
  };
  const isExportsAlias = identity("exports", "exports");
  const isModuleAlias = identity("module", "module");
  const isLoaderAlias = identity("loader", "__webpack_require__");
  const receivers = { isExportsAlias, isModuleAlias };
  traverseJavaScriptAst(node, {
    enter: (current) => {
      if (t.isAssignmentExpression(current))
        collectAssignmentExports(
          current.left,
          current.right,
          exports,
          receivers,
        );
      if (t.isCallExpression(current)) {
        const intrinsic =
          bindings !== undefined &&
          isUnmodifiedGlobalReference(current.callee, bindings, [
            "Object",
            "defineProperty",
          ]);
        collectCallExports(current, exports, receivers, intrinsic, (root) => {
          if (root === null || !isLoaderAlias(root)) return false;
          if (index === undefined) return true;
          const facts = index.effectsForReferenceWithinActivationAt(
            current,
            root,
            ["d"],
          );
          return (
            facts.memberEffectsIndexed &&
            !facts.effects.some(
              (effect) =>
                effect.kind === "member-write" && effect.timing !== "after",
            )
          );
        });
      }
      return undefined;
    },
  });
  return { values: [...exports].sort(compareUnicodeCodePoints) };
};

interface ExportReceivers {
  readonly isExportsAlias: (root: t.Node | null) => boolean;
  readonly isModuleAlias: (root: t.Node | null) => boolean;
}

const semanticTokens = (node: t.Node): string[] => {
  const tokens = [`node:${node.type}`];
  if (t.isStringLiteral(node)) tokens.push(`string:${node.value}`);
  else if (t.isBigIntLiteral(node)) tokens.push(`bigint:${String(node.value)}`);
  else if (t.isDirectiveLiteral(node)) tokens.push(`directive:${node.value}`);
  else if (t.isNumericLiteral(node))
    tokens.push(`number:${String(node.value)}`);
  else if (t.isBooleanLiteral(node))
    tokens.push(`boolean:${String(node.value)}`);
  else if (t.isRegExpLiteral(node))
    tokens.push(`regexp:${node.pattern}/${node.flags}`);
  else if (t.isTemplateElement(node))
    tokens.push(`template:${JSON.stringify(node.value)}`);
  else if (
    t.isBinaryExpression(node) ||
    t.isLogicalExpression(node) ||
    t.isUnaryExpression(node) ||
    t.isUpdateExpression(node) ||
    t.isAssignmentExpression(node)
  )
    tokens.push(`operator:${node.operator}`);
  if (t.isUpdateExpression(node)) tokens.push(`prefix:${String(node.prefix)}`);
  if (t.isVariableDeclaration(node)) tokens.push(`kind:${node.kind}`);
  if (t.isFunction(node)) {
    tokens.push(`async:${String(node.async)}`);
    tokens.push(`generator:${String(node.generator)}`);
  }
  if (t.isObjectMethod(node)) tokens.push(`kind:${node.kind}`);
  if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    tokens.push(`kind:${node.kind}`);
    tokens.push(`static:${String(node.static)}`);
  }
  if (
    t.isClassProperty(node) ||
    t.isClassPrivateProperty(node) ||
    t.isClassAccessorProperty(node)
  )
    tokens.push(`static:${String(node.static)}`);
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    // A computed identifier names a local binding, not a fixed member.
    tokens.push(`computed:${String(node.computed)}`);
    if (!node.computed) {
      const property = semanticStaticPropertyKey(node.property, false);
      if (property !== null) tokens.push(`property:${property}`);
    }
  }
  if (
    t.isObjectProperty(node) ||
    t.isObjectMethod(node) ||
    t.isClassMethod(node) ||
    t.isClassProperty(node) ||
    t.isClassAccessorProperty(node)
  ) {
    tokens.push(`computed:${String(node.computed)}`);
    if (!node.computed) {
      const key = semanticStaticPropertyKey(node.key, false);
      if (key !== null) tokens.push(`key:${key}`);
    }
  }
  return tokens;
};

const collectAssignmentExports = (
  left: t.LVal | t.OptionalMemberExpression,
  right: t.Expression,
  output: Set<string>,
  { isExportsAlias, isModuleAlias }: ExportReceivers,
): void => {
  const path = memberPath(left);
  if (path === null) return;
  const root = memberRoot(left);
  const exportsAlias = isExportsAlias(root);
  // Rebinding the CommonJS alias does not replace module.exports.
  if (path.length === 1 && exportsAlias) return;
  const exportOffset = exportsAlias
    ? 1
    : isModuleAlias(root) && path[1] === "exports"
      ? 2
      : null;
  if (exportOffset === null) return;
  if (path.length === exportOffset) {
    if (t.isObjectExpression(right)) collectObjectKeys(right, output);
    else addExport(output, "default");
    return;
  }
  // A CommonJS export assignment exposes the first property below the
  // exports object. Deeper writes mutate that exported value, rather than
  // creating an export whose name is the dotted member path.
  addExport(output, path[exportOffset]!);
};

const collectCallExports = (
  call: t.CallExpression,
  output: Set<string>,
  { isExportsAlias, isModuleAlias }: ExportReceivers,
  intrinsic: boolean,
  isLoaderAlias: (root: t.Node | null) => boolean,
): void => {
  const callee = memberPath(call.callee);
  if (callee === null) return;
  const definePropertyCall = intrinsic;
  const declarationCall =
    callee.length === 2 &&
    callee[1] === "d" &&
    isLoaderAlias(memberRoot(call.callee));
  if (!definePropertyCall && !declarationCall) return;
  const targetNode = call.arguments[0];
  const target = memberPath(targetNode);
  const exportTarget =
    isExportsAlias(targetNode ?? null) ||
    (target !== null &&
      target.length === 2 &&
      isModuleAlias(memberRoot(targetNode)) &&
      target[1] === "exports");
  if (!exportTarget) return;
  if (definePropertyCall) {
    const name = stringValue(call.arguments[1]);
    if (name !== undefined) addExport(output, name);
    return;
  }
  const declarations = call.arguments[1];
  if (t.isObjectExpression(declarations))
    collectObjectKeys(declarations, output);
};

const memberRoot = (node: t.Node | null | undefined): t.Node | null => {
  let current = node;
  while (
    current !== null &&
    current !== undefined &&
    (t.isMemberExpression(current) || t.isOptionalMemberExpression(current))
  )
    current = current.object;
  return current ?? null;
};

const collectObjectKeys = (
  object: t.ObjectExpression,
  output: Set<string>,
): void => {
  for (const property of object.properties) {
    if (!t.isObjectProperty(property) && !t.isObjectMethod(property)) continue;
    const name = semanticStaticPropertyKey(property.key, property.computed);
    // In an object literal, a non-computed `__proto__: value` sets the
    // prototype instead of creating an own property. Shorthand, computed,
    // and method forms do create own properties.
    if (
      name !== null &&
      !(
        t.isObjectProperty(property) &&
        !property.computed &&
        !property.shorthand &&
        name === "__proto__"
      )
    )
      addExport(output, name);
  }
};

const addExport = (output: Set<string>, name: string): void => {
  output.add(name);
};

const memberPath = (
  node: t.Node | null | undefined,
): readonly string[] | null => {
  const properties: string[] = [];
  let current = node;
  while (
    current !== undefined &&
    current !== null &&
    (t.isMemberExpression(current) || t.isOptionalMemberExpression(current))
  ) {
    const property = semanticStaticPropertyKey(
      current.property,
      current.computed,
    );
    if (property === null) return null;
    properties.push(property);
    current = current.object;
  }
  if (current === undefined || current === null) return null;
  const root = t.isIdentifier(current)
    ? current.name
    : t.isThisExpression(current)
      ? "this"
      : null;
  return root === null ? null : [root, ...properties.reverse()];
};
