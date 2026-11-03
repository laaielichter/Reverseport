import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { readClientPolicyBlock } from "./GeminiClientSettings.js";
import { readEffectiveClientRegistrationConfiguration } from "./ClientConfigurationFiles.js";
import {
  clientServerForcedEnabled,
  clientServerListedDisabled,
  effectiveClientServer,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import { lstat, stat } from "node:fs/promises";
import { err, ok, type Result } from "../domain/result.js";
import { isAbsolute } from "node:path";

import { PRODUCT_IDENTITY } from "../identity.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";
import {
  MCP_STARTUP_POLICY,
  mcpProviderDeadlineAllowanceMs,
  recommendedMcpToolTimeoutMs,
  recommendedMcpToolTimeoutSeconds,
  type McpToolTimeoutInputs,
} from "../mcpStartupPolicy.js";
import {
  classifyClientRegistration,
  inspectClientRegistrationCommand,
  type ClientRegistrationCommandFacts,
  type ClientRegistrationCommandIdentity,
  packageRunnerRegistrationCommand,
} from "./ClientRegistrationIdentity.js";
import {
  clientEvidencePaths,
  clientOwnershipEvidencePaths,
  manualRegistrationRemediation,
  supportedClients,
} from "./SupportedClients.js";
import type { SetupClient } from "./SupportedClients.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { dshDocument } from "./DshCordisPatch.js";
import { clientRegistrationEnvironmentDetailsWithBudget } from "./ClientRegistrationEnvironment.js";
import type { ProviderRequestBudgetResolver } from "./ClientRegistrationEnvironment.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

import {
  parseClientRegistration,
  setupPreservesDisabledActivation,
  type ClientRegistration,
} from "./ClientRegistration.js";

interface ClientRegistrationStatusBase {
  readonly client: string;
  readonly config_path: string;
  /** Exact package reference requested by npx/bunx, when registration uses one. */
  readonly package_reference?: string;
  /** Non-blocking timeout guidance; caller-selected values remain aligned. */
  readonly advisory?: string;
  /**
   * The server name this status describes, present only when it is a previous
   * REA name rather than PRODUCT_IDENTITY.mcpServerKey.
   */
  readonly server_key?: string;
  /** Non-blocking report of entries under previous REA server names. */
  readonly server_key_advisory?: string;
}

type RegistrationCommand = readonly [string, ...string[]];

export type ClientRegistrationStatus = ClientRegistrationStatusBase &
  (
    | {
        readonly command: RegistrationCommand;
        readonly state: "aligned";
        readonly remediation: null;
      }
    | {
        readonly command: RegistrationCommand;
        readonly state: "stale";
        readonly remediation: string;
      }
    | {
        readonly command: RegistrationCommand;
        readonly state: "unknown";
        readonly remediation: string;
      }
    | {
        readonly command: readonly [];
        readonly state: "missing" | "invalid" | "manual";
        readonly remediation: string;
      }
  );

export type UnhealthyClientRegistrationStatus = Exclude<
  ClientRegistrationStatus,
  { readonly state: "aligned" }
>;

/** Diagnostic detail: the path, and the server name when it is a previous one. */
export const registrationDetail = (status: ClientRegistrationStatus): string =>
  status.server_key === undefined
    ? status.config_path
    : `${status.config_path} (server "${status.server_key}")`;

interface ClientRegistrationReadOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly resources?: ArtifactResourceScope;
  readonly selectedClientIds?: readonly string[];
  /**
   * Which evidence authorises inspection. `readiness` inspects a client whose
   * product applicability is established, plus clients the caller selected
   * explicitly. `ownership` also inspects shared registration storage, because
   * a version-pinned registration REA wrote must be refreshed even when the
   * product profile is absent.
   */
  readonly evidence?: "readiness" | "ownership";
  readonly resolveProviderRequestBudget?: ProviderRequestBudgetResolver;
}

/** Registration facts shared by diagnostics and update maintenance. */
export interface ClientRegistrationInspection {
  readonly status: ClientRegistrationStatus;
  readonly activation: "enabled" | "disabled" | "unknown";
  /** Ownership remains unknown until this inspection has parsed the launcher. */
  readonly commandIdentity: ClientRegistrationCommandIdentity;
}

