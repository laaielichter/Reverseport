import {
  regularFileCancellation,
  RegularFileCleanupFailure,
  RegularFileCancelled,
  withOwnedRegularFile,
  OwnedRegularFileOperationFailure,
} from "../filesystem/OwnedRegularFile.js";
import {
  bindRegularFileCleanup,
  RetainedRegularFileCleanupFailure,
  retryRegularFileCleanup,
} from "./RegularFileRead.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { constants, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { extname } from "node:path";

import { BinaryTargetError } from "../domain/configurationErrors.js";
import {
  sameRegularFileState,
  type StableRegularFileDescriptor,
} from "../filesystem/RegularFile.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type {
  BinaryTarget,
  BinaryArchitecture,
  PeCodeViewRecord,
  UniversalMachOSlice,
} from "../domain/binaryTargetTypes.js";
import { err, ok, type Result } from "../domain/result.js";
import { readMipsElfMetadata } from "./MipsElfMetadata.js";
import { validateElfDeclaredRanges } from "../domain/elfDeclaredRanges.js";
import {
  resolveAppBundleExecutable,
  type ResolvedAppBundle,
} from "./AppBundleExecutable.js";
import {
  validateDosComLength,
  type ExecutableFormatHint,
} from "../domain/dosCom.js";
import {
  admitRawBinary,
  rawBinarySelectionError,
} from "../domain/rawBinary.js";
import { admitGamecubeDol } from "../domain/gamecubeDolAdmission.js";
import { DOL_HEADER_SIZE } from "../domain/gamecubeDol.js";
import {
  mzWindowsHeaderLayoutLimitation,
  observeMzWindowsHeader,
  parseMzHeaderEvidence,
  type DosMzHeader,
  type MzWindowsHeaderObservation,
} from "../domain/dosMz.js";
import {
  createXmlPlistSignatureProbe,
  hasBinaryPlistSignature,
  MAX_XML_PLIST_PROBE_BYTES,
} from "../domain/apple/appleArchiveFormat.js";
import { hasGodotPckHeader } from "../domain/godotPckFormat.js";
import {
  hasZipSignature,
  locateTrailingZipArchive,
  isZipPackageFormat,
  zipRootPackageFormat,
} from "../domain/zipPackageFormat.js";

import {
  parseCodeViewData,
  claimsExecutableHeader,
  parseExecutableHeader,
  parsePeRecord,
  peDebugDirectoryEntry,
  peRvaToFileOffset,
  type ExecutableMetadata,
} from "../domain/binaryTarget.js";
import {
  classifyFatContainerIdentity,
  readFatContainerHeader,
  readMachoHeaderPrefixFacts,
  type FatSliceHeaderEvidence,
  type MachoHeaderPrefixFacts,
} from "../domain/apple/machoContainer.js";
import {
  isJvmClassFile,
  MAX_JVM_CLASS_IDENTITY_BYTES,
  JVM_CLASS_IDENTITY_LIMIT_REASON,
} from "../domain/apple/jvmClassFile.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandTableHeader,
  type MachoLoadCommandTableHeader,
} from "../domain/apple/machoLoadCommands.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { JsonValue } from "../domain/jsonValue.js";

const XML_PLIST_PROBE_CHUNK_BYTES = 64 * 1024;

/** Options for resolving a local binary target and its stable identity. */
export interface BinaryTargetResolverOptions {
  readonly cwd?: string;
  readonly hostArchitecture?: NodeJS.Architecture;
  readonly targetKind?: BinaryTarget["kind"];
  readonly formatHint?: ExecutableFormatHint;
  readonly architecture?: BinaryArchitecture;
  readonly entryPoint?: string;
  readonly signal?: AbortSignal;
  readonly resources?: ArtifactResourceScope;
}

/**
 * Resolve and classify a readable local target before a provider is selected.
 * FAT Mach-O inputs select the host-compatible architecture, otherwise their
 * first declared supported slice, so setup remains non-interactive; unsupported
 * or ambiguous inputs are returned as typed errors.
 */
export const parseBinaryTarget = async (
  input: string,
  options: BinaryTargetResolverOptions = {},
): Promise<
  Result<BinaryTarget, BinaryTargetError | AnalysisCancelledError>
