import { machoTargetSelectionSchema } from "../domain/apple/machoTargetSelection.js";
import { createFunctionCoordinateContext } from "../domain/native/functionCoordinateContext.js";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
  };
});

import { createReadStream } from "node:fs";

import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  hopperLoaderArgsForTarget,
  resolveHopperAnalysisProfile,
} from "./HopperAnalysisProfile.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

it("routes physical universal Mach-O containers through Hopper's FAT loader", () => {
  const result = hopperLoaderArgsForTarget(
    {
      path: "/tmp/universal",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
      universalSlice: { offset: 0, size: 32 },
    },
    "fat64",
  );

  expect(result).toEqual({
    ok: true,
    value: ["-l", "FAT", "--aarch64", "-l", "Mach-O"],
  });
});

it("prepares a verified thin arm64e slice for a FAT32 system container", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-profile-");
  const writeUInt32 = (buffer: Buffer, offset: number, value: number): void => {
    buffer.writeUInt32BE(value, offset);
  };
  const slices = [
    { cpuType: 0x01000007, cpuSubtype: 3 },
    { cpuType: 0x0100000c, cpuSubtype: 0x80000002 },
    { cpuType: 0x0100000c, cpuSubtype: 0x8000000c },
  ];
  const container = Buffer.alloc(3 * 4096 + 64);
  writeUInt32(container, 0, 0xcafebabe);
  writeUInt32(container, 4, slices.length);
  slices.forEach((slice, index) => {
    const offset = 4096 * (index + 1);
    const entry = 8 + index * 20;
    writeUInt32(container, entry, slice.cpuType);
    writeUInt32(container, entry + 4, slice.cpuSubtype);
    writeUInt32(container, entry + 8, offset);
    writeUInt32(container, entry + 12, 64);
    writeUInt32(container, entry + 16, 12);
    writeUInt32(container, offset, 0xfeedfacf);
    writeUInt32(container, offset + 4, slice.cpuType);
    writeUInt32(container, offset + 8, slice.cpuSubtype);
  });
  const arm64eOffset = 8192;
  const path = join(directory, "system.fat");
  await writeFile(path, container);
  const result = await resolveHopperAnalysisProfile(
    {
      path,
      sha256: createHash("sha256").update(container).digest("hex"),
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
      universalSlice: { offset: arm64eOffset, size: 64 },
    },
    {
      launcherPath: path,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper Disassembler", version: null },
      resourceScope: inspectionResources.owner,
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  const parameters = result.value.profile?.parameters;
  expect(parameters).toMatchObject({
    function_coordinate_context: createFunctionCoordinateContext(
      { loader_arguments: ["-l", "Mach-O", "--aarch64"] },
      // The same typed selected-image fact is used by the producer and comparator.
      machoTargetSelectionSchema.parse(parameters?.target_selection),
    ),
    macho_container: "fat32",
    prepared_image: {
      method: "fat32_thin_slice",
      source_offset: arm64eOffset,
      byte_length: 64,
      cpu_type: 0x0100000c,
      cpu_subtype: 0x80000002,
    },
    target_selection: {
      kind: "macho-selected-image-v1",
      container: "fat",
      offset: arm64eOffset,
      byte_length: 64,
      cpu_type: 0x0100000c,
      cpu_subtype: 0x80000002,
      container_table_sha256: expect.any(String),
    },
    loader: {
      source: "derived",
      arguments: ["-l", "Mach-O", "--aarch64"],
    },
  });
});

it("commits a thin header selection only for derived Hopper loader arguments", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-profile-");
  const thin = Buffer.alloc(64);
  thin.writeUInt32LE(0xfeedfacf, 0);
  thin.writeUInt32LE(0x0100000c, 4);
  thin.writeUInt32LE(0x80000002, 8);
  const path = join(directory, "arm64e.macho");
  await writeFile(path, thin);
  const target = {
    path,
    sha256: createHash("sha256").update(thin).digest("hex"),
    kind: "executable" as const,
    format: "mach-o" as const,
    architecture: "arm64" as const,
    availableArchitectures: ["arm64" as const],
  };
  const provider = {
    id: "hopper",
    name: "Hopper Disassembler",
    version: null,
  };
  const resolved = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: [],
    provider,
    resourceScope: inspectionResources.owner,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  expect(resolved.value.profile?.parameters.target_selection).toEqual({
    kind: "macho-selected-image-v1",
    container: "thin",
    offset: 0,
    byte_length: 64,
    cpu_type: 0x0100000c,
    cpu_subtype: 0x80000002,
    container_table_sha256: null,
  });
  expect(
    resolved.value.profile?.parameters.function_coordinate_context,
  ).toEqual(
    createFunctionCoordinateContext(
      { loader_arguments: ["-l", "Mach-O", "--aarch64"] },
      machoTargetSelectionSchema.parse(
        resolved.value.profile?.parameters.target_selection,
      ),
    ),
  );
  expect(resolved.value.profile?.parameters.prepared_image).toEqual({
    method: "thin_verified_copy",
    byte_length: thin.length,
    cpu_type: 0x0100000c,
    cpu_subtype: 0x80000002,
  });

  const overridden = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: ["-l", "Mach-O"],
    provider,
    resourceScope: inspectionResources.owner,
  });
  if (!overridden.ok) throw new Error(overridden.error.message);
  expect(overridden.value.profile?.parameters).not.toHaveProperty(
    "target_selection",
  );

  expect(overridden.value.profile?.parameters).not.toHaveProperty(
    "function_coordinate_context",
  );
  const changedSameSize = Buffer.from(thin);
  changedSameSize.writeUInt8(
    changedSameSize.readUInt8(changedSameSize.length - 1) ^ 1,
    changedSameSize.length - 1,
  );
  await writeFile(path, changedSameSize);
  const staleAdmission = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: [],
    provider,
    resourceScope: inspectionResources.owner,
  });
  expect(staleAdmission.ok).toBe(false);
  if (staleAdmission.ok) throw new Error("stale thin admission was accepted");
  expect(staleAdmission.error.message).toContain(
    "Thin Mach-O source changed after target admission",
  );
});