/** Project diagnostics from the same inspection used to select maintenance. */
export const readClientRegistrationStatuses = async (
  home: string,
  currentCommandPath: string | undefined = CURRENT_ENTRYPOINT_PATH,
  options: ClientRegistrationReadOptions = {},
): Promise<readonly ClientRegistrationStatus[]> =>
  (
    await readClientRegistrationInspections(home, currentCommandPath, options)
  ).map(({ status }) => status);

/** Parse effective registrations and their client-specific activation once.
 * A supplied scope retains failed cleanup; otherwise transfer its exact failure.
 */
export const readClientRegistrationInspections = async (
  home: string,
  currentCommandPath: string | undefined = CURRENT_ENTRYPOINT_PATH,
  options: ClientRegistrationReadOptions = {},
): Promise<readonly ClientRegistrationInspection[]> => {
  const inspections: ClientRegistrationInspection[] = [];
  const record = (
    status: ClientRegistrationStatus,
    activation: ClientRegistrationInspection["activation"] = "unknown",
    commandIdentity: ClientRegistrationCommandIdentity = "unknown",
  ): void => {
    inspections.push({ status, activation, commandIdentity });
  };
  for (const client of supportedClients(
    home,
    options.platform,
    options.environment,
  )) {
    const selected = options.selectedClientIds?.includes(client.name) === true;
    if (client.configPathError !== undefined) {
      record({
        client: client.name,
        config_path: client.configPath,
        command: [],
        state: "invalid",
        remediation: client.configPathError,
      });
      continue;
    }
    const presence = await clientEvidencePresent(client, {
      selected,
      ownership: options.evidence === "ownership",
    });
    if (!presence.ok) {
      record({
        client: client.name,
        config_path: presence.error.path,
        command: [],
        state: "invalid",
        remediation: presence.error.detail,
      });
      continue;
    }
    if (!presence.value) continue;
    const manualRemediation = manualRegistrationRemediation(client.name);
    if (client.format === "unsupported") {
      if (manualRemediation !== undefined)
        record({
          client: client.name,
          config_path: client.markerPath ?? client.configPath,
          command: [],
          state: "manual",
          remediation: manualRemediation,
        });
      continue;
    }
    let selectedConfigPath = client.configPath;
    try {
      const configuration = await readEffectiveClientRegistrationConfiguration(
        client,
        options.resources,
        options.platform,
      );
      if (!configuration.ok) {
        if (
          options.resources === undefined &&
          configuration.error.cleanupFailure !== undefined
        )
          throw configuration.error.cleanupFailure;
        record({
          client: client.name,
          config_path: configuration.error.path,
          command: [],
          state: "invalid",
          remediation: configuration.error.detail,
        });
        continue;
      }
      const { document: parsed, configPath } = configuration.value;
      selectedConfigPath = configPath;
      if (parsed === undefined) {
        record(unavailableStatus(client, "missing", configPath));
        continue;
      }
      const policy = await readClientPolicyBlock(
        client,
        parsed,
        undefined,
        options.resources,
      );
      if (!policy.ok) {
        if (
          options.resources === undefined &&
          policy.error.cleanupFailure !== undefined
        )
          throw policy.error.cleanupFailure;
        record({
          client: client.name,
          config_path: configPath,
          command: [],
          state: "invalid",
          remediation: policy.error.detail,
        });
        continue;
      }
      const policyBlock = policy.value;
      const effectiveClient: SetupClient =
        parsed.dialect === "zcode_fallback"
          ? {
              ...client,
              configPath,
              configPaths: [configPath],
              format: "zcode_fallback",
            }
          : client;
      const evaluate = (
        serverKey: string,
        raw: unknown,
      ): Promise<ClientRegistrationInspection> =>
        inspectRegistrationEntry({
          client,
          effectiveClient,
          parsed,
          configPath,
          serverKey,
          raw,
          policyBlock,
          currentCommandPath,
          options,
        });
      const current = PRODUCT_IDENTITY.mcpServerKey;
      const raw = effectiveClientServer(parsed, current);
      const previous = previousRegistrations(
        parsed,
        client,
        effectiveClient,
        currentCommandPath,
      );
      if (raw === undefined) {
        const editabilityError =
          parsed.dialect === "dsh"
            ? dshDocument(parsed.document).editabilityError
            : undefined;
        if (editabilityError !== undefined) {
          record({
            client: client.name,
            config_path: configPath,
            command: [],
            state: "invalid",
            remediation: editabilityError.message,
          });
          continue;
        }
        // Setup migrates an owned previous-name entry, so it is REA's stale
        // registration; an unresolved one stays unknown, and a foreign one
        // leaves REA missing.
        const candidate =
          previous.find(({ identity }) => identity === "owned") ??
          previous.find(({ identity }) => identity === "unknown");
        if (candidate === undefined) {
          record(
            withServerKeyAdvisory(
              unavailableStatus(client, "missing", configPath),
              [previousServerKeyAdvisory(previous, configPath)],
            ),
          );
          continue;
        }
        const inspection = await evaluate(candidate.name, candidate.raw);
        inspections.push({
          ...inspection,
          status: previousServerKeyStatus(
            inspection.status,
            candidate,
            effectiveClient,
          ),
        });
        continue;
      }
      const inspection = await evaluate(current, raw);
      const duplicate = previous.find(
        ({ identity, activation }) =>
          identity === "owned" && activation === "enabled",
      );
      const advisory = previousServerKeyAdvisory(
        previous.filter((entry) => entry !== duplicate),
        configPath,
      );
      const status = withServerKeyAdvisory(
        duplicate !== undefined && inspection.status.state === "aligned"
          ? {
              client: inspection.status.client,
              config_path: inspection.status.config_path,
              command: inspection.status.command,
              ...(inspection.status.package_reference === undefined
                ? {}
                : { package_reference: inspection.status.package_reference }),
              state: "stale",
              remediation: duplicateRemediation(
                duplicate.name,
                effectiveClient,
              ),
            }
          : inspection.status,
        duplicate !== undefined && inspection.status.state !== "aligned"
          ? [duplicateAdvisory(duplicate.name), advisory]
          : [advisory],
      );
      inspections.push({ ...inspection, status });
    } catch (cause: unknown) {
      if (
        options.resources === undefined &&
        cause instanceof RegularFileCleanupFailure
      )
        throw cause;
      record(
        unavailableStatus(
          client,
          isMissing(cause) ? "missing" : "invalid",
          selectedConfigPath,
        ),
      );
    }
  }
  return inspections.sort((left, right) =>
    compareUnicodeCodePoints(left.status.client, right.status.client),
  );
};

