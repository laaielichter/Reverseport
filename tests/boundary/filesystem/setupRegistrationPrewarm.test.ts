import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, it } from "vitest";

import { createDoctorHostFixture } from "../../../src/application/Doctor.fixture.js";
import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { runSetup } from "../../../src/application/Setup.js";
import { options } from "../../../src/application/Setup.fixture.js";
import type { SetupRegistrationPrewarm } from "../../../src/application/SetupRegistrationPrewarm.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/**
 * A package-runner launch environment that also satisfies the fixture's
 * Hopper launcher probe, so setup reports readiness instead of proposing a
 * Hopper installation.
 */
const packageRunnerEnvironment = {
  npm_command: "exec",
  npm_config_user_agent: "npm/11.16.0 node/v24.14.0",
  HOPPER_LAUNCHER_PATH: "/fixture/Hopper",
} as const;

it("setup prewarms the pinned runner cache once after configuring clients", async () => {
  const root = await createTestTempDirectory("rea-setup-prewarm-");
  const client = supportedClients(root, "darwin", {}).find(
    (candidate) => candidate.name === "cursor",
  );
  if (client === undefined) throw new Error("Cursor registration is missing");
  await mkdir(dirname(client.configPath), { recursive: true });
  const doctor = createDoctorHostFixture({
    clientRegistrations: () =>
      readClientRegistrationStatuses(root, undefined, {
        platform: "darwin",
        environment: {},
      }),
    providerInspections: () =>
      Promise.resolve([
        {
          id: "hopper",
          configured: true,
          available: false,
          providerVersion: "6",
          registrationEnvironment: {},
          checks: [
            {
              name: "hopper-license",
              ok: false,
              code: "unavailable",
              detail: "Runtime license is unavailable",
              classification: "missing_analysis_engine",
              remediation: null,
            },
          ],
        },
      ]),
  });
  let prewarmCalls = 0;
  const prewarmResult: SetupRegistrationPrewarm = { status: "warmed" };
  const host = {
    ...systemSetupHost(doctor, packageRunnerEnvironment),
    // The host reports the developer machine's Node; pin a supported one
    // so readiness does not depend on the local runtime.
    nodeVersion: "24.22.1",
    detectedClients: () => Promise.resolve([client]),
    supportedClients: () => Promise.resolve([client]),
    prewarmRegistrationRunner: () => {
      prewarmCalls += 1;
      return Promise.resolve(prewarmResult);
    },
  };
  const result = await runSetup(
    {
      ...options(true),
      clientIds: ["cursor"],
      installSkill: false,
      proposeHopper: false,
      readinessScope: { clients: [], providers: [], skill: false },
    },
    host,
  );
  expect(result.status).toBe("ready");
  expect(result.clients.cursor).toMatchObject({ status: "configured" });
  expect(prewarmCalls).toBe(1);
  expect(result.prewarm).toEqual(prewarmResult);
});

it("keeps setup ready when registration prewarm fails, with a warning progress event", async () => {
  const root = await createTestTempDirectory("rea-setup-prewarm-fail-");
  const client = supportedClients(root, "darwin", {}).find(
    (candidate) => candidate.name === "cursor",
  );
  if (client === undefined) throw new Error("Cursor registration is missing");
  await mkdir(dirname(client.configPath), { recursive: true });
  const doctor = createDoctorHostFixture({
    clientRegistrations: () =>
      readClientRegistrationStatuses(root, undefined, {
        platform: "darwin",
        environment: {},
      }),
    providerInspections: () => Promise.resolve([]),
  });
  const progress: { state: string; detail?: string }[] = [];
  const host = {
    ...systemSetupHost(doctor, packageRunnerEnvironment),
    // The host reports the developer machine's Node; pin a supported one
    // so readiness does not depend on the local runtime.
    nodeVersion: "24.22.1",
    detectedClients: () => Promise.resolve([client]),
    supportedClients: () => Promise.resolve([client]),
    prewarmRegistrationRunner: () =>
      Promise.resolve({
        status: "failed" as const,
        reason: "The pinned package-runner entry could not be materialized",
      }),
  };
  const result = await runSetup(
    {
      ...options(true),
      clientIds: ["cursor"],
      installSkill: false,
      proposeHopper: false,
      readinessScope: { clients: [], providers: [], skill: false },
      onProgress: (event) =>
        progress.push({
          state: event.state,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        }),
    },
    host,
  );
  expect(result.status).toBe("ready");
  expect(result.prewarm).toMatchObject({ status: "failed" });
  expect(progress).toContainEqual({
    state: "warning",
    detail: "The pinned package-runner entry could not be materialized",
  });
});

it("setup omits the prewarm summary when the host offers no capability", async () => {
  const root = await createTestTempDirectory("rea-setup-prewarm-absent-");
  const client = supportedClients(root, "darwin", {}).find(
    (candidate) => candidate.name === "cursor",
  );
  if (client === undefined) throw new Error("Cursor registration is missing");
  await mkdir(dirname(client.configPath), { recursive: true });
  const doctor = createDoctorHostFixture({
    clientRegistrations: () =>
      readClientRegistrationStatuses(root, undefined, {
        platform: "darwin",
        environment: {},
      }),
    providerInspections: () => Promise.resolve([]),
  });
  const { prewarmRegistrationRunner: absent, ...hostWithoutPrewarm } =
    systemSetupHost(doctor, packageRunnerEnvironment);
  void absent;
  const host = {
    ...hostWithoutPrewarm,
    // The host reports the developer machine's Node; pin a supported one
    // so readiness does not depend on the local runtime.
    nodeVersion: "24.22.1",
    detectedClients: () => Promise.resolve([client]),
    supportedClients: () => Promise.resolve([client]),
  };
  const result = await runSetup(
    {
      ...options(true),
      clientIds: ["cursor"],
      installSkill: false,
      proposeHopper: false,
      readinessScope: { clients: [], providers: [], skill: false },
    },
    host,
  );
  expect(result.status).toBe("ready");
  expect(result.prewarm).toBeUndefined();
});

it("setup skips prewarm when no client registration was applied", async () => {
  const root = await createTestTempDirectory("rea-setup-prewarm-skip-");
  const client = supportedClients(root, "darwin", {}).find(
    (candidate) => candidate.name === "cursor",
  );
  if (client === undefined) throw new Error("Cursor registration is missing");
  await mkdir(dirname(client.configPath), { recursive: true });
  const doctor = createDoctorHostFixture({
    clientRegistrations: () =>
      readClientRegistrationStatuses(root, undefined, {
        platform: "darwin",
        environment: {},
      }),
    providerInspections: () => Promise.resolve([]),
  });
  let prewarmCalls = 0;
  const host = {
    ...systemSetupHost(doctor, packageRunnerEnvironment),
    nodeVersion: "24.22.1",
    detectedClients: () => Promise.resolve([client]),
    supportedClients: () => Promise.resolve([client]),
    prewarmRegistrationRunner: () => {
      prewarmCalls += 1;
      return Promise.resolve({ status: "warmed" as const });
    },
  };
  const result = await runSetup(
    {
      ...options(true),
      clientIds: [],
      installSkill: false,
      proposeHopper: false,
      readinessScope: { clients: [], providers: [], skill: false },
    },
    host,
  );
  expect(result.status).toBe("ready");
  expect(prewarmCalls).toBe(0);
  expect(result.prewarm).toBeUndefined();
});