> => {
  const cwd = options.cwd ?? process.cwd();
  const { signal } = options;
  const candidate = absoluteCallerPath(input, { cwd });
  // Failures before canonicalization concern the selected path itself; later
  // failures concern the canonical path opened with symbolic links rejected.
  let stage: TargetFilesystemStage = "resolve";
  const resolve = async (): Promise<TargetResolution> => {
    throwIfTargetResolutionCancelled(signal);
    await access(candidate, constants.R_OK);
    throwIfTargetResolutionCancelled(signal);
    const canonical = await realpath(candidate);
    stage = "read";
    // Windows native admission must inspect the caller-selected reparse components.
    const sourcePath = process.platform === "win32" ? candidate : canonical;
    throwIfTargetResolutionCancelled(signal);
    const resolved = await resolveAppBundle(canonical);
    throwIfTargetResolutionCancelled(signal);
    if (!resolved.ok) return err(resolved.error);
    const { executable: path, infoPlist } = resolved.value;
    const bundle =
      infoPlist === undefined ? {} : { bundleInfoPlist: infoPlist };
    return withOwnedRegularFile<TargetResolution>(
      path,
      {
        symlinks: "reject",
        ...(signal === undefined ? {} : { signal }),
      },
      async (source) => {
        try {
          return await readOpenedBinaryTarget(
            source,
            { path, sourcePath, ...bundle },
            options,
          );
        } catch (cause: unknown) {
          throw new OwnedRegularFileOperationFailure(cause);
        }
      },
    );
  };
  try {
    const resolved = await (options.resources === undefined
      ? resolve()
      : options.resources.run(resolve));
    return finalizedTargetResolution(resolved, signal);
  } catch (cause: unknown) {
    // A caller-selected abort value never transfers file ownership.
    if (signal?.aborted === true && cause === signal.reason)
      return err(
        new AnalysisCancelledError("resolve_binary_target", { cause }),
      );
    if (cause instanceof RegularFileCleanupFailure) {
      const fileFailure = cause as RegularFileCleanupFailure<TargetResolution>;
      if (options.resources === undefined)
        return err(
          targetFileCleanupError(
            new RetainedRegularFileCleanupFailure(fileFailure),
            candidate,
            stage,
          ),
        );
      const retried = await retryRegularFileCleanup(
        fileFailure,
        options.resources,
        signal,
      );
      if (retried.failure !== undefined)
        return err(targetFileCleanupError(retried.failure, candidate, stage));
      if (retried.outcome.kind === "failed")
        return targetResolutionFailure(
          fileFailure.operationFailure ?? retried.outcome.cause,
          candidate,
          stage,
          signal,
        );
      return finalizedTargetResolution(retried.outcome.value, signal);
    }
    if (cause instanceof RegularFileCancelled)
      return finalizedTargetResolution(
        cause.outcome.value as TargetResolution,
        signal,
      );
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
      const error = new BinaryTargetError(
        candidate,
        "A previous target file could not be closed",
        {
          cause,
          cleanup: cause.cleanup,
          partialObservation: cause.partialObservation,
        },
      );
      bindRegularFileCleanup(cause, error);
      return err(error);
    }
    return targetResolutionFailure(cause, candidate, stage, signal);
  }
};

type TargetResolution = Result<
  BinaryTarget,
  BinaryTargetError | AnalysisCancelledError
>;

/** Classify and hash the one descriptor admitted by the lifetime owner. */
const readOpenedBinaryTarget = async (
  source: StableRegularFileDescriptor,
  selected: {
    readonly path: string;
    readonly sourcePath: string;
    readonly bundleInfoPlist?: string;
  },
  options: BinaryTargetResolverOptions,
): Promise<TargetResolution> => {
  const { handle, initial: metadata } = source;
  const { path, sourcePath, bundleInfoPlist } = selected;
  const bundle = bundleInfoPlist === undefined ? {} : { bundleInfoPlist };
  const hostArchitecture = options.hostArchitecture ?? process.arch;
  const { targetKind, formatHint, signal, architecture, entryPoint } = options;
  throwIfTargetResolutionCancelled(signal);
  if (formatHint === "raw-binary") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "raw-binary format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    const admitted = admitRawBinary({
      architecture,
      entryPoint,
      fileBytes: metadata.size,
    });
    if (!admitted.ok)
      return err(
        new BinaryTargetError(path, admitted.error.reason, {
          constraint: admitted.error.constraint,
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "raw-binary",
      architecture: admitted.value.architecture,
      availableArchitectures: [admitted.value.architecture],
      entryPoint: admitted.value.entryPoint,
      entryPointSource: admitted.value.entryPointSource,
    });
  }
  const pairing = rawBinarySelectionError({
    ...(formatHint === undefined ? {} : { format: formatHint }),
    architecture,
    entryPoint,
  });
  if (pairing !== undefined)
    return err(
      new BinaryTargetError(path, pairing, {
        constraint: "load_selection_rejected",
      }),
    );
  if (formatHint === "gamecube-dol") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "gamecube-dol format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    // Only the fixed header is parsed; section bounds use the file size from metadata.
    const headerBytes = await readLeadingBytes(
      handle,
      Math.min(metadata.size, DOL_HEADER_SIZE),
      path,
      signal,
    );
    const admitted = admitGamecubeDol({
      bytes: headerBytes,
      fileSize: metadata.size,
      entryPoint,
    });
    if (!admitted.ok)
      return err(
        new BinaryTargetError(path, admitted.error.reason, {
          constraint: admitted.error.constraint,
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "gamecube-dol",
      architecture: admitted.value.architecture,
      availableArchitectures: [admitted.value.architecture],
      byteOrder: "big",
      bits: 32,
      entryPoint: admitted.value.entryPoint,
      entryPointSource: admitted.value.entryPointSource,
      dol: admitted.value.header,
    });
  }
  if (formatHint === "dos-com") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "DOS COM format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    const length = validateDosComLength(metadata.size);
    if (!length.ok)
      return err(
        new BinaryTargetError(path, length.error, {
          constraint: "file_format_rejected",
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "dos-com",
      architecture: "x86",
      availableArchitectures: ["x86"],
    });
  }
  // Probe WASM content before suffix-only database routing; an explicit
  // database selection keeps the caller's chosen interpretation.
  const artifactFormat =
    targetKind === "database"
      ? undefined
      : await detectArtifactFormat(path, source, signal);
  if (
    targetKind === "database" ||
    (targetKind === undefined && path.toLowerCase().endsWith(".hop"))
  )
    return ok({
      path,
      sourcePath,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "database",
      format: "analysis-database",
    });
  if (artifactFormat !== undefined) {
    const identity = {
      path,
      sourcePath,
      sha256: await sha256Handle(handle, path, metadata, signal),
    };
    return isArchiveFormat(artifactFormat)
      ? ok({ ...identity, kind: "archive", format: artifactFormat })
      : ok({ ...identity, kind: "artifact", format: artifactFormat });
  }
  const detected = await readExecutableMetadata(
    source,
    hostArchitecture,
    signal,
  );
  if (!detected.ok) {
    // Only bytes no other format claims may lead a located ZIP, so an
    // executable with an appended archive keeps its executable route.
    if (
      !(await claimsLeadingExecutableHeader(handle, metadata.size, signal)) &&
      (await locateTrailingZipArchive(metadata.size, (position, length) =>
        readHandleRange(handle, position, length, signal),
      )) !== undefined
    )
      return ok({
        path,
        sourcePath,
        sha256: await sha256Handle(handle, path, metadata, signal),
        kind: "archive",
        format: zipRootPackageFormat(path),
      });
    const reason =
      typeof detected.error === "string"
        ? detected.error
        : detected.error.reason;
    const diagnostics =
      typeof detected.error === "string"
        ? undefined
        : detected.error.diagnostics;
    return err(
      new BinaryTargetError(path, reason, {
        constraint: "file_format_rejected",
        ...(diagnostics === undefined ? {} : { diagnostics }),
      }),
    );
  }
  return ok({
    path,
    sourcePath,
    ...bundle,
    sha256: await sha256Handle(handle, path, metadata, signal),
    kind: "executable",
    ...detected.value,
  });
};

