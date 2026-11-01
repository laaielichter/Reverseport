import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import semver from "semver";

export function releaseNpmTag(version) {
  if (version === undefined || semver.valid(version) !== version)
    throw new Error("Expected an exact SemVer version.");
  return semver.prerelease(version) === null ? "latest" : "next";
}

// ReversePort's release workflow runs this file with the version and reads the tag from stdout.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(releaseNpmTag(process.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
