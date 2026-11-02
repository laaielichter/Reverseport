import { PRODUCT_IDENTITY } from "../identity.js";
import {
  clientServerPath,
  legacyClientServerPath,
  OMP_DISABLED_SERVERS_KEY,
  OMP_ENABLED_SERVERS_KEY,
  shadowedClientServers,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import type { ClientConfigurationSource } from "./ClientConfigurationFiles.js";
import { classifyClientRegistration } from "./ClientRegistrationIdentity.js";
import type { SetupClient } from "./SupportedClients.js";

/**
 * Earlier releases registered REA under a previous server name ("rea"). Setup
 * moves an entry it can prove is REA's to the current name inside its own
 * transaction, and leaves every other previous-name entry byte for byte.
 */

/** Why setup leaves a previous-name entry in place. */
type KeptReason =
  /** The launcher is not REA's. */
  | "foreign"
  /** REA cannot resolve the launcher's identity. */
  | "unknown"
  /** An earlier duplicate member under the name is not REA-owned. */
  | "shadowed"
  /** Removing the native entry would activate an unowned OpenCode V1 entry. */
  | "unowned_fallback";

interface KeptPreviousRegistration {
  readonly name: string;
  readonly reason: KeptReason;
}

/** What setup removes under previous names, and what it keeps. */
export interface ServerKeyMigration {
  /** Previous names whose entry in the server table setup removes. */
  readonly removeNative: readonly string[];
  /** Previous names whose OpenCode V1 entry beside a V2 table setup removes. */
  readonly removeLegacy: readonly string[];
  readonly kept: readonly KeptPreviousRegistration[];
}

const NO_MIGRATION: ServerKeyMigration = Object.freeze({
  removeNative: [],
  removeLegacy: [],
  kept: [],
});

/** Whether setup has a previous-name entry to remove. */
export const migrationPending = (migration: ServerKeyMigration): boolean =>
  migration.removeNative.length > 0 || migration.removeLegacy.length > 0;

/**
 * Decide, per previous name, whether setup may remove REA's old entry. This
 * is uninstall's removal rule: the entry and every earlier duplicate member
 * must be REA-owned, and removing a native entry must not activate an unowned
 * OpenCode V1 entry. A refused name keeps every member.
 */
export const serverKeyMigration = (
  client: SetupClient,
  parsed: ClientConfigurationDocument,
  original: string | undefined,
): ServerKeyMigration => {
  // The Harness row is owned by its entry id and projected under the current
  // name; its server name is a managed setting that setup rewrites.
  if (parsed.dialect === "dsh") return NO_MIGRATION;
  const removeNative: string[] = [];
  const removeLegacy: string[] = [];
  const kept: KeptPreviousRegistration[] = [];
  const owned = (value: unknown): boolean =>
    classifyClientRegistration(value, client) === "owned";
  for (const name of PRODUCT_IDENTITY.previousMcpServerKeys) {
    const native = Object.hasOwn(parsed.servers, name)
      ? classifyClientRegistration(parsed.servers[name], client)
      : undefined;
    const legacy = Object.hasOwn(parsed.legacyServers, name)
      ? classifyClientRegistration(parsed.legacyServers[name], client)
      : undefined;
    if (native === undefined && legacy === undefined) continue;
    const nativeOwned = native === "owned";
    const legacyOwned = legacy === "owned";
    const shadowed =
      original === undefined || (!nativeOwned && !legacyOwned)
        ? undefined
        : shadowedClientServers(original, parsed, name);
    const refusal: KeptReason | undefined =
      (nativeOwned && shadowed?.servers.some((member) => !owned(member))) ||
      (legacyOwned && shadowed?.legacyServers.some((member) => !owned(member)))
        ? "shadowed"
        : nativeOwned && legacy !== undefined && !legacyOwned
          ? "unowned_fallback"
          : undefined;
    if (refusal !== undefined) {
      kept.push({ name, reason: refusal });
      continue;
    }
    if (nativeOwned) removeNative.push(name);
    if (legacyOwned) removeLegacy.push(name);
    const unowned = [native, legacy].find(
      (identity) => identity !== undefined && identity !== "owned",
    );
    if (unowned === "foreign" || unowned === "unknown")
      kept.push({ name, reason: unowned });
  }
  return { removeNative, removeLegacy, kept };
};

/**
 * The document as it reads after the migration, used to derive the
 * registration setup writes. A removed entry's settings seed the current name
 * only when no current-name entry exists; otherwise the current entry wins.
 */
export const migratedClientConfiguration = (
  parsed: ClientConfigurationDocument,
  migration: ServerKeyMigration,
): ClientConfigurationDocument => {
  if (!migrationPending(migration)) return parsed;
  const current = PRODUCT_IDENTITY.mcpServerKey;
  const servers = { ...parsed.servers };
  const legacyServers = { ...parsed.legacyServers };
  const currentPresent = (): boolean =>
    Object.hasOwn(servers, current) || Object.hasOwn(legacyServers, current);
  for (const name of migration.removeNative) {
    if (!currentPresent()) servers[current] = servers[name];
    delete servers[name];
  }
  for (const name of migration.removeLegacy) {
    if (!currentPresent()) legacyServers[current] = legacyServers[name];
    delete legacyServers[name];
  }
  return { ...parsed, servers, legacyServers };
};

/** Name-keyed list edits that accompany a migration, with their plan notes. */
export interface ServerKeyListEdits {
  /** Replacement root members, keyed by list name. */
  readonly lists: Readonly<Record<string, readonly unknown[]>>;
  readonly notes: readonly string[];
}

/**
 * Lists that name servers follow setup's purpose, an enabled registration:
 * a migrated name leaves OMP's `disabledServers` and Grok Build's
 * `disabled_mcp_servers`, and becomes the current name in OMP's
 * `enabledServers`. Lists naming an entry setup keeps stay as they are; Pi
 * ignores these lists, and Gemini policy lists are never edited.
 */
export const serverKeyListEdits = (
  parsed: ClientConfigurationDocument,
  migration: ServerKeyMigration,
): ServerKeyListEdits => {
  const migrated = new Set(migration.removeNative);
  if (migrated.size === 0) return { lists: {}, notes: [] };
  const current = PRODUCT_IDENTITY.mcpServerKey;
  const lists: Record<string, readonly unknown[]> = {};
  const notes: string[] = [];
  const deny =
    parsed.dialect === "omp"
      ? OMP_DISABLED_SERVERS_KEY
      : parsed.dialect === "grok"
        ? "disabled_mcp_servers"
        : undefined;
  const denied = deny === undefined ? undefined : parsed.document[deny];
  if (deny !== undefined && Array.isArray(denied)) {
    const names = [...migrated].filter((name) => denied.includes(name));
    if (names.length > 0) {
      lists[deny] = denied.filter(
        (name: unknown) =>
          name !== current && !(typeof name === "string" && migrated.has(name)),
      );
      notes.push(
        `Remove ${quoted(names)} from ${deny}: this re-enables REA, which was disabled under its previous name.`,
      );
    }
  }
  const enabled =
    parsed.dialect === "omp"
      ? parsed.document[OMP_ENABLED_SERVERS_KEY]
      : undefined;
  if (Array.isArray(enabled)) {
    const names = [...migrated].filter((name) => enabled.includes(name));
    if (names.length > 0) {
      const renamed: unknown[] = [];
      for (const name of enabled)
        if (typeof name === "string" && migrated.has(name)) {
          if (!renamed.includes(current) && !enabled.includes(current))
            renamed.push(current);
        } else renamed.push(name);
      lists[OMP_ENABLED_SERVERS_KEY] = renamed;
      notes.push(
        `Replace ${quoted(names)} with "${current}" in ${OMP_ENABLED_SERVERS_KEY}.`,
      );
    }
  }
  return { lists, notes };
};

/** Paths of the entries a migration deletes. */
export const migrationEditedPaths = (
  parsed: ClientConfigurationDocument,
  migration: ServerKeyMigration,
): readonly (readonly string[])[] => [
  ...migration.removeNative.map((name) => clientServerPath(parsed, name)),
  ...migration.removeLegacy.flatMap((name) => {
    const path = legacyClientServerPath(parsed, name);
    return path === undefined ? [] : [path];
  }),
];

const quoted = (names: readonly string[]): string =>
  names.map((name) => `"${name}"`).join(", ");

const KEPT_DETAIL: Readonly<Record<KeptReason, string>> = {
  foreign: "its launcher is not REA's",
  unknown: "REA cannot confirm its launcher",
  shadowed: "an earlier duplicate member under that name is not REA-owned",
  unowned_fallback:
    "removing it would activate an OpenCode V1 entry under that name that is not REA-owned",
};

/**
 * Tool names derive from the server name, so permission rules written for a
 * previous name stop matching. Setup only counts the references in the files
 * it already read; it never rewrites them.
 */
const previousToolReferences = (text: string): number => {
  let count = 0;
  for (const name of PRODUCT_IDENTITY.previousMcpServerKeys) {
    const pattern = new RegExp(
      `(?<![\\w.-])(?:mcp__${name}_|${name}__|${name}_\\*)`,
      "gu",
    );
    count += text.match(pattern)?.length ?? 0;
  }
  return count;
};

/** Plan lines disclosing the migration, kept entries and leftover references. */
export const serverKeyMigrationNotes = (input: {
  readonly client: SetupClient;
  readonly parsed: ClientConfigurationDocument;
  readonly original: string | undefined;
  readonly migration: ServerKeyMigration;
  readonly listNotes: readonly string[];
  readonly sources: readonly ClientConfigurationSource[];
  readonly fallbackPath?: string;
}): readonly string[] => {
  const { client, parsed, migration } = input;
  const current = PRODUCT_IDENTITY.mcpServerKey;
  const notes: string[] = [];
  const removed = [
    ...new Set([...migration.removeNative, ...migration.removeLegacy]),
  ];
  if (removed.length > 0) {
    const currentPresent =
      Object.hasOwn(parsed.servers, current) ||
      Object.hasOwn(parsed.legacyServers, current);
    notes.push(
      `Rename REA's registration ${quoted(removed)} to "${current}": remove the REA-owned ${quoted(removed)} entry and ${
        currentPresent
          ? `keep the existing "${current}" entry's custom settings (settings only under ${quoted(removed)} are dropped)`
          : "carry its custom settings to the new entry"
      }. Tool names change from mcp__${removed[0]}__* to mcp__${current}__*.`,
    );
  }
  notes.push(...input.listNotes);
  for (const { name, reason } of migration.kept)
    notes.push(
      `Keep "${name}" in ${client.configPath} unchanged: ${KEPT_DETAIL[reason]}. If it is an older REA registration, remove it yourself; otherwise the client loads REA under both names.`,
    );
  if (input.fallbackPath !== undefined && removed.length > 0)
    notes.push(
      `The shared fallback ${input.fallbackPath} keeps ${quoted(removed)} for its other readers; setup does not edit it.`,
    );
  for (const source of input.sources)
    if (
      source.sourcePath !== client.configPath &&
      PRODUCT_IDENTITY.previousMcpServerKeys.some(
        (name) =>
          Object.hasOwn(source.servers, name) ||
          Object.hasOwn(source.legacyServers, name),
      )
    )
      notes.push(
        `${source.sourcePath} also registers a previous REA name; setup does not edit that file.`,
      );
  const references =
    input.original === undefined ? 0 : previousToolReferences(input.original);
  if (references > 0)
    notes.push(
      `Tool names change from mcp__${PRODUCT_IDENTITY.previousMcpServerKeys[0]}__* to mcp__${current}__*; ${references} reference${references === 1 ? "" : "s"} to the old tool names remain in ${client.configPath}. Setup does not edit them.`,
    );
  return notes;
};