/** Preserve an earlier admission refusal over an interruption during final close. */
const finalizedTargetResolution = (
  result: TargetResolution,
  signal?: AbortSignal,
): TargetResolution => {
  if (!result.ok || signal?.aborted !== true) return result;
  return err(
    new AnalysisCancelledError("resolve_binary_target", {
      cause: signal.reason,
      diagnostics: { completed_target: jsonValueSchema.parse(result.value) },
    }),
  );
};

/** Descriptor cleanup retains the physical result and binds its exact release lease. */
const targetFileCleanupError = (
  failure: RetainedRegularFileCleanupFailure<TargetResolution>,
  candidate: string,
  stage: TargetFilesystemStage,
): BinaryTargetError => {
  const cancellation = regularFileCancellation(failure);
  const completed =
    failure.outcome.kind === "completed" ? failure.outcome.value : undefined;
  const completedTarget =
    completed?.ok === true ? jsonValueSchema.parse(completed.value) : undefined;
  let primary: BinaryTargetError | AnalysisCancelledError | undefined;
  if (failure.outcome.kind === "failed") {
    const physical = failure.outcome.cause;
    primary =
      physical instanceof BinaryTargetError ||
      physical instanceof AnalysisCancelledError
        ? physical
        : cancellation !== undefined
          ? new AnalysisCancelledError("resolve_binary_target", {
              cause: cancellation.reason,
            })
          : (classifyTargetFilesystemFailure(candidate, physical, stage) ??
            new BinaryTargetError(
              failure.path,
              "Target read failed before file cleanup",
              { cause: physical },
            ));
  } else if (completed?.ok === false) primary = completed.error;
  else if (cancellation !== undefined)
    primary = new AnalysisCancelledError("resolve_binary_target", {
      cause: cancellation.reason,
      ...(completedTarget === undefined
        ? {}
        : { diagnostics: { completed_target: completedTarget } }),
    });
  const error = new BinaryTargetError(
    failure.path,
    "The target file handle could not be closed",
    {
      cause: failure,
      cleanupPrimary: primary,
      cleanup: {
        reason:
          failure.cleanupCause instanceof Error
            ? failure.cleanupCause.message
            : String(failure.cleanupCause),
        resources: [failure.path],
      },
      diagnostics: {
        ...(primary === undefined
          ? {}
          : { primary_error: projectAnalysisError(primary) }),
        ...(completedTarget === undefined
          ? {}
          : { completed_target: completedTarget }),
      },
    },
  );
  bindRegularFileCleanup(failure, error);
  return error;
};

const targetResolutionFailure = (
  cause: unknown,
  candidate: string,
  stage: TargetFilesystemStage,
  signal?: AbortSignal,
): TargetResolution => {
  // Physical rejection values do not grant ownership of foreign descriptors.
  const physical =
    cause instanceof OwnedRegularFileOperationFailure
      ? cause.operationCause
      : cause;
  if (
    physical instanceof AnalysisCancelledError ||
    physical instanceof BinaryTargetError
  )
    return err(physical);
  if (!(cause instanceof OwnedRegularFileOperationFailure)) {
    const cancellation = regularFileCancellation(cause);
    if (cancellation !== undefined)
      return err(
        new AnalysisCancelledError("resolve_binary_target", {
          cause: cancellation.reason,
        }),
      );
  }
  if (signal?.aborted === true && physical === signal.reason)
    return err(
      new AnalysisCancelledError("resolve_binary_target", { cause: physical }),
    );
  const failure = classifyTargetFilesystemFailure(candidate, physical, stage);
  if (failure === undefined) throw physical;
  return err(failure);
};

/**
 * `resolve` covers the caller-selected path before canonicalization; `read`
 * covers a canonical path opened with symbolic links rejected.
 */
type TargetFilesystemStage = "resolve" | "read";

/** Classify a filesystem failure while reading a previously selected target. */
export const classifyBinaryTargetFilesystemFailure = (
  path: string,
  cause: unknown,
): BinaryTargetError | undefined =>
  classifyTargetFilesystemFailure(path, cause, "read");