/** Evaluate the entry under `serverKey` against what setup would write. */
const inspectRegistrationEntry = async ({
  client,
  effectiveClient,
  parsed,
  configPath,
  serverKey,
  raw,
  policyBlock,
  currentCommandPath,
  options,
}: {
  readonly client: SetupClient;
  readonly effectiveClient: SetupClient;
  readonly parsed: ClientConfigurationDocument;
  readonly configPath: string;
  readonly serverKey: string;
  readonly raw: unknown;
  readonly policyBlock: string | undefined;
  readonly currentCommandPath: string | undefined;
  readonly options: ClientRegistrationReadOptions;
}): Promise<ClientRegistrationInspection> => {
  const invalid = (remediation: string): ClientRegistrationInspection => ({
    status: {
      client: client.name,
      config_path: configPath,
      command: [],
      state: "invalid",
      remediation,
    },
    activation: "unknown",
    commandIdentity: "unknown",
  });
  const parsedRegistration = parseClientRegistration(raw, effectiveClient);
  if (!parsedRegistration.ok)
    return invalid(
      `${parsedRegistration.error.message}: ${parsedRegistration.error.settings.map(({ setting, constraint }) => `${setting}: ${constraint}`).join("; ")}`,
    );
  const registration = parsedRegistration.value;
  const registrationEnvironment =
    client.name === "kimi" || client.name === "codex"
      ? await clientRegistrationEnvironmentDetailsWithBudget(
          parsed,
          {},
          "effective",
          options.resolveProviderRequestBudget,
          options.platform,
          serverKey,
        )
      : undefined;
  if (registrationEnvironment !== undefined && !registrationEnvironment.ok)
    return invalid(registrationEnvironment.error.message);
  const command: RegistrationCommand = [
    registration.command,
    ...registration.args,
  ];
  const commandFacts = inspectClientRegistrationCommand(
    command,
    currentCommandPath,
  );
  const packageReference = commandFacts.package?.reference;
  const activation = registrationActivation(
    registration,
    client,
    parsed,
    serverKey,
  );
  const packageVersion = commandFacts.package?.exactVersion;
  const packageVersionDrift =
    packageVersion !== undefined &&
    packageVersion !== PRODUCT_IDENTITY.packageVersion;
  const alignment = registrationAligned({
    registration,
    client: effectiveClient,
    command,
    commandFacts,
    platform: options.platform ?? process.platform,
    kimiInputSchemaProfileSelected:
      registrationEnvironment?.ok === true &&
      snapshotEnvironment(
        registrationEnvironment.value.values,
        options.platform,
      ).REA_MCP_INPUT_SCHEMA_PROFILE !== undefined,
  });
  return {
    status: configuredStatus(
      effectiveClient,
      command,
      alignment === "unknown"
        ? "unknown"
        : activation === "enabled" &&
            !packageVersionDrift &&
            alignment === "aligned" &&
            (parsed.dialect !== "dsh" || dshDocument(parsed.document).ready) &&
            policyBlock === undefined
          ? "aligned"
          : "stale",
      policyBlock ??
        (packageVersionDrift
          ? packageVersionRemediation(packageReference ?? "", client)
          : alignment === "unknown"
            ? unknownEntryPointRemediation()
            : undefined) ??
        // Only a target whose setup preserves the flag is a manual
        // conflict; a native row (for example ZCode's own storage) is
        // still repaired by its setup run below.
        (activation === "disabled" &&
        registration.enable === false &&
        setupPreservesDisabledActivation(
          effectiveClient,
          effectiveClient.format,
        )
          ? sharedDisabledActivationRemediation()
          : undefined),
      packageReference,
      registrationEnvironment?.ok === true
        ? timeoutAdvisory(
            client,
            registration,
            registrationEnvironment.value.timeoutInputs,
          )
        : undefined,
    ),
    activation,
    commandIdentity: commandFacts.identity,
  };
};

