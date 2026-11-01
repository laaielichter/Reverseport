import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import { IdaOperationRunner } from "./IdaOperationRunner.js";

it.each(["legacy", "modern", "native"] as const)(
  "%s procedure resolution rejects file coordinates before any symbol lookup",
  async (protocol) => {
    const { root, target } = await createIdaTarget();
    const producer = new RecordingIdaMcp(
      target,
      protocol === "legacy" ? "attached" : "headless",
    );
    const runner = new IdaOperationRunner(producer, protocol);
    try {
      await expect(
        runner.resolve("file-offset:0x10", "procedure_pseudo_code"),
      ).rejects.toMatchObject({
        _tag: "AnalysisInputError",
        operation: "procedure_pseudo_code",
        issues: [
          {
            path: ["procedure"],
            message: expect.stringContaining("source-file coordinates"),
          },
        ],
      });
      expect(producer.calls).toEqual([]);
      expect((await runner.resolve("main")).name).toBe("main");
    } finally {
      await producer.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