const classifyTargetFilesystemFailure = (
  path: string,
  cause: unknown,
  stage: TargetFilesystemStage,
): BinaryTargetError | undefined => {
  if (!(cause instanceof Error)) return undefined;
  const code = filesystemErrorCode(cause);
  return code === undefined
    ? undefined
    : new BinaryTargetError(
        path,
        targetFailureReason(code, cause.message, stage),
        { cause },
      );
};

const filesystemErrorCode = (cause: Error): string | undefined => {
  const code: unknown = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
};

const targetFailureReason = (
  code: string,
  detail: string,
  stage: TargetFilesystemStage,
): string => {
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
      return `target does not exist or a path component is not a directory: ${detail}`;
    case "EACCES":
    case "EPERM":
      return `permission denied while reading target: ${detail}`;
    case "EISDIR":
      return `target is a directory, not a readable file: ${detail}`;
    case "ENOTFILE":
      return "target is not a regular file";
    case "ELOOP":
      // A canonical path has no symbolic links left, so a link rejected while
      // reading it appeared after resolution. Before that, ELOOP is a loop or
      // an over-deep link chain in the selected path itself.
      return stage === "resolve"
        ? `target path could not be resolved: too many symbolic links or a symbolic link loop: ${detail}`
        : `target changed while being opened: ${detail}`;
    default:
      return `target could not be read (${code}): ${detail}`;
  }
};

const throwIfTargetResolutionCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError("resolve_binary_target", {
      cause: signal.reason,
    });
};

const detectArtifactFormat = async (
  path: string,
  source: StableRegularFileDescriptor,
  signal?: AbortSignal,
): Promise<
  | Exclude<
      BinaryTarget["format"],
      | "analysis-database"
      | "mach-o"
      | "mach-o-universal"
      | "elf"
      | "pe"
      | "dos-mz"
      | "dos-com"
      | "raw-binary"
      | "gamecube-dol"
    >
  | undefined
> => {
  const { handle, initial } = source;
  throwIfTargetResolutionCancelled(signal);
  const lower = path.toLowerCase();
  const magic = Buffer.alloc(4096);
  const observed = await handle.read(magic, 0, magic.length, 0);
  throwIfTargetResolutionCancelled(signal);
  if (
    observed.bytesRead >= 8 &&
    magic.subarray(0, 8).equals(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))
  )
    throw new BinaryTargetError(
      path,
      "WebAssembly v1 artifacts are not supported by the native opening route",
      { constraint: "wasm_requires_static_inspection" },
    );
  if (hasZipSignature(magic.subarray(0, observed.bytesRead)))
    return zipRootPackageFormat(lower);
  if (hasGodotPckHeader(magic.subarray(0, observed.bytesRead)))
    return "godot-pck";
  // Binary plists, including keyed archives, often use other extensions.
  if (hasBinaryPlistSignature(magic.subarray(0, observed.bytesRead)))
    return "plist";
  const named = namedArtifactFormat(lower);
  if (named !== undefined) return named;
  if (
    lower.endsWith(".pkg") &&
    observed.bytesRead >= 4 &&
    magic.subarray(0, 4).equals(Buffer.from("xar!"))
  )
    return "pkg";
  if (lower.endsWith(".dmg")) {
    throwIfTargetResolutionCancelled(signal);
    const size = initial.size;
    if (size >= 512) {
      const trailer = Buffer.alloc(4);
      const read = await handle.read(trailer, 0, trailer.length, size - 512);
      throwIfTargetResolutionCancelled(signal);
      if (read.bytesRead === 4 && trailer.equals(Buffer.from("koly")))
        return "dmg";
    }
  }
  // XML property lists can use archive-specific suffixes such as .archive.
  // The named-format check above keeps .js, .map, and .asar classifications.
  const xmlProbe = createXmlPlistSignatureProbe();
  let xmlState = xmlProbe.write(magic.subarray(0, observed.bytesRead));
  if (xmlState === "matched") return "plist";
  const chunk = Buffer.alloc(XML_PLIST_PROBE_CHUNK_BYTES);
  let bytesRead = observed.bytesRead;
  while (xmlState === "pending" && bytesRead < MAX_XML_PLIST_PROBE_BYTES) {
    throwIfTargetResolutionCancelled(signal);
    const read = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, MAX_XML_PLIST_PROBE_BYTES - bytesRead),
      bytesRead,
    );
    throwIfTargetResolutionCancelled(signal);
    if (read.bytesRead === 0) break;
    bytesRead += read.bytesRead;
    xmlState = xmlProbe.write(chunk.subarray(0, read.bytesRead));
    if (xmlState === "matched") return "plist";
  }
  if (bytesRead === MAX_XML_PLIST_PROBE_BYTES) {
    const { size } = initial;
    throwIfTargetResolutionCancelled(signal);
    if (size > bytesRead)
      throw new BinaryTargetError(
        path,
        "XML plist prolog was not found within the 1 MiB format probe limit",
        { constraint: "file_format_rejected" },
      );
  }
  return undefined;
};

const namedArtifactFormat = (
  lowerPath: string,
): "asar" | "plist" | "source-map" | "javascript" | undefined => {
  if (lowerPath.endsWith(".asar")) return "asar";
  if (lowerPath.endsWith(".plist")) return "plist";
  if (lowerPath.endsWith(".map")) return "source-map";
  return /\.(?:m?js|cjs)$/u.test(lowerPath) ? "javascript" : undefined;
};