/** An entry under a previous REA server name, with setup's ownership proof. */
interface PreviousRegistration {
  readonly name: string;
  readonly raw: unknown;
  readonly identity: ClientRegistrationCommandIdentity;
  readonly activation: "enabled" | "disabled" | "unknown";
}

/**
 * Entries under previous REA server names. Ownership uses the proof setup and
 * uninstall share, so status calls an entry REA's exactly when setup would
 * migrate it. The Harness row is owned by its entry id, not by its name.
 */
const previousRegistrations = (
  parsed: ClientConfigurationDocument,
  client: SetupClient,
  effectiveClient: SetupClient,
  currentCommandPath: string | undefined,
): readonly PreviousRegistration[] => {
  if (parsed.dialect === "dsh") return [];
  const entries: PreviousRegistration[] = [];
  for (const name of PRODUCT_IDENTITY.previousMcpServerKeys) {
    const raw = effectiveClientServer(parsed, name);
    if (raw === undefined) continue;
    const registration = parseClientRegistration(raw, effectiveClient);
    entries.push({
      name,
      raw,
      identity: classifyClientRegistration(
        raw,
        effectiveClient,
        currentCommandPath,
      ),
      activation: registration.ok
        ? registrationActivation(registration.value, client, parsed, name)
        : "unknown",
    });
  }
  return entries;
};

