import { readdir, writeFile, open, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import {
  RegularFileCleanupFailure,
  RegularFileCancelled,
} from "../../../../src/filesystem/OwnedRegularFile.js";
import { run, session } from "./kunaSessionFixture.js";

const fault = vi.hoisted(() => ({
  fail: false,
  span: "",
  short: false,
  reads: 0,
  entered: 0,
  closeEntered: 0,
  closes: 0,
  opens: 0,
  hold: undefined as Promise<void> | undefined,
  releaseHold: (): void => undefined,
  afterRead: (): void => undefined,
  readRejection: undefined as { readonly cause: unknown } | undefined,
  handles: [] as FileHandle[],
  cause: Object.assign(new Error("controlled close refusal"), { code: "EIO" }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== fault.span) return handle;
      fault.opens += 1;
      fault.handles.push(handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...readArgs: unknown[]) => {
              fault.entered += 1;
              const read = await Reflect.apply(target.read, target, readArgs);
              fault.reads += 1;
              fault.afterRead();
              if (fault.readRejection !== undefined)
                throw fault.readRejection.cause;
              return fault.short ? { ...read, bytesRead: 0 } : read;
            };
          if (key === "close")
            return async () => {
              fault.closeEntered += 1;
              if (fault.hold !== undefined) await fault.hold;
              fault.closes += 1;
              if (fault.fail) throw fault.cause;
              return target.close();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

afterEach(() => {
  fault.releaseHold();
  fault.fail = false;
  fault.span = "";
  fault.short = false;
  fault.reads = 0;
  fault.entered = 0;
  fault.closeEntered = 0;
  fault.closes = 0;
  fault.opens = 0;
  fault.hold = undefined;
  fault.releaseHold = () => undefined;
  fault.afterRead = () => undefined;
  fault.readRejection = undefined;
  fault.handles = [];
});

it.each([false, true])(
  "preserves the span outcome and retries the exact handle when close fails (short=%s)",
  async (short) => {
    const { cacheRoot, open: createClient } = await session(
      "rea-kuna-span-close-",
    );
    const client = createClient();
    try {
      const warm = await run(client, "procedure_assembly", {
        procedure: "main",
      });
      const text = String(warm.result);
      const [key] = await readdir(join(cacheRoot, "projects"));
      fault.span = join(
        cacheRoot,
        "projects",
        key ?? "",
        "project",
        "program.asm",
      );
      fault.short = short;
      fault.fail = true;
      const result = await client.execute(
        "procedure_assembly",
        { procedure: "main" },
        {},
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(projectAnalysisError(result.error).code).toBe(
        "cleanup_incomplete",
      );
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toContain(fault.span);
      expect(fault.reads).toBe(1);
      expect(fault.closes).toBe(1);
      expect(fault.opens).toBe(1);
      const handle = fault.handles[0];
      if (handle === undefined) throw new Error("missing span descriptor");
      if (short) {
        expect(result.error.cleanupPrimary?.userMessage).toContain(
          "shorter than its recorded span",
        );
        expect(result.error.diagnostics?.span_read).toBeUndefined();
      } else {
        expect(result.error).toBeInstanceOf(ProviderCleanupError);
        expect(result.error.diagnostics).toMatchObject({
          span_read: "completed",
          span_text: expect.stringContaining(text),
          path: fault.span,
        });
      }
      const live = await handle.read(Buffer.alloc(4), 0, 4, 0);
      expect(live.bytesRead).toBe(4);

      const blocked = await client.execute(
        "procedure_assembly",
        { procedure: "main" },
        {},
      );
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(blocked.error.cleanupIncomplete).toBe(true);
      expect(fault.reads).toBe(1);
      expect(fault.opens).toBe(1);
      expect(fault.closes).toBeGreaterThan(1);
      expect(handle.fd).toBeGreaterThanOrEqual(0);

      const closesBeforeShutdown = fault.closes;
      const closed = await client.close();
      expect(closed.ok).toBe(false);
      if (closed.ok) return;
      expect(closed.error.cleanupIncomplete).toBe(true);
      expect(fault.closes).toBeGreaterThan(closesBeforeShutdown);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(result.error.cleanupIncomplete).toBe(true);
      const stillLive = await handle.read(Buffer.alloc(4), 0, 4, 0);
      expect(stillLive.bytesRead).toBe(4);

      fault.fail = false;
      const released = await client.close();
      expect(released).toEqual({ ok: true, value: null });
      expect(handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(blocked.error.cleanupIncomplete).toBe(false);
      expect(closed.error.cleanupIncomplete).toBe(false);
    } finally {
      fault.fail = false;
      fault.span = "";
      await client.close();
      for (const handle of fault.handles)
        if (handle.fd >= 0) await handle.close().catch(() => undefined);
    }
  },
);

it.each(
  [
    "undefined",
    "foreign cleanup",
    "foreign cancellation",
    "foreign typed cancellation",
  ].flatMap((shape) =>
    [false, true].map((closeFails) => ({ shape, closeFails })),
  ),
)(
  "preserves a physical $shape rejection when local close fails: $closeFails",
  async ({ shape, closeFails }) => {
    const { cacheRoot, open: createClient } = await session(
      "rea-kuna-span-physical-",
    );
    const client = createClient();
    const foreignPath = join(dirname(cacheRoot), "foreign.txt");
    await writeFile(foreignPath, "foreign bytes");
    const foreign = new OwnedFileHandle(await open(foreignPath, "r"));
    try {
      await run(client, "procedure_assembly", { procedure: "main" });
      const [key] = await readdir(join(cacheRoot, "projects"));
      fault.span = join(
        cacheRoot,
        "projects",
        key ?? "",
        "project",
        "program.asm",
      );
      const raw =
        shape === "foreign cleanup"
          ? new RegularFileCleanupFailure({
              path: foreignPath,
              owner: foreign,
              outcome: { kind: "completed", value: "foreign bytes" },
              cleanupCause: new Error("foreign close failure"),
            })
          : shape === "foreign cancellation"
            ? new RegularFileCancelled(foreignPath, foreign, {
                outcome: { kind: "completed", value: "foreign bytes" },
                reason: "foreign cancellation reason",
              })
            : shape === "foreign typed cancellation"
              ? new AnalysisCancelledError("foreign_operation", {
                  cause: "foreign cancellation reason",
                  cleanup: {
                    reason: "foreign cleanup",
                    resources: [foreignPath],
                  },
                })
              : undefined;
      fault.readRejection = { cause: raw };
      fault.fail = closeFails;
      const controller = new AbortController();
      fault.afterRead = () => controller.abort("late caller abort");
      const result = await client.execute(
        "procedure_assembly",
        { procedure: "main" },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected physical span failure");
      const primary = closeFails ? result.error.cleanupPrimary : result.error;
      expect(primary?._tag).toBe("ProviderAdapterError");
      expect(primary?.cause).toBe(raw);
      expect(result.error.cleanupIncomplete).toBe(closeFails);
      expect(result.error.cleanupResources).toEqual(
        closeFails ? [fault.span] : [],
      );
      expect(fault.handles).toHaveLength(1);
      if (closeFails) expect(fault.handles[0]!.fd).toBeGreaterThanOrEqual(0);
      else expect(fault.handles[0]!.fd).toBe(-1);
      expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
      fault.fail = false;
      fault.readRejection = undefined;
      fault.afterRead = () => undefined;
      const recovered = await client.execute(
        "procedure_assembly",
        { procedure: "main" },
        {},
      );
      expect(recovered.ok).toBe(true);
      expect(fault.handles[0]!.fd).toBe(-1);
      expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
    } finally {
      fault.fail = false;
      fault.readRejection = undefined;
      fault.afterRead = () => undefined;
      await client.close();
      await foreign.close();
      for (const handle of fault.handles)
        if (handle.fd >= 0) await handle.close();
    }
  },
);

it("does not open a second span while a peer still holds a failed close", async () => {
  const { cacheRoot, open: createClient } = await session(
    "rea-kuna-span-close-gate-",
  );
  const client = createClient();
  try {
    await run(client, "procedure_assembly", { procedure: "main" });
    const [key] = await readdir(join(cacheRoot, "projects"));
    fault.span = join(
      cacheRoot,
      "projects",
      key ?? "",
      "project",
      "program.asm",
    );
    fault.fail = true;
    fault.hold = new Promise<void>((resolve) => {
      fault.releaseHold = resolve;
    });
    const first = client.execute(
      "procedure_assembly",
      { procedure: "main" },
      {},
    );
    await vi.waitFor(() => {
      expect(fault.closeEntered).toBe(1);
    });
    const second = client.execute(
      "procedure_assembly",
      { procedure: "parse" },
      {},
    );
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(fault.opens).toBe(1);
    expect(fault.reads).toBe(1);
    fault.releaseHold();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(false);
    if (firstResult.ok) return;
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) return;
    expect(firstResult.error.cleanupIncomplete).toBe(true);
    expect(secondResult.error.cleanupIncomplete).toBe(true);
    expect(secondResult.error.cleanupResources).toContain(fault.span);
    expect(fault.opens).toBe(1);
    expect(fault.reads).toBe(1);
    expect(fault.closes).toBeGreaterThanOrEqual(2);
    const handle = fault.handles[0];
    if (handle === undefined) throw new Error("missing span descriptor");
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    const live = await handle.read(Buffer.alloc(4), 0, 4, 0);
    expect(live.bytesRead).toBe(4);
  } finally {
    fault.releaseHold();
    fault.fail = false;
    fault.hold = undefined;
    fault.span = "";
    await client.close();
    for (const handle of fault.handles)
      if (handle.fd >= 0) await handle.close().catch(() => undefined);
  }
});

it("does not open a queued span after its caller aborts", async () => {
  const { cacheRoot, open: createClient } = await session(
    "rea-kuna-span-close-cancel-",
  );
  const client = createClient();
  try {
    await run(client, "procedure_assembly", { procedure: "main" });
    const [key] = await readdir(join(cacheRoot, "projects"));
    fault.span = join(
      cacheRoot,
      "projects",
      key ?? "",
      "project",
      "program.asm",
    );
    fault.fail = true;
    fault.hold = new Promise<void>((resolve) => {
      fault.releaseHold = resolve;
    });
    const first = client.execute(
      "procedure_assembly",
      { procedure: "main" },
      {},
    );
    await vi.waitFor(() => {
      expect(fault.closeEntered).toBe(1);
    });
    const abort = new AbortController();
    const second = client.execute(
      "procedure_assembly",
      { procedure: "parse" },
      { signal: abort.signal },
    );
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    abort.abort();
    fault.releaseHold();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) return;
    expect(secondResult.error).toBeInstanceOf(AnalysisCancelledError);
    expect(fault.opens).toBe(1);
  } finally {
    fault.releaseHold();
    fault.fail = false;
    fault.hold = undefined;
    fault.span = "";
    await client.close();
    for (const handle of fault.handles)
      if (handle.fd >= 0) await handle.close().catch(() => undefined);
  }
});

it.each(["before close", "during close"] as const)(
  "keeps the caller abort reason when span close succeeds (%s)",
  async (when) => {
    const reason = { requested: "span-close" };
    const { cacheRoot, open: createClient } = await session(
      `rea-kuna-span-close-reason-${when.replace(" ", "-")}-`,
    );
    const client = createClient();
    try {
      await run(client, "procedure_assembly", { procedure: "main" });
      const [key] = await readdir(join(cacheRoot, "projects"));
      fault.span = join(
        cacheRoot,
        "projects",
        key ?? "",
        "project",
        "program.asm",
      );
      const abort = new AbortController();
      if (when === "before close") fault.afterRead = () => abort.abort(reason);
      else {
        fault.hold = new Promise<void>((resolve) => {
          fault.releaseHold = resolve;
        });
      }
      const pending = client.execute(
        "procedure_assembly",
        { procedure: "main" },
        { signal: abort.signal },
      );
      if (when === "during close") {
        await vi.waitFor(() => {
          expect(fault.closeEntered).toBe(1);
        });
        abort.abort(reason);
        fault.releaseHold();
      }
      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(fault.handles[0]?.fd).toBe(-1);
      expect(fault.opens).toBe(1);
    } finally {
      fault.releaseHold();
      fault.fail = false;
      fault.hold = undefined;
      fault.span = "";
      fault.afterRead = () => undefined;
      await client.close();
      for (const handle of fault.handles)
        if (handle.fd >= 0) await handle.close().catch(() => undefined);
    }
  },
);

it("keeps cancellation when a completed span close fails after abort", async () => {
  const reason = { requested: "span-close" };
  const { cacheRoot, open: createClient } = await session(
    "rea-kuna-span-close-cancel-read-",
  );
  const client = createClient();
  try {
    const warm = await run(client, "procedure_assembly", {
      procedure: "main",
    });
    const text = String(warm.result);
    const [key] = await readdir(join(cacheRoot, "projects"));
    fault.span = join(
      cacheRoot,
      "projects",
      key ?? "",
      "project",
      "program.asm",
    );
    fault.fail = true;
    const abort = new AbortController();
    fault.afterRead = () => abort.abort(reason);
    const result = await client.execute(
      "procedure_assembly",
      { procedure: "main" },
      { signal: abort.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(fault.span);
    expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    expect(result.error.diagnostics).toMatchObject({
      cleanup_error: {
        details: {
          diagnostics: {
            span_read: "completed",
            span_text: expect.stringContaining(text),
          },
        },
      },
    });
    const handle = fault.handles[0];
    if (handle === undefined) throw new Error("missing span descriptor");
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(fault.opens).toBe(1);
  } finally {
    fault.fail = false;
    fault.span = "";
    fault.afterRead = () => undefined;
    await client.close();
    for (const handle of fault.handles)
      if (handle.fd >= 0) await handle.close().catch(() => undefined);
  }
});

it("removes a span lease from the resource scope after close succeeds", async () => {
  const release = vi.spyOn(ArtifactResourceScope.prototype, "release");
  const { cacheRoot, open: createClient } = await session(
    "rea-kuna-span-scope-release-",
  );
  const client = createClient();
  try {
    await run(client, "procedure_assembly", { procedure: "main" });
    const [key] = await readdir(join(cacheRoot, "projects"));
    fault.span = join(
      cacheRoot,
      "projects",
      key ?? "",
      "project",
      "program.asm",
    );
    fault.fail = true;
    const failed = await client.execute(
      "procedure_assembly",
      { procedure: "main" },
      {},
    );
    expect(failed.ok).toBe(false);
    fault.fail = false;
    const recovered = await client.execute(
      "procedure_assembly",
      { procedure: "main" },
      {},
    );
    expect(recovered.ok).toBe(true);
    expect(
      release.mock.calls.some(
        ([owner]) => owner.kind === "lease" && owner.resource === fault.span,
      ),
    ).toBe(true);
    expect(fault.handles[0]?.fd).toBe(-1);
  } finally {
    release.mockRestore();
    fault.fail = false;
    fault.span = "";
    await client.close();
    for (const handle of fault.handles)
      if (handle.fd >= 0) await handle.close().catch(() => undefined);
  }
});
