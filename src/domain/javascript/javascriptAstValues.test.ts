import * as t from "@babel/types";
import { expect, it } from "vitest";

import {
  semanticMemberChain,
  semanticStaticPropertyKey,
  staticObjectProperty,
  staticObjectPropertyNames,
} from "./javascriptAstValues.js";
import { SEMANTIC_EXPRESSION_DEPTH_LIMIT } from "./javascriptSemanticResourceLimits.js";

it("copies ordinary members without proving requested methods or getter effects", () => {
  const method = (name: string, computed = false) =>
    t.objectMethod(
      "method",
      t.identifier(name),
      [],
      t.blockStatement([]),
      computed,
    );
  const getter = t.objectMethod(
    "get",
    t.identifier("helper"),
    [],
    t.blockStatement([]),
  );
  const setter = t.objectMethod(
    "set",
    t.identifier("helper"),
    [t.identifier("value")],
    t.blockStatement([]),
  );
  for (const [member, status] of [
    [method("helper"), "explicit"],
    [setter, "explicit"],
    [method("stdio"), "dynamic"],
    [getter, "dynamic"],
    [method("key", true), "dynamic"],
  ] as const) {
    const object = t.objectExpression([
      t.objectProperty(t.identifier("stdio"), t.stringLiteral("inherit")),
      t.spreadElement(t.objectExpression([member])),
    ]);
    expect(staticObjectProperty(object, "stdio").status).toBe(status);
  }
});

it("limits unary-plus keys to transparent numeric literals", () => {
  const wrapped = t.tsAsExpression(t.numericLiteral(1), t.tsNumberKeyword());
  expect(semanticStaticPropertyKey(t.unaryExpression("+", wrapped), true)).toBe(
    "1",
  );
  for (const argument of [
    t.stringLiteral("1"),
    t.bigIntLiteral(1n),
    t.identifier("input"),
  ])
    expect(
      semanticStaticPropertyKey(t.unaryExpression("+", argument), true),
    ).toBeNull();
});

it("bounds nested inline object spreads without losing a shallow final property", () => {
  let object = t.objectExpression([
    t.objectProperty(t.identifier("stdio"), t.stringLiteral("inherit")),
  ]);
  for (let depth = 0; depth < SEMANTIC_EXPRESSION_DEPTH_LIMIT; depth++)
    object = t.objectExpression([t.spreadElement(object)]);
  expect(staticObjectProperty(object, "stdio").status).toBe("explicit");
  expect(
    staticObjectProperty(t.objectExpression([t.spreadElement(object)]), "stdio")
      .status,
  ).toBe("dynamic");
});

it("collects complete own-key sets through bounded literal spreads", () => {
  const names = staticObjectPropertyNames(
    t.objectExpression([
      t.spreadElement(
        t.objectExpression([
          t.objectProperty(t.identifier("query"), t.objectExpression([])),
          t.objectProperty(t.identifier("shared"), t.numericLiteral(1)),
        ]),
      ),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
      t.objectProperty(t.identifier("shared"), t.numericLiteral(2)),
    ]),
  );
  expect(names).toEqual({
    status: "complete",
    names: ["query", "shared", "direct"],
  });
});

it("keeps key enumeration unknown when object membership is unresolved", () => {
  const dynamicSpread = t.identifier("dynamicProperties");
  const computedKey = t.identifier("propertyName");
  const cases = [
    t.objectExpression([
      t.spreadElement(dynamicSpread),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
    ]),
    t.objectExpression([
      t.objectProperty(computedKey, t.objectExpression([]), true),
      t.objectProperty(t.identifier("direct"), t.objectExpression([])),
    ]),
    t.objectExpression([
      t.spreadElement(
        t.objectExpression([
          t.objectMethod(
            "get",
            t.identifier("query"),
            [],
            t.blockStatement([]),
          ),
        ]),
      ),
    ]),
  ];
  for (const object of cases)
    expect(staticObjectPropertyNames(object).status).toBe("partial");
});

it("retains known keys alongside unresolved object membership", () => {
  expect(
    staticObjectPropertyNames(
      t.objectExpression([
        t.spreadElement(t.identifier("dynamicProperties")),
        t.objectProperty(t.identifier("direct"), t.objectExpression([])),
        t.objectProperty(
          t.identifier("propertyName"),
          t.objectExpression([]),
          true,
        ),
      ]),
    ),
  ).toEqual({ status: "partial", names: ["direct"] });
});