/** Report an owned or unresolved previous-name entry under its own key. */
const previousServerKeyStatus = (
  status: ClientRegistrationStatus,
  previous: PreviousRegistration,
  client: SetupClient,
): ClientRegistrationStatus => {
  const current = PRODUCT_IDENTITY.mcpServerKey;
  if (status.state === "aligned" || status.state === "stale")
    return previous.identity === "owned"
      ? {
          client: status.client,
          config_path: status.config_path,
          command: status.command,
          ...(status.package_reference === undefined
            ? {}
            : { package_reference: status.package_reference }),
          server_key: previous.name,
          state: "stale",
          remediation: `REA is registered under its previous server name "${previous.name}". reverseport setup renames it to "${current}". ${remediation(client)}`,
        }
      : { ...status, server_key: previous.name };
  return { ...status, server_key: previous.name };
};

/** Name previous-name entries setup keeps, which the client still loads. */
const previousServerKeyAdvisory = (
  previous: readonly PreviousRegistration[],
  configPath: string,
): string | undefined => {
  const current = PRODUCT_IDENTITY.mcpServerKey;
  const lines = previous.map(({ name, identity }) =>
    identity === "owned"
      ? `An REA-owned registration under the previous server name "${name}" is not enabled in ${configPath}; reverseport setup removes it when it registers "${current}".`
      : `${configPath} registers a server under REA's previous name "${name}" that reverseport setup keeps unchanged: ${
          identity === "foreign"
            ? "its launcher is not REA's"
            : "REA cannot confirm its launcher"
        }. REA registers as "${current}". If "${name}" is an older REA registration, remove it yourself; otherwise the client loads REA under both names.`,
  );
  return lines.length === 0 ? undefined : lines.join(" ");
};

const duplicateAdvisory = (name: string): string =>
  `An REA-owned registration under the previous server name "${name}" is also enabled, so the client loads REA under both names; reverseport setup removes "${name}".`;

const duplicateRemediation = (name: string, client: SetupClient): string =>
  `${duplicateAdvisory(name)} ${remediation(client)}`;

const withServerKeyAdvisory = (
  status: ClientRegistrationStatus,
  advisories: readonly (string | undefined)[],
): ClientRegistrationStatus => {
  const text = advisories.filter((line) => line !== undefined).join(" ");
  return text.length === 0 ? status : { ...status, server_key_advisory: text };
};

/** Shared registration storage doubles as ZCode's fallback, so its
 * `enable: false` activation fact binds every reader of that storage.
 * Maintenance must not drop the flag by rewriting the row as another
 * product's registration and silently re-enabling it; whether a repair
 * actually preserves it is setupPreservesDisabledActivation. */
const sharedEnableFlagBinds = (
  registration: ClientRegistration,
  client: SetupClient,
  parsed: ClientConfigurationDocument,
): boolean =>
  (parsed.dialect === "zcode" ||
    parsed.dialect === "zcode_fallback" ||
    client.sharedRegistration === true) &&
  registration.enable === false;

/** A disable that setup preserves is a manual conflict: its remediation
 * must not point at an ineffective setup run. */
const sharedDisabledActivationRemediation = (): string =>
  "This shared registration row carries enable: false, which binds every reader of the shared storage, including ZCode's fallback view. REA preserves that flag, so reverseport setup will not change this row. Re-enable it with the product that disabled it, or remove enable: false manually, then rerun reverseport doctor.";
// Codex and Kimi Code load a server marked `disabled: true` and honor only
// `enabled`; Devin loads one marked `enabled: false` and honors only `disabled`.
const ignoresDisabledKey = new Set(["codex", "kimi"]);
const ignoresEnabledKey = new Set(["devin"]);

const registrationActivation = (
  registration: ClientRegistration,
  client: SetupClient,
  parsed: ClientConfigurationDocument,
  serverKey: string = PRODUCT_IDENTITY.mcpServerKey,
): "enabled" | "disabled" =>
  (client.format !== "grok" &&
    !ignoresDisabledKey.has(client.name) &&
    registration.disabled === true) ||
  (registration.enabled === false &&
    !ignoresEnabledKey.has(client.name) &&
    !clientServerForcedEnabled(parsed, serverKey)) ||
  sharedEnableFlagBinds(registration, client, parsed) ||
  clientServerListedDisabled(parsed, serverKey)
    ? "disabled"
    : "enabled";

