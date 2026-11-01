import { runInNewContext } from "node:vm";

import { transformSync } from "esbuild";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([false, true])(
  "retains generated esbuild exports with module use %s",
  (usesModule) => {
    const { code } = transformSync(
      `exports.parse = () => ${usesModule ? "module.id" : "42"};`,
      {
        format: "iife",
        globalName: "fixture",
      },
    );
    const runtime: { fixture?: Record<string, unknown> } = {};
    runInNewContext(code, runtime);
    const expected = Object.keys(runtime.fixture ?? {});
    expect(expected).toEqual(["parse"]);
    const analysis = analyzeJavaScriptStaticSource(code);
    expect(analysis.bundler_registrations).toMatchObject([
      {
        bundler: "esbuild",
        modules: [{ exports: expected, factory_require_name: null }],
      },
    ]);
  },
);

it.each(["module", "renamed"])(
  "uses the %s factory binding for every export receiver",
  (moduleName) => {
    const analysis =
      analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    17(${moduleName}, api, load) {
      ${moduleName}.exports.direct = 1;
      Object.defineProperty(${moduleName}.exports, "defined", {value: 2});
      load.d(${moduleName}.exports, {declared: () => 3});
      { const module = {exports: {}}; module.exports.ghost = 4; }
      { const load = {d() {}}; load.d(api, {fake: () => 5}); }
    }
  }]);`);
    expect(analysis.bundler_registrations[0]?.modules[0]?.exports).toEqual([
      "declared",
      "defined",
      "direct",
    ]);
  },
);

it.each([
  "const Object = {defineProperty() {}};",
  "globalThis.Object.defineProperty = () => {};",
])("requires the global property-definition intrinsic: %s", (prefix) => {
  const analysis =
    analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    17(mod, api) { ${prefix} Object.defineProperty(api, "ghost", {value: 1}); api.real = 2; }
  }]);`);
  expect(analysis.bundler_registrations[0]?.modules[0]?.exports).toEqual([
    "real",
  ]);
});
