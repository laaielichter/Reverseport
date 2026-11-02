#!/usr/bin/env node
// Builds the tree for the claude-directory branch: only the files the Claude Code plugin loads, so the Claude plugin
// directory can validate and scan it. The whole repository (thousands of files, the TypeScript engine, fixtures) is
// more than the directory's validation can read in time.
//
// Usage: node scripts/build-claude-directory.mjs --out <empty folder> [--ref main]
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "laaielichter/Reverseport";

// What the plugin loads: its manifest and icon, skills, the agent, hooks, ReversePort's own zero-dependency engine,
// and the files the README links as policy. The marketplace file lists three plugins and stays out: the directory
// takes one plugin per submission.
const INCLUDE = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/icon.png",
  "agents/",
  "hooks/",
  "skills/",
  "port/",
  "LICENSE",
  "PRIVACY.md",
  "RESPONSIBLE-USE.md",
];
const EXCLUDE = ["port/test/"];

// Directory limits (claude.com/docs/plugins/pre-submission-checklist): more than 512 files, or a file over 5 MiB,
// holds or stops a submission.
const MAX_FILES = 512;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const IMAGE = /\.(?:png|gif|jpe?g|svg|webp)$/iu;

const matches = (path, rule) =>
  rule.endsWith("/") ? path.startsWith(rule) : path === rule;

/** The tracked files that belong in the plugin tree. */
const pluginFiles = (cwd) =>
  execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((path) => INCLUDE.some((rule) => matches(path, rule)))
    .filter((path) => !EXCLUDE.some((rule) => matches(path, rule)))
    .sort();

/** A repository-relative target as an absolute GitHub URL; images load from raw, folders from tree. */
const absoluteTarget = (target, ref) => {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(target)) return target;
  const path = target.replace(/^\.\//u, "");
  const bare = path.split(/[?#]/u)[0] ?? path;
  if (IMAGE.test(bare))
    return `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/${path}`;
  const kind = bare.endsWith("/") ? "tree" : "blob";
  return `https://github.com/${REPOSITORY}/${kind}/${ref}/${path}`;
};

/** README links and images point into the full repository, which the plugin tree does not carry. */
const absoluteReadme = (markdown, ref) =>
  markdown
    .replace(
      /\]\(([^)\s]+)\)/gu,
      (_, target) => `](${absoluteTarget(target, ref)})`,
    )
    .replace(
      /\b(src|href)="([^"]+)"/gu,
      (_, attribute, target) => `${attribute}="${absoluteTarget(target, ref)}"`,
    );

/** Paths the manifest and hooks run, relative to the plugin root. */
const launchedPaths = (tree) => {
  const texts = [
    readFileSync(join(tree, ".claude-plugin/plugin.json"), "utf8"),
    readFileSync(join(tree, "hooks/hooks.json"), "utf8"),
  ];
  return texts.flatMap((text) =>
    [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\\s]+)/gu)].map(
      (match) => match[1],
    ),
  );
};

const listTree = (tree, base = "") =>
  readdirSync(join(tree, base), { withFileTypes: true }).flatMap((entry) => {
    const path = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listTree(tree, path) : [path];
  });

/** Build the plugin tree into `out` and check it against the directory's limits. */
const buildClaudeDirectory = ({ out, ref = "main", cwd = ROOT }) => {
  const target = resolve(out);
  if (existsSync(target) && readdirSync(target).length > 0)
    throw new Error(`${target} is not empty`);
  mkdirSync(target, { recursive: true });

  for (const path of pluginFiles(cwd)) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(cwd, path), join(target, path));
  }

  writeFileSync(
    join(target, "README.md"),
    absoluteReadme(readFileSync(join(cwd, "README.md"), "utf8"), ref),
  );

  // port/src reads its version from ../../package.json. A package.json without dependencies, scripts or a lockfile
  // gives it that without anything for Claude Code to install.
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: pkg.description,
    license: pkg.license,
    homepage: "https://laaielichter.github.io/Reverseport/",
    repository: pkg.repository,
  };
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const files = listTree(target);
  const problems = [];
  if (files.length > MAX_FILES)
    problems.push(`${files.length} files (limit ${MAX_FILES})`);
  let bytes = 0;
  for (const path of files) {
    const size = statSync(join(target, path)).size;
    bytes += size;
    if (size > MAX_FILE_BYTES)
      problems.push(`${path} is ${size} bytes (limit ${MAX_FILE_BYTES})`);
  }
  for (const path of launchedPaths(target))
    if (!existsSync(join(target, path)))
      problems.push(`the plugin runs ${path}, which is not in the tree`);
  for (const forbidden of [
    ".claude-plugin/marketplace.json",
    "package-lock.json",
    ".npmrc",
  ])
    if (existsSync(join(target, forbidden)))
      problems.push(`${forbidden} must stay out of the plugin tree`);
  const readme = readFileSync(join(target, "README.md"), "utf8");
  const relative = [
    ...[...readme.matchAll(/\]\(([^)\s]+)\)/gu)].map((match) => match[1]),
    ...[...readme.matchAll(/\b(?:src|href)="([^"]+)"/gu)].map(
      (match) => match[1],
    ),
  ].filter((link) => link && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(link));
  if (relative.length > 0)
    problems.push(`README.md keeps relative links: ${relative.join(", ")}`);

  if (problems.length > 0) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(
      `The plugin tree does not fit the directory:\n- ${problems.join("\n- ")}`,
    );
  }
  return { out: target, version: pkg.version, files: files.length, bytes };
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      ref: { type: "string", default: "main" },
    },
  });
  if (!values.out) throw new Error("Pass --out <empty folder>");
  const result = buildClaudeDirectory({ out: values.out, ref: values.ref });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export { absoluteReadme, buildClaudeDirectory };
