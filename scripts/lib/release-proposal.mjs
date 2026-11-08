import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { requireCompleteReleaseHistory } from "./release-notes.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../../", import.meta.url));
const patch = fileURLToPath(
  new URL("../../patches/release-please+17.3.0.patch", import.meta.url),
);

export function describeReleaseProposalError(error) {
  if (!(error instanceof Error)) return String(error);
  const description = error.message || error.name || "Unknown error";
  const status = error.status;
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? `${description} (HTTP ${status})`
    : description;
}

export async function applyReleasePleasePatch(
  directory = dirname(require.resolve("release-please/package.json")),
) {
  const metadata = JSON.parse(
    await readFile(`${directory}/package.json`, "utf8"),
  );
  if (metadata.version !== "17.3.0") {
    throw new Error(
      "The release proposal patch requires release-please 17.3.0",
    );
  }
  // A Windows checkout with core.autocrlf=true gives the patch CRLF line
  // endings, which no longer match the LF dependency sources. The repository
  // cannot pin them with .gitattributes (the Claude plugin directory rejects
  // one), so apply an LF copy instead.
  const text = await readFile(patch, "utf8");
  const scratch = text.includes("\r\n")
    ? await mkdtemp(join(tmpdir(), "rea-release-patch-"))
    : undefined;
  const patchFile =
    scratch === undefined ? patch : join(scratch, "release-please.patch");
  if (scratch !== undefined)
    await writeFile(patchFile, text.replaceAll("\r\n", "\n"));
  // Git prefixes patch filenames with a slash-separated path, even on Windows.
  // Split only native separators so POSIX backslashes remain filename bytes.
  const args = [
    "--directory",
    relative(project, directory).split(sep).join("/"),
    patchFile,
  ];
  const check = async (reverse) => {
    try {
      await execute(
        "git",
        ["apply", "--check", ...(reverse ? ["--reverse"] : []), ...args],
        { cwd: project },
      );
      return true;
    } catch (error) {
      if (error.code === 1) return false;
      throw error;
    }
  };
  try {
    if (await check(false)) {
      await execute("git", ["apply", ...args], { cwd: project });
    } else if (!(await check(true))) {
      throw new Error(
        "The release proposal dependency patch does not match the installed source",
      );
    }
  } finally {
    if (scratch !== undefined)
      await rm(scratch, { recursive: true, force: true });
  }
}

export async function releaseProposalSearchDepth(run, sourceSha) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha ?? "")) {
    throw new Error("Expected an exact release proposal source SHA");
  }
  await requireCompleteReleaseHistory(run);
  const text = (await run("git", ["rev-list", "--count", sourceSha])).trim();
  const count = Number(text);
  if (!/^[1-9][0-9]*$/u.test(text) || !Number.isSafeInteger(count)) {
    throw new Error("Git returned an invalid release history size");
  }
  return count;
}
