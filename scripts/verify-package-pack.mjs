import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FULL_CATALOG_IDENTITY } from "../dist/catalogIdentity.js";

import { parseTarListing } from "./lib/verify-package-listing.mjs";
import { verifyPackedBridge } from "./verify-packed-bridge.mjs";

/** Create a tarball and assert production packaging constraints. */
export async function verifyPackagePack({ root, workspace, commands }) {
  const packDirectory = join(workspace, "pack");
  await mkdir(packDirectory);
  const tarball = join(
    packDirectory,
    (
      await commands.execNpm(
        ["pack", "--silent", "--pack-destination", packDirectory],
        {
          cwd: root,
        },
      )
    ).stdout.trim(),
  );
  const packedFiles = parseTarListing(
    (await commands.exec("tar", ["-tf", tarball])).stdout,
  );
  const packedManifest = JSON.parse(
    (await commands.exec("tar", ["-xOf", tarball, "package/package.json"]))
      .stdout,
  );
  if (
    packedManifest.scripts?.postinstall !== undefined ||
    packedManifest.dependencies?.["node-pty"] !== undefined ||
    packedManifest.dependencies?.["@lydell/node-pty"] !== "1.1.0"
  )
    throw new Error("package retained a lifecycle-dependent PTY installation");
  // `rea` is the deep-analysis engine; `reverseport` is the front door, which adds the port
  // commands and hands everything else to the engine.
  if (
    packedManifest.bin?.rea !== "scripts/rea.mjs" ||
    packedManifest.bin?.["reverseport"] !== "bin/reverseport.mjs" ||
    !packedFiles.includes("package/bin/reverseport.mjs") ||
    !packedFiles.includes("package/scripts/rea.mjs")
  )
    throw new Error("package did not expose both command entry points");
  if (packedManifest.mcpName !== "io.github.laaielichter/reverseport")
    throw new Error("package did not retain its MCP Registry ownership marker");
  if (!packedFiles.includes("package/scripts/lib/cli-process-environment.mjs"))
    throw new Error("package omitted the CLI process environment owner");
  if (packedFiles.some((path) => path.startsWith("package/.agents/")))
    throw new Error(
      "package included authored skill sources instead of only the generated bundle",
    );
  if (packedFiles.some((path) => path.startsWith("package/.cache/")))
    throw new Error("package included development cache or test metadata");
  const skill = (
    await commands.exec("tar", [
      "-xOf",
      tarball,
      "package/skills/reverse-engineer-anything/SKILL.md",
    ])
  ).stdout;
  if (
    !skill.includes(
      `  tool_count: ${String(FULL_CATALOG_IDENTITY.counts.mcp_tools)}\n`,
    ) ||
    skill.includes("  catalog_digest:")
  )
    throw new Error(
      "packaged skill metadata did not match the catalog shipped in the package",
    );
  if (
    packedFiles.some(
      (path) => path.includes("__pycache__") || path.endsWith(".pyc"),
    )
  ) {
    throw new Error("package contained generated Python bytecode");
  }
  await verifyPackedBridge({ tarball, packedFiles, commands });
  return { tarball };
}