const isArchiveFormat = (
  format: Exclude<
    BinaryTarget["format"],
    | "analysis-database"
    | "mach-o"
    | "mach-o-universal"
    | "elf"
    | "pe"
    | "dos-mz"
    | "dos-com"
    | "raw-binary"
    | "gamecube-dol"
  >,
): format is Extract<BinaryTarget, { kind: "archive" }>["format"] =>
  isZipPackageFormat(format) ||
  ["asar", "godot-pck", "dmg", "pkg"].includes(format);

/** Whether the leading bytes begin any executable header family, valid or not. */
const claimsLeadingExecutableHeader = async (
  handle: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<boolean> =>
  claimsExecutableHeader(
    Buffer.from(await readHandleRange(handle, 0, Math.min(size, 4096), signal)),
    size,
  );

/** Read one bounded range, honoring cancellation around the host read. */
const readHandleRange = async (
  handle: FileHandle,
  position: number,
  length: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  throwIfTargetResolutionCancelled(signal);
  const bytes = Buffer.alloc(length);
  const observed = await handle.read(bytes, 0, length, position);
  throwIfTargetResolutionCancelled(signal);
  return bytes.subarray(0, observed.bytesRead);
};

/** Read exactly `size` bytes by offset; a short read means the file changed or ended early. */
const readLeadingBytes = async (
  handle: FileHandle,
  size: number,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const bytes = Buffer.allocUnsafe(size);
  let position = 0;
  while (position < size) {
    throwIfTargetResolutionCancelled(signal);
    const observed = await handle.read(
      bytes,
      position,
      size - position,
      position,
    );
    if (observed.bytesRead === 0)
      throw new BinaryTargetError(path, "target changed while being read");
    position += observed.bytesRead;
  }
  return bytes;
};

const sha256Handle = async (
  handle: FileHandle,
  path: string,
  initial: Stats,
  signal?: AbortSignal,
): Promise<string> => {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    throwIfTargetResolutionCancelled(signal);
    const observed = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, initial.size - position + 1),
      position,
    );
    throwIfTargetResolutionCancelled(signal);
    if (observed.bytesRead === 0) break;
    hash.update(chunk.subarray(0, observed.bytesRead));
    position += observed.bytesRead;
    if (position > initial.size)
      throw new BinaryTargetError(path, "target grew while being read");
  }
  throwIfTargetResolutionCancelled(signal);
  const [opened, currentPath] = await Promise.all([handle.stat(), lstat(path)]);
  if (
    !sameRegularFileState(initial, opened) ||
    !sameRegularFileState(initial, currentPath) ||
    position !== initial.size
  )
    throw new BinaryTargetError(path, "target changed while being read");
  return hash.digest("hex");
};

const resolveAppBundle = async (
  path: string,
): Promise<Result<ResolvedAppBundle, BinaryTargetError>> => {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) return ok({ executable: path });
  if (extname(path).toLowerCase() !== ".app")
    return err(
      new BinaryTargetError(
        path,
        "this opening route requires a file or app bundle",
        {
          constraint: "directory_requires_file",
        },
      ),
    );
  return resolveAppBundleExecutable(path);
};

