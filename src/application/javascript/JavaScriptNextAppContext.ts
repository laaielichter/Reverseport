import { posix } from "node:path";

import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { NextAppSourceContext } from "../../domain/javascript/javascriptRoutePaths.js";
import { compositeKey } from "../../domain/unicodeCodePointOrder.js";
import type { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

/** Package declarations and inventoried directories own source-router applicability. */
export const createJavaScriptNextAppContext = (
  files: readonly JavaScriptArtifactFile[],
  documents: JavaScriptJsonDocuments,
  directories: ReadonlySet<string>,
): ((
  file: Pick<JavaScriptArtifactFile, "path" | "container_sha256">,
) => NextAppSourceContext) => {
  const packages = new Map(
    files
      .filter(({ kind }) => kind === "package-json")
      .map((file) => [
        compositeKey([file.container_sha256, posix.dirname(file.path)]),
        file,
      ]),
  );
  const roots = new Map<JavaScriptArtifactFile, string | null>();
  return (file) => {
    for (
      let directory = posix.dirname(file.path);
      ;
      directory = posix.dirname(directory)
    ) {
      const manifest = packages.get(
        compositeKey([file.container_sha256, directory]),
      );
      if (manifest !== undefined) {
        const identity = {
          path: manifest.path,
          sha256: manifest.sha256,
          container_sha256: manifest.container_sha256,
        };
        const facts = documents.read(manifest);
        if (facts.status !== "included" || facts.nextDependency !== "declared")
          return {
            kind: "unknown",
            package: identity,
            reason:
              "The owning package does not establish a Next dependency for source routing.",
          };
        const prefix = directory === "." ? "" : `${directory}/`;
        const compiled = `${prefix}.next/static/chunks/app`;
        if (file.path.startsWith(`${compiled}/`))
          return {
            kind: "compiled-directory",
            directory: compiled,
            package: identity,
          };
        let root = roots.get(manifest);
        if (root === undefined) {
          root =
            ["app", "src/app"]
              .map((candidate) => `${prefix}${candidate}`)
              .find((candidate) => directories.has(candidate)) ?? null;
          roots.set(manifest, root);
        }
        return root !== null && file.path.startsWith(`${root}/`)
          ? { kind: "app-directory", directory: root, package: identity }
          : { kind: "outside-app-directory", package: identity };
      }
      if (directory === "." || directory === "/") break;
    }
    return {
      kind: "unknown",
      package: null,
      reason:
        "No owning package declaration establishes a Next App Router source root.",
    };
  };
};