const registrationAligned = ({
  registration,
  client,
  command,
  commandFacts,
  platform,
  kimiInputSchemaProfileSelected,
}: {
  readonly registration: ClientRegistration;
  readonly client: SetupClient;
  readonly command: readonly string[];
  readonly commandFacts: ClientRegistrationCommandFacts;
  readonly platform: NodeJS.Platform;
  readonly kimiInputSchemaProfileSelected: boolean;
}): "aligned" | "stale" | "unknown" => {
  const { identity } = commandFacts;
  if (identity === "unknown") return "unknown";
  if (identity === "foreign") return "stale";
  if (
    client.name === "grok_build" &&
    registration.startup_timeout_sec !==
      MCP_STARTUP_POLICY.codexStartupTimeoutSeconds
  )
    return "stale";
  if (
    client.name === "codex" &&
    (registration.startup_timeout_sec === undefined ||
      registration.tool_timeout_sec === undefined)
  )
    return "stale";
  if (
    client.name === "kimi" &&
    (registration.startupTimeoutMs === undefined ||
      registration.toolTimeoutMs === undefined)
  )
    return "stale";
  if (client.name === "kimi" && !kimiInputSchemaProfileSelected) return "stale";
  // A Harness row is owned by its entry id (`rea-mcp`), but the session
  // connects under `serverName`, which must be the current server name
  // (`reverseport`) over stdio. A row that still says `rea`, or any other
  // name or transport, is stale and setup rewrites it.
  if (
    client.format === "dsh" &&
    (registration.serverName !== PRODUCT_IDENTITY.mcpServerKey ||
      registration.transport !== "stdio")
  )
    return "stale";
  if (
    (["npx", "bunx"] as const).some((runner) => {
      const expected = packageRunnerRegistrationCommand(runner, platform);
      return (
        command.length === expected.length &&
        command.every((argument, index) => argument === expected[index])
      );
    })
  )
    return "aligned";
  // Other owned package references remain stale until pinned to this version.
  if (commandFacts.package !== undefined) return "stale";
  // The identity owner already established an exact direct launcher match.
  // A bare command still depends on the client's PATH, so cannot prove alignment.
  return isAbsolute(command[0] ?? "") ? "aligned" : "stale";
};

/** A client that rewrites its file from memory must be quit before setup. */
const remediation = (client: SetupClient): string => {
  if (client.quitBeforeSetup !== true)
    return "Run reverseport setup to refresh this registration, then restart the client.";
  const name = client.displayName ?? client.name;
  return `Quit ${name} fully, run reverseport setup to refresh this registration, then start ${name} again. A running ${name} can rewrite its configuration from memory and drop the registration.`;
};

const unknownEntryPointRemediation = (): string =>
  "The existing registration was retained because its executable identity cannot be verified. Check the registered launcher path, symlink targets and access permissions. Run the installed REA CLI or a supported package runner, then rerun reverseport doctor; no registration was changed.";

const configuredStatus = (
  client: SetupClient,
  command: RegistrationCommand,
  state: "aligned" | "stale" | "unknown",
  policyRemediation?: string,
  packageReference?: string,
  advisory?: string,
): ClientRegistrationStatus =>
  state === "aligned"
    ? {
        client: client.name,
        config_path: client.configPath,
        command,
        ...(packageReference === undefined
          ? {}
          : { package_reference: packageReference }),
        state,
        remediation: null,
        ...(advisory === undefined ? {} : { advisory }),
      }
    : {
        client: client.name,
        config_path: client.configPath,
        command,
        ...(packageReference === undefined
          ? {}
          : { package_reference: packageReference }),
        state,
        remediation: policyRemediation ?? remediation(client),
      };

