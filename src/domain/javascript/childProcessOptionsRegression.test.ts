import { describe, expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

describe("child-process options detection", () => {
  it("detects options without an args array", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn, execFile, fork } from "node:child_process";

      spawn("tool", {
        env: { A: "1" },
        stdio: "pipe"
      });

      execFile("tool", {
        env: { A: "1" }
      });

      fork("worker.js", {
        env: { A: "1" },
        stdio: ["pipe", "pipe", "pipe", "ipc"]
      });
    `);

    expect(
      ir.childProcessSpawns.map(
        ({ method, environmentSupplied, stdioMode, resolution }) => ({
          method,
          environmentSupplied,
          stdioMode,
          resolution,
        }),
      ),
    ).toEqual([
      {
        method: "spawn",
        environmentSupplied: true,
        stdioMode: "pipe",
        resolution: "complete",
      },
      {
        method: "execFile",
        environmentSupplied: true,
        stdioMode: "default",
        resolution: "complete",
      },
      {
        method: "fork",
        environmentSupplied: true,
        stdioMode: "array",
        resolution: "complete",
      },
    ]);
  });

  it("reads fork's silent option when stdio is not a string or array", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { fork, spawn } from "node:child_process";

      fork("piped.js", { silent: true });
      fork("inherited.js", [], { silent: false });
      fork("nullish-stdio.js", { silent: 1, stdio: null });
      fork("explicit-stdio.js", { silent: true, stdio: "inherit" });
      fork("dynamic.js", { silent: process.env.QUIET });
      spawn("tool", { silent: true });
      fork("boolean-stdio.js", { stdio: false, silent: true });
      fork("object-stdio.js", { stdio: {}, silent: false });
      fork("unresolved-stdio.js", { stdio: streams, silent: true });
      spawn("tool", { stdio: false });
    `);

    expect(ir.childProcessSpawns.map(({ stdioMode }) => stdioMode)).toEqual([
      "pipe",
      "default",
      "pipe",
      "inherit",
      "dynamic",
      "default",
      "pipe",
      "default",
      "dynamic",
      "dynamic",
    ]);
  });

  it("preserves behavior with explicit args arrays", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn, execFile, fork } from "node:child_process";

      spawn("tool", [], { env: { A: "1" }, stdio: "pipe" });
      execFile("tool", [], { env: { A: "1" } });
      fork("worker.js", [], {
        env: { A: "1" },
        stdio: ["pipe", "pipe", "pipe", "ipc"]
      });
    `);

    expect(
      ir.childProcessSpawns.map(({ environmentSupplied, stdioMode }) => ({
        environmentSupplied,
        stdioMode,
      })),
    ).toEqual([
      { environmentSupplied: true, stdioMode: "pipe" },
      { environmentSupplied: true, stdioMode: "default" },
      { environmentSupplied: true, stdioMode: "array" },
    ]);
  });

  it("does not invent options when omitted", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn, execFile, fork } from "node:child_process";

      spawn("tool");
      execFile("tool");
      fork("worker.js");
    `);

    expect(
      ir.childProcessSpawns.every(
        ({ environmentSupplied, stdioMode }) =>
          environmentSupplied === false && stdioMode === "default",
      ),
    ).toBe(true);

    expect(ir.childProcessSpawns).toHaveLength(3);
  });
});