it("keeps a read failure primary when cancellation arrives with the stream error", async () => {
  const path = "/fixture/arm64.macho";
  const target = {
    path,
    sha256: "a".repeat(64),
    kind: "executable" as const,
    format: "mach-o" as const,
    architecture: "arm64" as const,
    availableArchitectures: ["arm64" as const],
  };
  const controller = new AbortController();
  const reason = { request: "cancel-after-read-error" };
  const physicalFailure = new Error("fixture read failure");
  const stream = new PassThrough();
  vi.mocked(createReadStream).mockReturnValueOnce(
    stream as unknown as ReturnType<typeof createReadStream>,
  );
  stream.once("error", () => controller.abort(reason));

  const resolving = resolveHopperAnalysisProfile(target, {
    launcherPath: "/fixture/hopper",
    loaderArgsOverride: [],
    provider: { id: "hopper", name: "Hopper", version: null },
    resourceScope: inspectionResources.owner,
    signal: controller.signal,
  });
  stream.destroy(physicalFailure);

  const result = await resolving;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("A failed header read was accepted");
  expect(result.error._tag).toBe("BinaryTargetError");
  expect(result.error.cause).toBe(physicalFailure);
});

it("retains the exact caller reason when the owned header stream is aborted", async () => {
  const controller = new AbortController();
  const reason = { request: "cancel-header-read" };
  const stream = new PassThrough();
  vi.mocked(createReadStream).mockReturnValueOnce(
    stream as unknown as ReturnType<typeof createReadStream>,
  );
  const resolving = resolveHopperAnalysisProfile(
    {
      path: "/fixture/arm64.macho",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    {
      launcherPath: "/fixture/hopper",
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
      signal: controller.signal,
    },
  );
  controller.abort(reason);

  const result = await resolving;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("An aborted header read was accepted");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
});

it("keeps failed Mach-O preflight cleanup attached to the supplied profile owner", async () => {
  const directory = await createTestTempDirectory("rea-hopper-profile-owner-");
  const sourcePath = join(directory, "source.macho");
  const bytes = Buffer.alloc(100_000, 0x5a);
  bytes.writeUInt32BE(0xfeedfacf, 0);
  bytes.writeUInt32BE(0x0100000c, 4);
  bytes.writeUInt32BE(0x80000002, 8);
  await writeFile(sourcePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const actualNodeFs =
    await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(createReadStream).mockReset();
  vi.mocked(createReadStream).mockImplementation(actualNodeFs.createReadStream);
  const closeFailure = new Error("profile preflight close failure");
  let allowClose = false;
  const imageFileSystem = {
    open: async (...args: Parameters<typeof actualFs.open>) => {
      const handle = await actualFs.open(...args);
      const closeHandle = handle.close.bind(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async (): Promise<void> => {
          if (!allowClose) throw closeFailure;
          await closeHandle();
        },
      });
      return handle;
    },
  };
  const owner = inspectionResources;

  const resolved = await resolveHopperAnalysisProfile(
    {
      path: sourcePath,
      sha256,
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    {
      launcherPath: sourcePath,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: owner.owner,
      imageFileSystem,
    },
  );

  expect(resolved.ok).toBe(false);
  if (resolved.ok) throw new Error("Failed preflight cleanup was accepted");
  expect(resolved.error._tag).toBe("BinaryTargetError");
  expect(resolved.error.cause).toBe(closeFailure);
  expect(resolved.error.cleanupIncomplete).toBe(true);
  expect(resolved.error.cleanupResources).toEqual([
    `hopper-macho-preflight:${sourcePath}`,
  ]);

  allowClose = true;
  await owner.close();
  expect(resolved.error.cleanupIncomplete).toBe(false);
});

it("preserves launcher fingerprint filesystem failures instead of an absent profile", async () => {
  const failure = Object.assign(
    new Error("EACCES: fixture launcher read denied"),
    { code: "EACCES" },
  );
  const stream = new PassThrough();
  vi.mocked(createReadStream).mockReturnValueOnce(
    stream as unknown as ReturnType<typeof createReadStream>,
  );
  const resolving = resolveHopperAnalysisProfile(
    {
      path: "/fixture/input",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
    },
    {
      launcherPath: "/fixture/hopper",
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
    },
  );
  stream.destroy(failure);
  const result = await resolving;
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      cause: failure,
      diagnostics: { launcher_path: "/fixture/hopper", system_code: "EACCES" },
    },
  });
});
