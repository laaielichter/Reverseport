import { expect, it } from "vitest";
import {
  processScenarioSchema,
  processScenarioCommitment,
  processComparisonContract,
  digestProcessCommitment,
} from "./processScenario.js";
import { parseProcessCapture } from "./processCaptureParsing.js";

import {
  deriveProcessComparisonStatus,
  PROCESS_COMPARISON_DIMENSIONS,
  processCaptureComparisonSchema,
} from "./processComparison.js";

import {
  accountFullyObservedProcessCapture,
  compareUnverifiedProcessCaptures as compareProcessCaptures,
  emptyProcessCapture as emptyCapture,
} from "./processCapture.fixture.js";

const compareFullyObserved = (
  left: Parameters<typeof compareProcessCaptures>[0],
  right: Parameters<typeof compareProcessCaptures>[1],
  options?: Parameters<typeof compareProcessCaptures>[2],
) =>
  compareProcessCaptures(
    accountFullyObservedProcessCapture(left),
    accountFullyObservedProcessCapture(right),
    options,
  );

it.each(PROCESS_COMPARISON_DIMENSIONS)(
  "requires a contradiction aggregate for a contradictory %s dimension",
  (dimension) => {
    const baseline = compareFullyObserved(emptyCapture(), emptyCapture());
    const result = { ...baseline, [dimension]: "contradiction" as const };
    expect(
      deriveProcessComparisonStatus(
        PROCESS_COMPARISON_DIMENSIONS.map((name) => result[name]),
      ),
    ).toBe("contradiction");
    expect(processCaptureComparisonSchema.safeParse(result).success).toBe(
      false,
    );
    expect(
      processCaptureComparisonSchema.parse({
        ...result,
        status: "contradiction",
      }),
    ).toMatchObject({ status: "contradiction", [dimension]: "contradiction" });
  },
);

it.each([
  ["unchanged", "contradiction"],
  ["added", "contradiction"],
  ["removed", "contradiction"],
  ["changed", "contradiction"],
  ["unknown", "contradiction"],
  ["contradiction", "contradiction"],
  ["truncated", "truncated"],
] as const)(
  "combines contradiction with %s as %s independently of dimension order",
  (other, expected) => {
    for (const [terminal, interaction] of [
      ["contradiction", other],
      [other, "contradiction"],
    ] as const) {
      expect(deriveProcessComparisonStatus([terminal, interaction])).toBe(
        expected,
      );
      expect(
        processCaptureComparisonSchema.parse({
          ...compareFullyObserved(emptyCapture(), emptyCapture()),
          terminal,
          interaction,
          status: expected,
        }),
      ).toMatchObject({ status: expected });
    }
  },
);

it("compares normalized terminal facts while retaining different source text for audit", () => {
  const capture = emptyCapture();
  const frame = { sequence: 0, at_ms: 0, data: "listen:<port> score=20" };
  const left = {
    ...capture,
    frames: [{ ...frame, raw_data: "listen:8080 score=20" }],
  };
  const right = {
    ...capture,
    frames: [{ ...frame, raw_data: "listen:9090 score=20" }],
  };
  expect(compareFullyObserved(left, right)).toMatchObject({
    terminal: "unchanged",
  });
  expect(
    compareFullyObserved(left, {
      ...right,
      frames: [{ ...frame, data: "listen:<port> score=21" }],
    }),
  ).toMatchObject({ terminal: "changed" });
});

it("distinguishes added evidence from unknown observations", () => {
  const capture = emptyCapture();
  const added = compareFullyObserved(capture, {
    ...capture,
    frames: [{ sequence: 0, at_ms: 0, data: "new" }],
    rendered_frames: [
      {
        sequence: 0,
        at_ms: 0,
        columns: 3,
        rows: 1,
        cursor_x: 3,
        cursor_y: 0,
        active_buffer: "normal",
        lines: ["new"],
        serialized_state: "new",
      },
    ],
  });
  expect(added).toMatchObject({ terminal: "added", status: "changed" });

  for (const [scope, dimension] of [
    ["process", "process"],
    ["interaction", "interaction"],
  ] as const) {
    expect(
      compareFullyObserved(
        {
          ...capture,
          residual_unknowns: [{ scope, reason: "observation was partial" }],
        },
        capture,
      ),
    ).toMatchObject({
      status: "unknown",
      [dimension]: "unknown",
      terminal: "unchanged",
    });
  }
});

it("compares raw terminal and process observations while honoring normalization shape", () => {
  const capture = emptyCapture();
  expect(
    compareFullyObserved(capture, {
      ...capture,
      normalization: {
        patterns: [],
        time_bucket_ms: 10,
        ports: true,
        pids: true,
        paths: true,
      },
    }),
  ).toMatchObject({
    status: "unchanged",
    first_divergence: { status: "none" },
  });

  const terminal = compareFullyObserved(
    { ...capture, frames: [{ sequence: 0, at_ms: 0, data: "bar" }] },
    { ...capture, frames: [{ sequence: 0, at_ms: 0, data: "foo\rbar" }] },
  );
  expect(terminal).toMatchObject({
    terminal: "changed",
    first_divergence: { status: "found", dimension: "terminal" },
  });

  expect(
    compareFullyObserved(
      {
        ...capture,
        process_samples: [
          {
            at_ms: 10,
            pid: 1,
            parent_pid: 0,
            process_group_id: 1,
            session_id: 1,
            command: "worker",
          },
        ],
      },
      {
        ...capture,
        process_samples: [
          {
            at_ms: 20,
            pid: 1,
            parent_pid: 2,
            process_group_id: 1,
            session_id: 1,
            command: "worker",
          },
        ],
      },
    ),
  ).toMatchObject({ process: "changed", status: "changed" });
});