const readExecutableMetadata = async (
  source: StableRegularFileDescriptor,
  hostArchitecture: NodeJS.Architecture,
  signal?: AbortSignal,
): Promise<Result<ExecutableMetadata, ExecutableMetadataFailure>> => {
  const { handle, initial } = source;
  throwIfTargetResolutionCancelled(signal);
  const prefix = Buffer.alloc(4096);
  const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
  throwIfTargetResolutionCancelled(signal);
  const bytes = prefix.subarray(0, prefixRead.bytesRead);
  // Header commitments such as Mach-O load commands and FAT slices are
  // checked against the whole file, not the probed prefix.
  const fileSize = initial.size;
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    let evidence = parseMzHeaderEvidence(bytes, fileSize);
    let signatureEvidence:
      | { readonly offset: number; readonly bytes: Buffer }
      | undefined;
    if (evidence.windowsHeader.state === "signature-needed") {
      const { offset } = evidence.windowsHeader;
      const signature = Buffer.alloc(Math.min(4, fileSize - offset));
      const observedSignature = await handle.read(
        signature,
        0,
        signature.length,
        offset,
      );
      throwIfTargetResolutionCancelled(signal);
      signatureEvidence = {
        offset,
        bytes: signature.subarray(0, observedSignature.bytesRead),
      };
      evidence = parseMzHeaderEvidence(bytes, fileSize, signatureEvidence);
    }
    const { windowsHeader } = evidence;
    if (windowsHeader.state === "declared") {
      const limitation = mzWindowsHeaderLayoutLimitation(windowsHeader);
      if (limitation !== undefined)
        return err({
          reason: limitation,
          diagnostics: {
            unsupported_layout: true,
            mz_windows_header: { ...windowsHeader },
          },
        });
      return readPeMetadata(
        handle,
        windowsHeader.offset,
        bytes,
        fileSize,
        signal,
      );
    }
    // MZ relocation records may extend past the initial probe; their format
    // bounds are at most 65535 records inside a 65535-paragraph header.
    const tableEnd =
      bytes.length >= 28
        ? bytes.readUInt16LE(24) + bytes.readUInt16LE(6) * 4
        : 0;
    const headerBytes = bytes.length >= 28 ? bytes.readUInt16LE(8) * 16 : 0;
    if (
      tableEnd > bytes.length &&
      tableEnd <= headerBytes &&
      tableEnd <= fileSize
    ) {
      const table = Buffer.alloc(tableEnd);
      const observed = await handle.read(table, 0, table.length, 0);
      throwIfTargetResolutionCancelled(signal);
      evidence = parseMzHeaderEvidence(
        table.subarray(0, observed.bytesRead),
        fileSize,
        signatureEvidence,
      );
      if (evidence.windowsHeader.state === "candidate")
        return err(
          unresolvedMzHeaderFailure(evidence.windowsHeader, evidence.dos),
        );
      return parseExecutableHeader(
        table.subarray(0, observed.bytesRead),
        hostArchitecture,
        fileSize,
        signatureEvidence,
      );
    }
    if (windowsHeader.state === "candidate")
      return err(unresolvedMzHeaderFailure(windowsHeader, evidence.dos));
    return parseExecutableHeader(
      bytes,
      hostArchitecture,
      fileSize,
      signatureEvidence,
    );
  }
  if (bytes.length >= 4 && bytes.toString("hex", 0, 4) === "7f454c46")
    return readElfMetadata(handle, bytes, {
      fileSize,
      hostArchitecture,
      signal,
    });
  const thin = await readThinMachoMetadata(handle, bytes, {
    fileSize,
    hostArchitecture,
    signal,
  });
  if (thin !== null) return thin;
  const hasJvmMagic = bytes.length >= 4 && bytes.readUInt32BE(0) === 0xcafebabe;
  if (
    hasJvmMagic &&
    fileSize > bytes.length &&
    fileSize <= MAX_JVM_CLASS_IDENTITY_BYTES
  ) {
    const complete = await readHandleRange(handle, 0, fileSize, signal);
    if (complete.byteLength === fileSize && isJvmClassFile(complete))
      return err("unsupported binary format");
  }
  const fatEvidence = await readFatSliceHeaderEvidence(
    handle,
    bytes,
    fileSize,
    signal,
  );
  if (
    hasJvmMagic &&
    fileSize > MAX_JVM_CLASS_IDENTITY_BYTES &&
    fatEvidence !== undefined &&
    classifyFatContainerIdentity(
      fatEvidence.header,
      (offset) => fatEvidence.sliceHeadersByOffset.get(offset)?.magic,
    ).state === "malformed"
  )
    return err(JVM_CLASS_IDENTITY_LIMIT_REASON);
  const parsed = parseExecutableHeader(
    bytes,
    hostArchitecture,
    fileSize,
    undefined,
    fatEvidence,
  );
  if (
    parsed.ok &&
    parsed.value.format === "mach-o-universal" &&
    fatEvidence !== undefined
  ) {
    for (const slice of fatEvidence.header.slices) {
      const framed = await readMachoSliceCommandFrames(handle, slice, signal);
      if (!framed.ok) return framed;
    }
  }
  return parsed;
};