const timeoutAdvisory = (
  client: SetupClient,
  registration: ClientRegistration,
  timeoutInputs: McpToolTimeoutInputs,
): string | undefined => {
  const toolTimeout =
    client.name === "kimi"
      ? registration.toolTimeoutMs
      : client.name === "codex"
        ? registration.tool_timeout_sec
        : undefined;
  if (toolTimeout === undefined) return undefined;
  const providerAllowance = mcpProviderDeadlineAllowanceMs(timeoutInputs);
  const isKimi = client.name === "kimi";
  // A bigint is beyond the safe Number range, so rounding cannot cross the allowance.
  const toolTimeoutMs = Number(toolTimeout) * (isKimi ? 1 : 1000);
  const batchScope =
    timeoutInputs.ghidraDecompileTimeoutMs !== undefined &&
    (timeoutInputs.analysisProvider === "ghidra" ||
      timeoutInputs.analysisProvider === "auto")
      ? "The derived Ghidra deadline is a single-decompile estimate. For multi-function workflows such as batch_decompile, decompile_all or trace_native_values, allow startup plus every attempted function's limit and other work; split calls, reduce trace_native_values max_functions, or select a larger client deadline when needed. Explicit caller deadlines remain unchanged."
      : undefined;
  if (toolTimeoutMs >= providerAllowance) return batchScope;
  const setting = isKimi ? "toolTimeoutMs" : "tool_timeout_sec";
  const currentValue = isKimi
    ? `${String(toolTimeout)} ms`
    : `${String(toolTimeout)} seconds`;
  const recommendedValue = isKimi
    ? `${String(recommendedMcpToolTimeoutMs(timeoutInputs))} ms`
    : `${String(recommendedMcpToolTimeoutSeconds(timeoutInputs))} seconds`;
  const headroom = isKimi
    ? `${String(MCP_STARTUP_POLICY.toolOperationHeadroomMs)} ms`
    : `${String(MCP_STARTUP_POLICY.toolOperationHeadroomMs / 1000)} seconds`;
  const recommendation = `The configured ${setting} (${currentValue}) is shorter than REA's known provider allowance (${String(providerAllowance)} ms), so provider startup or an upstream request may exceed this client deadline. REA recommends ${setting} = ${recommendedValue} to cover that allowance plus ${headroom} of operation headroom; this additional headroom is a recommendation, not a guarantee for every analysis.`;
  return batchScope === undefined
    ? recommendation
    : `${recommendation} ${batchScope}`;
};

const packageVersionRemediation = (
  packageReference: string,
  client: SetupClient,
): string =>
  `This registration requests ${packageReference}, while the current REA CLI package is ${PRODUCT_IDENTITY.packageVersion}. REA does not resolve package-runner requests during doctor; update the registration with reverseport setup --client ${client.name}, then restart the client.`;

const unavailableStatus = (
  client: SetupClient,
  state: "missing" | "invalid",
  configPath: string = client.configPath,
): ClientRegistrationStatus => ({
  client: client.name,
  config_path: configPath,
  command: [],
  state,
  remediation: remediation(client),
});

/** Product discovery follows targets; configuration evidence retains entry presence. */
const clientEvidencePresent = async (
  client: SetupClient,
  evidence: { readonly selected: boolean; readonly ownership: boolean },
): Promise<
  Result<boolean, { readonly path: string; readonly detail: string }>
> => {
  // An explicit selection authorises the read outright: the caller named this
  // client, so an unreadable config must surface as unreadable instead of
  // collapsing to absence. The probes below serve automatic discovery only.
  if (evidence.selected) return ok(true);
  const discoveryPaths = new Set(client.discoveryPaths ?? []);
  const paths = [
    ...clientEvidencePaths(client),
    ...(evidence.ownership ? clientOwnershipEvidencePaths(client) : []),
  ];
  let unavailable:
    | { readonly path: string; readonly detail: string }
    | undefined;
  for (const path of paths) {
    try {
      await (discoveryPaths.has(path) ? stat(path) : lstat(path));
      return ok(true);
    } catch (cause: unknown) {
      if (!isMissing(cause))
        unavailable ??= {
          path,
          detail: `Client configuration evidence at ${path} could not be inspected: ${cause instanceof Error ? cause.message : String(cause)}. Check file permissions and rerun reverseport doctor.`,
        };
    }
  }
  return unavailable === undefined ? ok(false) : err(unavailable);
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";
