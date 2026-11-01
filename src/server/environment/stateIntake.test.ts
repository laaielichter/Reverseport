import { expect, it, vi } from "vitest";

import {
  DEFAULT_STATE_INTAKE,
  fetchStateDocument,
  STATE_FETCH_TIMEOUT_MS,
} from "./stateIntake.js";

it("downloads with redirects refused and the 30 s timeout by default", async () => {
  const fetched = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  try {
    const url = new URL("https://state.example.test/state.json");
    const signal = AbortSignal.timeout(STATE_FETCH_TIMEOUT_MS);
    await fetchStateDocument(url, signal);
    expect(fetched).toHaveBeenCalledExactlyOnceWith(url, {
      signal,
      redirect: "error",
    });
    expect(DEFAULT_STATE_INTAKE).toEqual({
      fetchState: fetchStateDocument,
      timeoutMs: 30_000,
    });
  } finally {
    fetched.mockRestore();
  }
});
