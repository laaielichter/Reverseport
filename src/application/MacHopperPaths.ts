import { readdirSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { posix } from "node:path";

export const MAC_HOPPER_APPLICATION_DIRECTORY = "/Applications";
export const MAC_HOPPER_APPLICATION_NAME = "Hopper Disassembler.app";
export const MAC_HOPPER_USER_APPLICATIONS_DIRECTORY = "Applications";

export const MAC_HOPPER_SYSTEM_LAUNCHER = posix.join(
  MAC_HOPPER_APPLICATION_DIRECTORY,
  MAC_HOPPER_APPLICATION_NAME,
  "Contents/MacOS/hopper",
);

export const macHopperUserApplicationPath = (homeDirectory: string): string =>
  posix.join(
    homeDirectory,
    MAC_HOPPER_USER_APPLICATIONS_DIRECTORY,
    MAC_HOPPER_APPLICATION_NAME,
  );

export const macHopperApplicationRoots = (
  homeDirectory: string,
): readonly string[] => [
  MAC_HOPPER_APPLICATION_DIRECTORY,
  posix.join(homeDirectory, MAC_HOPPER_USER_APPLICATIONS_DIRECTORY),
];

export const macHopperCanonicalLauncherCandidates = (
  homeDirectory: string,
): readonly string[] => [
  MAC_HOPPER_SYSTEM_LAUNCHER,
  posix.join(
    macHopperUserApplicationPath(homeDirectory),
    "Contents/MacOS/hopper",
  ),
];

/** Build deterministic candidates from the discovered app bundle names. */
export const macHopperRenamedLauncherCandidates = (
  homeDirectory: string,
  bundleNamesByRoot: ReadonlyMap<string, readonly string[]>,
): readonly string[] =>
  macHopperApplicationRoots(homeDirectory).flatMap((root) =>
    [...new Set(bundleNamesByRoot.get(root) ?? [])]
      .filter(
        (name) =>
          /^Hopper.*\.app$/iu.test(name) &&
          name.toLocaleLowerCase("en-US") !==
            MAC_HOPPER_APPLICATION_NAME.toLocaleLowerCase("en-US"),
      )
      .sort()
      .map((name) => posix.join(root, name, "Contents/MacOS/hopper")),
  );

const directoryNames = (entries: readonly Dirent[]): readonly string[] =>
  entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);

const localBundleNames = (root: string): readonly string[] => {
  try {
    return directoryNames(readdirSync(root, { withFileTypes: true }));
  } catch (cause: unknown) {
    // Missing or unreadable optional app directories contain no candidates.
    void cause;
    return [];
  }
};

/** Yield renamed bundles from the local filesystem, reading each root only if needed. */
export function* localMacHopperRenamedLauncherCandidates(
  homeDirectory: string,
): Generator<string> {
  for (const root of macHopperApplicationRoots(homeDirectory))
    yield* macHopperRenamedLauncherCandidates(
      homeDirectory,
      new Map([[root, localBundleNames(root)]]),
    );
}

/** Read the same renamed bundles without blocking the event loop, for doctor. */
export const readMacHopperRenamedLauncherCandidates = async (
  homeDirectory: string,
): Promise<readonly string[]> => {
  const bundleNamesByRoot = new Map<string, readonly string[]>();
  for (const root of macHopperApplicationRoots(homeDirectory)) {
    try {
      bundleNamesByRoot.set(
        root,
        directoryNames(await readdir(root, { withFileTypes: true })),
      );
    } catch (cause: unknown) {
      // Missing or unreadable optional app directories contain no candidates.
      void cause;
    }
  }
  return macHopperRenamedLauncherCandidates(homeDirectory, bundleNamesByRoot);
};
