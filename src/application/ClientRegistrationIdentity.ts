import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { normalizeEntrypointPath } from "../process/CurrentEntrypointPath.js";
import { valid } from "semver";

import { PRODUCT_IDENTITY } from "../identity.js";

/** Package runners whose pinned launcher setup can register. */
export type PackageRunner = "npx" | "bunx";

/** Read one variable; Windows variable names are case-insensitive. */
const environmentValue = (
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  platform: NodeJS.Platform,
): string | undefined => {
  if (platform !== "win32") return environment[name];
  const target = name.toLowerCase();
  const key = Object.keys(environment).findLast(
    (candidate) => candidate.toLowerCase() === target,
  );
  return key === undefined ? undefined : environment[key];
};

/** Identify the package runner that launched this process, if any. */
export const invokingPackageRunner = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): PackageRunner | undefined => {
  if (environmentValue(environment, "npm_command", platform) !== "exec")
    return undefined;
  // `bunx` and `bun x` also report npm_command=exec, with a bun user agent.
  return environmentValue(
    environment,
    "npm_config_user_agent",
    platform,
  )?.startsWith("bun/") === true
    ? "bunx"
    : "npx";
};

/** Copy an environment without the variable that marks a package-runner launch. */
export const withoutPackageRunnerIdentity = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(environment).filter(([key]) =>
      platform === "win32"
        ? key.toLowerCase() !== "npm_command"
        : key !== "npm_command",
    ),
  );

/** Resolve a pinned package-runner launcher that stdio clients can spawn on the host. */
export const packageRunnerRegistrationCommand = (
  runner: PackageRunner,
  platform: NodeJS.Platform = process.platform,
): readonly string[] => {
  const command =
    runner === "npx"
      ? ["npx", "-y", PRODUCT_IDENTITY.registrationPackageSpecifier, "mcp"]
      : ["bunx", PRODUCT_IDENTITY.registrationPackageSpecifier, "mcp"];
  // Both runners may be .cmd shims on Windows, which clients cannot spawn directly.
  return platform === "win32" ? ["cmd.exe", "/d", "/c", ...command] : command;
};

/** Resolve a pinned npx launcher that stdio clients can spawn on the host. */
export const npxRegistrationCommand = (
  platform: NodeJS.Platform = process.platform,
): readonly string[] => packageRunnerRegistrationCommand("npx", platform);

const unwrapCmdCommand = (command: readonly string[]): readonly string[] => {
  const executable = command[0]?.toLowerCase();
  if (executable !== "cmd" && executable !== "cmd.exe") return command;
  if (command[1]?.toLowerCase() === "/c") return command.slice(2);
  if (command[1]?.toLowerCase() === "/d" && command[2]?.toLowerCase() === "/c")
    return command.slice(3);
  return [];
};

/** Preserve the package argument from a supported package-runner command. */
const clientRegistrationPackageReference = (
  command: readonly string[],
): string | undefined => {
  const arguments_ = unwrapCmdCommand(command);
  if (
    arguments_.length === 4 &&
    arguments_[0] === "npx" &&
    arguments_[1] === "-y" &&
    arguments_[3] === "mcp"
  )
    return arguments_[2];
  if (
    arguments_.length === 3 &&
    arguments_[0] === "bunx" &&
    arguments_[2] === "mcp"
  )
    return arguments_[1];
  return undefined;
};

/** Check that one parsed command points to REA's MCP entry point. */
export type ClientRegistrationCommandIdentity = "owned" | "foreign" | "unknown";

/** Compare entrypoint paths without turning failed resolution into a foreign identity. */
const entrypointIdentity = (
  candidate: string,
  current: string,
): ClientRegistrationCommandIdentity => {
  if (!isAbsolute(candidate) || !isAbsolute(current)) return "unknown";
  if (candidate === current) return "owned";
  try {
    return realpathSync.native(candidate) === realpathSync.native(current)
      ? "owned"
      : "foreign";
  } catch {
    return "unknown";
  }
};

/** A direct launcher may be a native executable or a Node shebang script. */
const directEntrypointIdentity = (
  candidate: string,
  current: string,
): ClientRegistrationCommandIdentity => {
  const nativeIdentity = entrypointIdentity(candidate, current);
  const scriptPath = normalizeEntrypointPath(candidate);
  if (scriptPath === candidate) return nativeIdentity;
  // A shebang can pass the original spelling to Node, which selects its script
  // lexically. Without executing the launcher, divergent interpretations are unknown.
  return scriptPath !== undefined &&
    entrypointIdentity(scriptPath, current) === nativeIdentity
    ? nativeIdentity
    : "unknown";
};