/** ELF structure and family declarations share one descriptor before provider selection. */
const readElfMetadata = async (
  handle: FileHandle,
  bytes: Buffer,
  options: {
    readonly fileSize: number;
    readonly hostArchitecture: NodeJS.Architecture;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<ExecutableMetadata, ExecutableMetadataFailure>> => {
  const { fileSize, hostArchitecture, signal } = options;
  const parsed = parseExecutableHeader(bytes, hostArchitecture, fileSize);
  if (!parsed.ok || parsed.value.format !== "elf") return parsed;
  const ranges = await readElfDeclaredRanges(handle, bytes, fileSize, signal);
  if (!ranges.ok) return ranges;
  if (parsed.value.architecture !== "mips" || parsed.value.mips.elfClass !== 32)
    return parsed;
  const declarations = await readMipsElfMetadata(
    handle,
    parsed.value.mips,
    () => throwIfTargetResolutionCancelled(signal),
  );
  if (!declarations.ok) return declarations;
  return ok({
    ...parsed.value,
    mips: {
      ...parsed.value.mips,
      abiFlags: declarations.value.abiFlags,
      gnuAttributes: declarations.value.gnuAttributes,
      ...(declarations.value.sharedLoad === undefined
        ? {}
        : { sharedLoad: declarations.value.sharedLoad }),
      ...(declarations.value.limitations.length === 0
        ? {}
        : { limitations: declarations.value.limitations }),
    },
  });
};

/** Borrow the admitted descriptor; every request is at most one 64 KiB table chunk. */
const readElfDeclaredRanges = async (
  handle: FileHandle,
  prefix: Buffer,
  fileSize: number,
  signal?: AbortSignal,
): Promise<Result<null, string>> => {
  const ranges = validateElfDeclaredRanges(prefix, fileSize);
  let next = ranges.next();
  let window: Buffer | undefined;
  while (!next.done) {
    throwIfTargetResolutionCancelled(signal);
    const { offset, size } = next.value;
    let bytes: Buffer;
    if (offset + size <= prefix.length)
      bytes = prefix.subarray(offset, offset + size);
    else {
      window ??= Buffer.allocUnsafe(64 * 1024);
      bytes = window.subarray(0, size);
      let length = 0;
      while (length < size) {
        const read = await handle.read(
          bytes,
          length,
          size - length,
          offset + length,
        );
        throwIfTargetResolutionCancelled(signal);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      bytes = bytes.subarray(0, length);
    }
    next = ranges.next(bytes);
  }
  return next.value;
};

type ExecutableMetadataFailure =
  | string
  | {
      readonly reason: string;
      readonly diagnostics: Readonly<Record<string, JsonValue>>;
    };

const unresolvedMzHeaderFailure = (
  windowsHeader: Extract<MzWindowsHeaderObservation, { state: "candidate" }>,
  dos: Result<DosMzHeader, string>,
): Exclude<ExecutableMetadataFailure, string> => {
  return {
    reason: "MZ Windows new-header candidate is unresolved",
    diagnostics: {
      mz_windows_header: {
        state: windowsHeader.state,
        offset: windowsHeader.offset,
        signature: windowsHeader.signature,
      },
      mz_dos: dos.ok
        ? {
            state: "valid",
            header_bytes: dos.value.headerBytes,
            image_bytes: dos.value.imageBytes,
            module_bytes: dos.value.moduleBytes,
            overlay_bytes: dos.value.overlayBytes,
            relocation_count: dos.value.relocationCount,
            relocation_table_offset: dos.value.relocationTableOffset,
            entry_segment: dos.value.entrySegment,
            entry_offset: dos.value.entryOffset,
          }
        : { state: "invalid", reason: dos.error },
    },
  };
};

/** Establish a complete thin-command framing proof before provider admission. */
const readThinMachoMetadata = async (
  handle: FileHandle,
  prefix: Buffer,
  input: {
    readonly fileSize: number;
    readonly hostArchitecture: NodeJS.Architecture;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<ExecutableMetadata, string> | null> => {
  const table = readMachoLoadCommandTableHeader(prefix, input.fileSize);
  if (!table.ok) return table;
  if (table.value === null) return null;
  const parsed = parseExecutableHeader(
    prefix.subarray(0, table.value.headerSize),
    input.hostArchitecture,
    input.fileSize,
  );
  if (!parsed.ok) return parsed;
  const framed = await readMachoCommandFrames(handle, table.value, {
    prefix,
    fileSize: input.fileSize,
    signal: input.signal,
  });
  return framed.ok ? parsed : framed;
};

/** Walk thin command headers through one probe window, skipping payload bytes. */
const readMachoCommandFrames = async (
  handle: FileHandle,
  table: MachoLoadCommandTableHeader,
  input: {
    readonly prefix: Buffer;
    readonly fileSize: number;
    readonly fileOffset?: number | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<null, string>> => {
  const commands = new MachoLoadCommandCursor(table);
  let window = input.prefix;
  let windowOffset = 0;
  while (commands.nextOffset !== null) {
    const offset = table.headerSize + commands.nextOffset;
    if (
      offset + 8 <= input.fileSize &&
      (offset < windowOffset || offset + 8 > windowOffset + window.length)
    ) {
      window = Buffer.alloc(Math.min(4096, input.fileSize - offset));
      windowOffset = offset;
      const observed = await handle.read(
        window,
        0,
        window.length,
        (input.fileOffset ?? 0) + offset,
      );
      throwIfTargetResolutionCancelled(input.signal);
      window = window.subarray(0, observed.bytesRead);
    }
    const relative = offset - windowOffset;
    const frame = commands.read(
      relative >= 0 ? window.subarray(relative, relative + 8) : Buffer.alloc(0),
    );
    if (!frame.ok) return frame;
  }
  return commands.finish();
};

/** Validate declared FAT slices after the canonical table/identity admission succeeds. */
const readMachoSliceCommandFrames = async (
  handle: FileHandle,
  slice: UniversalMachOSlice,
  signal?: AbortSignal,
): Promise<Result<null, string>> => {
  const prefix = Buffer.alloc(Math.min(4096, slice.size));
  const observed = await handle.read(prefix, 0, prefix.length, slice.offset);
  throwIfTargetResolutionCancelled(signal);
  const bytes = prefix.subarray(0, observed.bytesRead);
  const table = readMachoLoadCommandTableHeader(bytes, slice.size);
  if (!table.ok) return table;
  if (table.value === null)
    return err("FAT slice does not identify a thin Mach-O image");
  return readMachoCommandFrames(handle, table.value, {
    prefix: bytes,
    fileSize: slice.size,
    fileOffset: slice.offset,
    signal,
  });
};

/** Read the validated FAT table and bounded thin-header identity prefixes. */
const readFatSliceHeaderEvidence = async (
  handle: FileHandle,
  prefix: Buffer,
  fileSize: number,
  signal?: AbortSignal,
): Promise<FatSliceHeaderEvidence | undefined> => {
  let header = readFatContainerHeader(prefix, fileSize);
  if (header.state === "needs-data") {
    // readFatContainerHeader enforces the 128-entry format bound before this
    // allocation; this is only the table, never a synthesized file image.
    const table = Buffer.alloc(header.requiredBytes);
    let bytesRead = 0;
    while (bytesRead < table.length) {
      throwIfTargetResolutionCancelled(signal);
      const read = await handle.read(
        table,
        bytesRead,
        table.length - bytesRead,
        bytesRead,
      );
      throwIfTargetResolutionCancelled(signal);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    header = readFatContainerHeader(table.subarray(0, bytesRead), fileSize);
  }
  if (header.state !== "parsed") return undefined;

  const sliceHeadersByOffset = new Map<number, MachoHeaderPrefixFacts>();
  for (let index = 0; index < header.slices.length; index += 1) {
    const slice = header.slices[index];
    if (slice === undefined) continue;
    if (header.rangeIssues[index] !== null) {
      sliceHeadersByOffset.set(
        slice.offset,
        readMachoHeaderPrefixFacts(Buffer.alloc(0)),
      );
      continue;
    }
    const observedLength = Math.min(12, slice.size);
    const thinHeader = Buffer.alloc(observedLength);
    let bytesRead = 0;
    while (bytesRead < thinHeader.length) {
      throwIfTargetResolutionCancelled(signal);
      const read = await handle.read(
        thinHeader,
        bytesRead,
        thinHeader.length - bytesRead,
        slice.offset + bytesRead,
      );
      throwIfTargetResolutionCancelled(signal);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    sliceHeadersByOffset.set(
      slice.offset,
      readMachoHeaderPrefixFacts(thinHeader.subarray(0, bytesRead)),
    );
  }
  return { header, sliceHeadersByOffset };
};

const readPeMetadata = async (
  handle: FileHandle,
  offset: number,
  mzPrefix: Buffer,
  fileSize: number,
  signal?: AbortSignal,
): Promise<Result<ExecutableMetadata, string>> => {
  throwIfTargetResolutionCancelled(signal);
  const fileHeader = Buffer.alloc(24);
  const fileHeaderRead = await handle.read(
    fileHeader,
    0,
    fileHeader.length,
    offset,
  );
  throwIfTargetResolutionCancelled(signal);
  if (fileHeaderRead.bytesRead !== fileHeader.length)
    return err("invalid or truncated PE header");
  const windowsHeader = observeMzWindowsHeader(mzPrefix, fileSize, {
    offset,
    bytes: fileHeader.subarray(0, 4),
  });
  if (windowsHeader.state !== "declared")
    return err("invalid Windows new-header signature in MZ image");
  if (["NE", "LE", "LX"].includes(windowsHeader.signature))
    return err(`unsupported ${windowsHeader.signature} executable in MZ image`);
  const optionalHeaderSize = fileHeader.readUInt16LE(20);
  if (optionalHeaderSize > 4096) return err("invalid PE optional header size");
  const numberOfSections = fileHeader.readUInt16LE(6);
  const record = Buffer.alloc(24 + optionalHeaderSize);
  const recordRead = await handle.read(record, 0, record.length, offset);
  throwIfTargetResolutionCancelled(signal);
  if (recordRead.bytesRead !== record.length)
    return err("invalid or truncated PE header");
  const codeView = await readPeCodeView(
    handle,
    offset,
    numberOfSections,
    record.subarray(24),
    optionalHeaderSize,
    signal,
  );
  return parsePeRecord(record, codeView);
};

const readPeCodeView = async (
  handle: FileHandle,
  peOffset: number,
  numberOfSections: number,
  optionalHeader: Buffer,
  optionalHeaderSize: number,
  signal?: AbortSignal,
): Promise<PeCodeViewRecord | undefined> => {
  throwIfTargetResolutionCancelled(signal);
  const debugDir = peDebugDirectoryEntry(optionalHeader);
  if (debugDir === undefined || numberOfSections > 96) return undefined;
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  const sectionTableSize = numberOfSections * 40;
  const sectionTable = Buffer.alloc(sectionTableSize);
  const sectionRead = await handle.read(
    sectionTable,
    0,
    sectionTableSize,
    sectionTableOffset,
  );
  throwIfTargetResolutionCancelled(signal);
  if (sectionRead.bytesRead !== sectionTableSize) return undefined;
  const debugFileOffset = peRvaToFileOffset(
    debugDir.debugRva,
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
    Math.min(debugDir.debugSize, 4096),
  );
  if (debugFileOffset === undefined) return undefined;
  const maxDebugSize = Math.min(debugDir.debugSize, 4096);
  const debugDirectoryBuffer = Buffer.alloc(maxDebugSize);
  const debugDirRead = await handle.read(
    debugDirectoryBuffer,
    0,
    maxDebugSize,
    debugFileOffset,
  );
  throwIfTargetResolutionCancelled(signal);
  const numEntries = Math.floor(debugDirRead.bytesRead / 28);
  for (let j = 0; j < numEntries; j++) {
    const entryOffset = j * 28;
    const type = debugDirectoryBuffer.readUInt32LE(entryOffset + 12);
    if (type !== 2) continue; // IMAGE_DEBUG_TYPE_CODEVIEW
    const sizeOfData = debugDirectoryBuffer.readUInt32LE(entryOffset + 16);
    let pointerToRawData = debugDirectoryBuffer.readUInt32LE(entryOffset + 24);
    if (pointerToRawData === 0) {
      const addressOfRawData = debugDirectoryBuffer.readUInt32LE(
        entryOffset + 20,
      );
      const mapped = peRvaToFileOffset(
        addressOfRawData,
        sectionTable,
        numberOfSections,
        debugDir.sizeOfHeaders,
        Math.min(sizeOfData, 4096),
      );
      if (mapped === undefined) continue;
      pointerToRawData = mapped;
    }
    if (sizeOfData < 16) continue;
    const maxCodeViewRead = Math.min(sizeOfData, 4096);
    const codeViewBuffer = Buffer.alloc(maxCodeViewRead);
    const codeViewRead = await handle.read(
      codeViewBuffer,
      0,
      maxCodeViewRead,
      pointerToRawData,
    );
    throwIfTargetResolutionCancelled(signal);
    const parsed = parseCodeViewData(
      codeViewBuffer.subarray(0, codeViewRead.bytesRead),
      sizeOfData,
    );
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};