it("does not claim a complete key set after exceeding spread depth", () => {
  let object = t.objectExpression([
    t.objectProperty(t.identifier("query"), t.objectExpression([])),
  ]);
  for (let depth = 0; depth < SEMANTIC_EXPRESSION_DEPTH_LIMIT; depth++)
    object = t.objectExpression([t.spreadElement(object)]);
  expect(staticObjectPropertyNames(object).status).toBe("complete");
  expect(
    staticObjectPropertyNames(t.objectExpression([t.spreadElement(object)]))
      .status,
  ).toBe("partial");
});

it("enumerates a wide inline spread without a variadic call overflow", () => {
  const properties = Array.from({ length: 130_000 }, (_, index) =>
    t.objectProperty(t.identifier(`key${index}`), t.numericLiteral(index)),
  );
  const result = staticObjectPropertyNames(
    t.objectExpression([t.spreadElement(t.objectExpression(properties))]),
  );
  expect(result.status).toBe("complete");
  if (result.status === "complete") {
    expect(result.names).toHaveLength(properties.length);
    expect(result.names[0]).toBe("key0");
    expect(result.names.at(-1)).toBe("key129999");
  }
});

it("excludes prototype setters from own keys but preserves other __proto__ forms", () => {
  const setter = t.objectProperty(
    t.identifier("__proto__"),
    t.objectExpression([
      t.objectProperty(t.identifier("inherited"), t.numericLiteral(1)),
    ]),
  );
  expect(
    staticObjectPropertyNames(
      t.objectExpression([
        setter,
        t.objectProperty(t.identifier("own"), t.numericLiteral(2)),
      ]),
    ),
  ).toEqual({ status: "complete", names: ["own"] });

  const ownForms = [
    t.objectProperty(t.stringLiteral("__proto__"), t.numericLiteral(1), true),
    t.objectProperty(
      t.identifier("__proto__"),
      t.identifier("__proto__"),
      false,
      true,
    ),
    t.objectMethod(
      "method",
      t.identifier("__proto__"),
      [],
      t.blockStatement([]),
    ),
  ];
  for (const member of ownForms)
    expect(staticObjectPropertyNames(t.objectExpression([member]))).toEqual({
      status: "complete",
      names: ["__proto__"],
    });
});

it("keeps inherited lookup uncertain after a top-level prototype setter", () => {
  const setter = t.objectProperty(
    t.identifier("__proto__"),
    t.objectExpression([
      t.objectProperty(t.identifier("inherited"), t.numericLiteral(1)),
    ]),
  );
  expect(
    staticObjectProperty(t.objectExpression([setter]), "inherited").status,
  ).toBe("dynamic");
  expect(
    staticObjectProperty(
      t.objectExpression([
        setter,
        t.objectProperty(t.identifier("inherited"), t.numericLiteral(2)),
      ]),
      "inherited",
    ).status,
  ).toBe("explicit");
  expect(
    staticObjectProperty(
      t.objectExpression([
        t.objectProperty(t.identifier("inherited"), t.numericLiteral(2)),
        setter,
      ]),
      "inherited",
    ).status,
  ).toBe("explicit");
  const spreadSource = t.objectExpression([
    setter,
    t.objectProperty(t.identifier("visible"), t.numericLiteral(3)),
  ]);
  expect(
    staticObjectProperty(
      t.objectExpression([t.spreadElement(spreadSource)]),
      "inherited",
    ).status,
  ).toBe("missing");
});

it("omits prototype setters copied by literal object spread", () => {
  const source = t.objectExpression([
    t.objectProperty(
      t.identifier("__proto__"),
      t.objectExpression([
        t.objectProperty(t.identifier("hidden"), t.numericLiteral(1)),
      ]),
    ),
    t.objectProperty(t.identifier("visible"), t.numericLiteral(2)),
  ]);
  expect(
    staticObjectPropertyNames(t.objectExpression([t.spreadElement(source)])),
  ).toEqual({ status: "complete", names: ["visible"] });
});

it("shares static member paths and stops before unadmitted path expansion", () => {
  const root = t.identifier("registry");
  const selected = t.optionalMemberExpression(
    t.memberExpression(
      t.tsAsExpression(root, t.tsUnknownKeyword()),
      t.stringLiteral("query"),
      true,
    ),
    t.identifier("nested"),
    false,
    true,
  );
  expect(semanticMemberChain(selected)).toEqual({
    root,
    members: ["query", "nested"],
  });
  expect(
    semanticMemberChain(t.memberExpression(root, t.identifier("key"), true)),
  ).toBeUndefined();
  let admitted = 0;
  expect(semanticMemberChain(selected, () => ++admitted < 2)).toBeUndefined();
  expect(admitted).toBe(2);
});