/** Prefer an executable PATH alias that proves the same selected REA file. */
export const registrationEntrypointPath = (
  entrypoint: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
): string => {
  // A Windows command shim is a different program; file identity cannot prove
  // its script target. Keep that platform's existing Node/script registration.
  if (platform === "win32") return entrypoint;
  for (const directory of (environment.PATH ?? "").split(":")) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, PRODUCT_IDENTITY.cliBinary);
    if (directEntrypointIdentity(candidate, entrypoint) !== "owned") continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // An unexecutable alias cannot launch the selected program.
    }
  }
  return entrypoint;
};

/** Preserve caller spelling only when both direct launchers prove the same file. */
export const equivalentClientRegistrationCommands = (
  previous: readonly string[],
  requested: readonly string[],
): boolean => {
  if (
    previous.length === requested.length &&
    previous.every((value, index) => value === requested[index])
  )
    return true;
  const current = inspectClientRegistrationCommand(
    requested,
    undefined,
  ).entrypoint;
  if (current === undefined) return false;
  const prior = inspectClientRegistrationCommand(previous, current);
  return prior.entrypoint !== undefined && prior.identity === "owned";
};

export interface ClientRegistrationCommandFacts {
  readonly identity: ClientRegistrationCommandIdentity;
  /** Selected absolute launcher/script path; excludes package and unresolved PATH commands. */
  readonly entrypoint: string | undefined;
  readonly package:
    | {
        readonly reference: string;
        readonly exactVersion: string | undefined;
      }
    | undefined;
}

/** Parse package identity once, retaining exact source spelling and version facts. */
export const inspectClientRegistrationCommand = (
  command: readonly string[],
  currentCommandPath: string | undefined,
): ClientRegistrationCommandFacts => {
  const reference = clientRegistrationPackageReference(command);
  if (reference !== undefined) {
    const prefix = `${PRODUCT_IDENTITY.packageName}@`;
    const version = reference.startsWith(prefix)
      ? reference.slice(prefix.length)
      : undefined;
    const normalized = version === undefined ? null : valid(version);
    const owned =
      reference === PRODUCT_IDENTITY.packageName ||
      reference === PRODUCT_IDENTITY.packageSpecifier ||
      reference === PRODUCT_IDENTITY.registrationPackageSpecifier ||
      normalized !== null;
    return {
      identity: owned ? "owned" : "foreign",
      entrypoint: undefined,
      package: {
        reference,
        exactVersion: normalized === version ? version : undefined,
      },
    };
  }
  return inspectDirectRegistrationCommand(command, currentCommandPath);
};

/** Ownership-only consumers share the same parsed command facts. */
export const classifyClientRegistrationCommand = (
  command: readonly string[],
  currentCommandPath: string | undefined,
): ClientRegistrationCommandIdentity =>
  inspectClientRegistrationCommand(command, currentCommandPath).identity;

const inspectDirectRegistrationCommand = (
  command: readonly string[],
  currentCommandPath: string | undefined,
): ClientRegistrationCommandFacts => {
  const currentPathAvailable =
    currentCommandPath !== undefined && currentCommandPath.length > 0;
  if (command.length === 3 && command[2] === "mcp") {
    const interpreter = command[0] ?? "";
    const entrypoint = command[1] ?? "";
    if (!isAbsolute(interpreter) || !isAbsolute(entrypoint))
      return { identity: "unknown", entrypoint: undefined, package: undefined };
    const interpreterIdentity = entrypointIdentity(
      interpreter,
      process.execPath,
    );
    if (interpreterIdentity !== "owned")
      return {
        identity: currentPathAvailable ? interpreterIdentity : "unknown",
        entrypoint: undefined,
        package: undefined,
      };
    // Node selects its script from normalized argv; executable paths use native
    // traversal semantics, where symlink/.. can denote a different file.
    const selectedEntrypoint = normalizeEntrypointPath(entrypoint);
    return {
      identity:
        selectedEntrypoint === undefined || !currentPathAvailable
          ? "unknown"
          : entrypointIdentity(selectedEntrypoint, currentCommandPath),
      entrypoint: selectedEntrypoint,
      package: undefined,
    };
  }
  if (command.length === 2 && command[1] === "mcp") {
    const executable = command[0] ?? "";
    if (executable === PRODUCT_IDENTITY.cliBinary)
      return { identity: "owned", entrypoint: undefined, package: undefined };
    if (isAbsolute(executable))
      return {
        identity: currentPathAvailable
          ? directEntrypointIdentity(executable, currentCommandPath)
          : "unknown",
        entrypoint: executable,
        package: undefined,
      };
    if (/[./\\]/u.test(executable))
      return { identity: "unknown", entrypoint: undefined, package: undefined };
  }
  return { identity: "foreign", entrypoint: undefined, package: undefined };
};