it("keeps filesystem comparison unknown without coverage and reports observed changes", () => {
  const capture = emptyCapture();
  const incomplete = {
    ...capture,
    residual_unknowns: [
      { scope: "filesystem" as const, reason: "watcher unavailable" },
    ],
  };
  expect(compareFullyObserved(incomplete, incomplete)).toMatchObject({
    filesystem: "unknown",
    status: "unknown",
  });

  const finalFile = {
    path: "root_0:created.txt",
    type: "file" as const,
    mode: 0o644,
    size: 4,
    sha256: "a".repeat(64),
    symlink_target: null,
  };
  expect(
    compareFullyObserved(capture, {
      ...capture,
      filesystem_checkpoints: [
        { name: "before", at_ms: 0, files: [], effects: [], truncated: false },
        {
          name: "after_settlement",
          at_ms: 10,
          files: [finalFile],
          effects: [
            {
              path: finalFile.path,
              status: "created",
              before: null,
              after: finalFile,
            },
          ],
          truncated: false,
        },
      ],
      files_after: [finalFile],
      filesystem_effects: [
        {
          path: finalFile.path,
          status: "created",
          before: null,
          after: finalFile,
        },
      ],
    }),
  ).toMatchObject({ filesystem: "changed", status: "changed" });
});

it.each([
  [500, "interaction", 6],
  [4, "process", 4],
] as const)(
  "orders an interaction difference by its dispatch time (process sample at %i ms)",
  (processTime, dimension, at) => {
    const capture = (side: "left" | "right") => {
      const base = emptyCapture();
      const journal = [
        { collection: "filesystem_checkpoints" as const, index: 0 },
        ...(processTime < 6
          ? [{ collection: "process_samples" as const, index: 0 }]
          : []),
        { collection: "interaction_events" as const, index: 0 },
        ...(processTime >= 6
          ? [{ collection: "process_samples" as const, index: 0 }]
          : []),
        { collection: "lifecycle" as const, index: 0 },
        { collection: "lifecycle" as const, index: 1 },
        { collection: "filesystem_checkpoints" as const, index: 1 },
      ].map((entry, capture_order) => ({ ...entry, capture_order }));
      return {
        ...base,
        manifest: {
          ...base.manifest,
          completed_at: "2026-01-01T00:00:01.000Z",
        },
        settlement: { ...base.settlement, elapsed_ms: 1000 },
        filesystem_checkpoints: base.filesystem_checkpoints.map(
          (checkpoint, index) => ({
            ...checkpoint,
            at_ms: index === 0 ? 0 : 1000,
          }),
        ),
        interaction_events: [
          {
            sequence: 0,
            scheduled_at_ms: 5,
            dispatched_at_ms: 6,
            type: "input" as const,
            data: "hello",
            outcome:
              side === "left" ? ("dispatched" as const) : ("failed" as const),
          },
        ],
        process_samples: [
          {
            at_ms: processTime,
            pid: 2,
            parent_pid: 1,
            command: side === "left" ? "worker-a" : "worker-b",
            process_group_id: 1,
            session_id: 1,
          },
        ],
        event_journal: journal,
      };
    };
    const comparison = compareFullyObserved(capture("left"), capture("right"));
    expect(comparison).toMatchObject({
      interaction: "changed",
      process: "changed",
      first_divergence: {
        status: "found",
        dimension,
        left_at_ms: at,
        right_at_ms: at,
      },
    });
  },
);

it("refuses mixed terminal observation versions even with PID and port rules disabled", () => {
  const base = emptyCapture();
  const scenario = processScenarioSchema.parse({
    executable: "/usr/bin/true",
    normalization: { pids: false, ports: false },
  });
  const committed = processScenarioCommitment(
    scenario,
    base.manifest.selected_executable_sha256 ?? undefined,
  );
  const contract = processComparisonContract(scenario);
  expect(contract).not.toHaveProperty("pid_normalization_version");
  expect(contract).not.toHaveProperty("port_normalization_version");
  expect(contract.terminal_observation_version).toBe(
    "deferred-rendered-journal-v1",
  );
  const capture = parseProcessCapture({
    ...base,
    normalization: scenario.normalization,
    manifest: {
      ...base.manifest,
      scenario: committed,
      full_scenario_sha256: digestProcessCommitment(committed),
      normalization_sha256: digestProcessCommitment(scenario.normalization),
      comparison_contract: contract,
      comparison_contract_sha256: digestProcessCommitment(contract),
    },
  });
  const legacyContract = { ...contract };
  delete legacyContract.terminal_observation_version;
  const legacy = parseProcessCapture({
    ...capture,
    manifest: {
      ...capture.manifest,
      comparison_contract: legacyContract,
      comparison_contract_sha256: digestProcessCommitment(legacyContract),
    },
  });
  expect(() => compareProcessCaptures(capture, legacy)).toThrow(
    expect.objectContaining({
      issues: [
        expect.objectContaining({ expected: ["terminal_observation_version"] }),
      ],
    }),
  );
});
