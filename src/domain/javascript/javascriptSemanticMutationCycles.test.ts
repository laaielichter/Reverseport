import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const returnedValue = (body: string, expression: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(
      `export function result() { ${body} return ${expression}; }`,
    ),
    "result",
  ).returnSites[0]?.value;

describe("member-path cycles and captured aliases", () => {
  const branches = Array.from(
    { length: 16 },
    (_, index) => `if (flag === ${index}) node = node.m${index};`,
  ).join(" else ");

  it.each(["copy[key].value = 2;", "mutate(copy[key]);"])(
    "retains shared-child effects through rest copies: %s",
    (effect) => {
      const body = `
      const seed = { mode: "initial", m15: { m15: { child: { value: 1 } } } };
      let node = seed.m15;
      while (node) {
        ${branches}
        const { ignore, ...copy } = node;
        ${effect}
      }
    `;
      expect(returnedValue(body, "seed.m15.m15.child.value")?.status).toBe(
        "unknown",
      );
      expect(returnedValue(body, "seed.mode")).toEqual({
        status: "literal",
        value: "initial",
      });
    },
  );

  it.each([
    ["while", (body: string) => `while (node) { ${body} }`],
    ["do/while", (body: string) => `do { ${body} } while (node);`],
    ["for", (body: string) => `for (; node; ) { ${body} }`],
    ["for/in", (body: string) => `for (const key in { a: 1 }) { ${body} }`],
    ["for/of", (body: string) => `for (const item of [1]) { ${body} }`],
  ] as const)(
    "keeps a late child effect within its siblings in %s",
    (_kind, loop) => {
      const body = `
      const seed = { mode: "initial", m15: { value: 1, keep: 3 } };
      let node = seed;
      ${loop(`${branches} node.value = 2;`)}
    `;
      expect(returnedValue(body, "seed.m15.value")?.status).toBe("unknown");
      expect(returnedValue(body, "seed.mode")).toEqual({
        status: "literal",
        value: "initial",
      });
      expect(returnedValue(body, "seed.m15.keep")).toEqual({
        status: "literal",
        value: 3,
      });
    },
  );

  it("keeps an acyclic chain of reassignments within its selected child", () => {
    const body = `
      const seed = { branch: { child: { value: 1 }, keep: 3 }, keep: 4 };
      let node = seed;
      node = node.branch;
      node = node.child;
      mutate(node);
    `;
    expect(returnedValue(body, "seed.branch.child.value")?.status).toBe(
      "unknown",
    );
    expect(returnedValue(body, "seed.branch.keep")).toEqual({
      status: "literal",
      value: 3,
    });
    expect(returnedValue(body, "seed.keep")).toEqual({
      status: "literal",
      value: 4,
    });
  });

  it("selects saved aliases at their capture, before or after a rebind", () => {
    const body = `
      const seed = { branch: { child: { value: 1 }, keep: 3 } };
      let node = seed.branch;
      const before = node;
      node = node.child;
      const after = node;
    `;
    expect(
      returnedValue(`${body} mutate(after);`, "seed.branch.child.value")
        ?.status,
    ).toBe("unknown");
    expect(returnedValue(`${body} mutate(after);`, "seed.branch.keep")).toEqual(
      {
        status: "literal",
        value: 3,
      },
    );
    expect(
      returnedValue(`${body} mutate(before);`, "seed.branch.keep")?.status,
    ).toBe("unknown");
  });
});
