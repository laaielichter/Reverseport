// Diagnostic only: inspect the explicitly launched REA process after its task.
import assert from "node:assert/strict";

export const sampleRetainedHeap = async (endpoint, expectedPid) => {
  const url = new URL(endpoint);
  assert.equal(url.protocol, "ws:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(Number.isSafeInteger(expectedPid) && expectedPid > 0);
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  const closed = new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
  });
  const rejectPending = (cause) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(cause);
    }
    pending.clear();
  };
  socket.addEventListener("error", () =>
    rejectPending(new Error("Owned REA inspector connection failed")),
  );
  socket.addEventListener("close", () =>
    rejectPending(new Error("Owned REA inspector connection closed")),
  );
  socket.addEventListener("message", (event) => {
    try {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (request === undefined) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error !== undefined)
        request.reject(new Error(JSON.stringify(reply.error)));
      else request.resolve(reply.result);
    } catch (cause) {
      rejectPending(cause);
    }
  });
  const withinDeadline = async (promise) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned REA inspector deadline exceeded")),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Owned REA inspector timed out: ${method}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (cause) {
        pending.delete(id);
        clearTimeout(timer);
        reject(cause);
      }
    });
  try {
    await withinDeadline(
      new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
        socket.addEventListener("close", reject, { once: true });
      }),
    );
    const identity = await call("Runtime.evaluate", {
      expression: "process.pid",
      returnByValue: true,
    });
    assert.equal(identity.result.value, expectedPid);
    const before = await call("Runtime.getHeapUsage");
    await call("HeapProfiler.collectGarbage");
    const after = await call("Runtime.getHeapUsage");
    for (const sample of [before, after]) {
      assert.ok(Number.isSafeInteger(sample.usedSize) && sample.usedSize >= 0);
      assert.ok(Number.isSafeInteger(sample.totalSize));
      assert.ok(sample.totalSize >= sample.usedSize);
    }
    return {
      scope:
        "Owned REA V8 heap after the complete SDK task; inspector and forced GC are diagnostic overhead",
      pid_verified: true,
      before_gc: before,
      after_gc: after,
    };
  } finally {
    rejectPending(new Error("Owned REA inspector diagnostic finished"));
    socket.close();
    await withinDeadline(closed);
  }
};
