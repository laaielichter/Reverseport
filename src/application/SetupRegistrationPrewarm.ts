import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";

import { cleanupWindowsProcessTree } from "../process/ProcessOwnership.js";
import { inspectClientRegistrationCommand } from "./ClientRegistrationIdentity.js";

/**
 * Best-effort outcome of materializing the pinned package-runner cache entry.
 * A failure never blocks setup; the first client start then performs the
 * one-time install inside its own startup deadline.
 */
export type SetupRegistrationPrewarm =
  | { readonly status: "skipped"; readonly reason: "direct_launcher" }
  | { readonly status: "warmed" }
  | { readonly status: "failed"; readonly reason: string };

/** One cold package install at setup time; client startup deadlines stay untouched. */
const PREWARM_TIMEOUT_MS = 180_000;
const PREWARM_CAPTURE_LIMIT = 64 * 1024;
const PREWARM_REASON_LIMIT = 300;

/** Facts of one supervised package-runner launch. */
export interface RegistrationRunnerLaunch {
  readonly exitCode: string | number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
  /** Terminal interrupt that was forwarded to the runner tree, if any. */
  readonly interruptedSignal?: string;
}

/** Launch shape shared with the supervised spawn so tests can observe it. */
export type RegistrationRunnerLauncher = (
  command: string,
  arguments_: readonly string[],
  options: {
    readonly env: Readonly<NodeJS.ProcessEnv>;
    /** Neutral directory; inside a REA source checkout the package runner
     * would resolve the local project instead of the published entry. */
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly platform: NodeJS.Platform;
  },
) => Promise<RegistrationRunnerLaunch>;

/**
 * Resolve the cache-materializing variant of a registration command. The
 * package-runner cache entry is keyed by the requested spec, so a terminating
 * subcommand with the same spec warms the entry the client will launch.
 * Direct launchers keep no package-runner cache; they return undefined.
 */
export const registrationPrewarmCommand = (
  command: readonly string[],
): readonly string[] | undefined => {
  if (
    command.length === 0 ||
    command[command.length - 1] !== "mcp" ||
    inspectClientRegistrationCommand(command, undefined).package === undefined
  )
    return undefined;
  return [...command.slice(0, -1), "--version"];
};

/** Materialize the pinned package-runner cache entry once, best-effort. */
export const materializeRegistrationRunnerCache = async (
  command: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  launchCommand: RegistrationRunnerLauncher = launchRegistrationRunnerCommand,
): Promise<SetupRegistrationPrewarm> => {
  const prewarm = registrationPrewarmCommand(command);
  if (prewarm === undefined)
    return { status: "skipped", reason: "direct_launcher" };
  const launch = await launchCommand(prewarm[0] ?? "", prewarm.slice(1), {
    env: environment,
    cwd: tmpdir(),
    timeoutMs: PREWARM_TIMEOUT_MS,
    platform: process.platform,
  });
  return launch.timedOut ||
    launch.spawnError !== undefined ||
    launch.interruptedSignal !== undefined ||
    launch.exitCode !== 0
    ? { status: "failed", reason: prewarmFailureReason(launch) }
    : { status: "warmed" };
};

/**
 * Stop the whole runner tree: killing only the direct child leaves npm, which
 * inherited the output pipes, holding them open past the deadline.
 */
const stopRunnerTree = (
  child: ChildProcess,
  platform: NodeJS.Platform,
): Promise<void> => {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  if (platform === "win32")
    return cleanupWindowsProcessTree(pid).then(() => undefined);
  return new Promise((resolve) => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group may already be gone.
    }
    resolve();
  });
};

export const launchRegistrationRunnerCommand: RegistrationRunnerLauncher = (
  command,
  arguments_,
  options,
) =>
  new Promise((resolve) => {
    const child = spawn(command, [...arguments_], {
      env: options.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // POSIX runs the runner in its own group so one signal stops the tree;
      // an interrupt must therefore be forwarded below, because the detached
      // group no longer receives the terminal's signal.
      ...(options.platform === "win32" ? {} : { detached: true }),
    });
    const stdout = boundedStream(child.stdout);
    const stderr = boundedStream(child.stderr);
    let timedOut = false;
    let spawnError: string | undefined;
    let interruptedSignal: string | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopRunnerTree(child, options.platform).finally(() => {
        child.kill("SIGKILL");
      });
    }, options.timeoutMs);
    const detachSignalForwarding = () => {
      for (const [signal, handler] of signalHandlers)
        process.removeListener(signal, handler);
    };
    const signalHandlers = new Map<NodeJS.Signals, () => void>(
      FORWARD_SIGNALS.map((signal) => [
        signal,
        () => {
          if (interruptedSignal !== undefined) return;
          interruptedSignal = signal;
          clearTimeout(timer);
          void stopRunnerTree(child, options.platform).finally(() => {
            child.kill("SIGKILL");
            detachSignalForwarding();
            // Restore default termination for the interrupt that arrived.
            process.kill(process.pid, signal);
          });
        },
      ]),
    );
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      detachSignalForwarding();
      resolve({
        exitCode: code ?? signal,
        signal: signal ?? null,
        stdout: stdout(),
        stderr: stderr(),
        timedOut,
        ...(spawnError === undefined ? {} : { spawnError }),
        ...(interruptedSignal === undefined ? {} : { interruptedSignal }),
      });
    });
  });

/** Terminal interrupts that must also stop a detached package-runner tree. */
const FORWARD_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

const boundedStream = (
  stream: NodeJS.ReadableStream | null,
): (() => string) => {
  let captured = "";
  stream?.on("data", (chunk: Buffer) => {
    if (captured.length < PREWARM_CAPTURE_LIMIT)
      captured += chunk.toString("utf8").slice(0, PREWARM_CAPTURE_LIMIT);
  });
  return () => captured;
};

const prewarmFailureReason = (launch: RegistrationRunnerLaunch): string => {
  const observed =
    launch.spawnError !== undefined
      ? launch.spawnError
      : launch.interruptedSignal !== undefined
        ? `the package runner was stopped by ${launch.interruptedSignal}`
        : launch.timedOut
          ? `the package runner timed out after the bounded prewarm window`
          : `exit ${launch.exitCode === null ? "unknown" : String(launch.exitCode)}${
              launch.stderr.trim() === "" ? "" : `: ${launch.stderr.trim()}`
            }`;
  const normalized = observed
    .replace(/\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\([0-9A-Za-z]|[@-Z\\^_])/gu, "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return `The pinned package-runner entry could not be materialized before the first client start (${normalized.slice(0, PREWARM_REASON_LIMIT)}); the first client start will install it inside its startup deadline.`;
};
