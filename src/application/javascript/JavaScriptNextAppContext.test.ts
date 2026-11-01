import { expect, it } from "vitest";

import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";
import { createJavaScriptNextAppContext } from "./JavaScriptNextAppContext.js";

const file = (path: string, text = ""): JavaScriptArtifactFile => ({
  path,
  container_sha256: "a".repeat(64),
  sha256: "b".repeat(64),
  bytes: Buffer.byteLength(text),
  inventory_artifact_id: `art_${"b".repeat(64)}`,
  kind: path.endsWith("package.json") ? "package-json" : "javascript",
  unpacked: false,
  text: { included: true, value: text },
});

it("keeps package applicability and its root cache scoped to the source container", () => {
  const manifest = file("package.json", '{"dependencies":{"next":"16.4.2"}}');
  const foreign = {
    ...file("package.json", '{"name":"plain"}'),
    container_sha256: "c".repeat(64),
  };
  const page = file("app/page.js");
  const foreignPage = { ...page, container_sha256: foreign.container_sha256 };
  const context = createJavaScriptNextAppContext(
    [manifest, foreign, page, foreignPage],
    new JavaScriptJsonDocuments(),
    new Set(["app"]),
  );
  expect(context(page)).toMatchObject({
    kind: "app-directory",
    package: { container_sha256: manifest.container_sha256 },
  });
  expect(context(foreignPage)).toMatchObject({
    kind: "unknown",
    package: { container_sha256: foreign.container_sha256 },
  });
  expect(context(page).kind).toBe("app-directory");
});

it("uses the nearest declared Next package and root directory precedence", () => {
  const files = [
    file("package.json", '{"dependencies":{"next":"16.4.2"}}'),
    file("app/page.js"),
    file("src/app/control/page.js"),
    file("pages/app/page.js"),
    file("components/app/page.js"),
    file("node_modules/ordinary/package.json", '{"name":"ordinary"}'),
    file("node_modules/ordinary/app/page.js"),
  ];
  const context = createJavaScriptNextAppContext(
    files,
    new JavaScriptJsonDocuments(),
    new Set([
      "app",
      "src/app",
      "pages",
      "components/app",
      "node_modules/ordinary/app",
    ]),
  );
  expect(context(files[1]!)).toMatchObject({
    kind: "app-directory",
    directory: "app",
    package: { path: "package.json" },
  });
  for (const source of files.slice(2, 5))
    expect(context(source).kind).toBe("outside-app-directory");
  expect(context(files[6]!)).toMatchObject({
    kind: "unknown",
    package: { path: "node_modules/ordinary/package.json" },
  });
});

it("keeps default compiled output under its declared package and unrelated chunk-like paths unknown", () => {
  const manifest = file("package.json", '{"dependencies":{"next":"16.4.2"}}');
  const chunk = file(".next/static/chunks/app/build/page-abc.js");
  const context = createJavaScriptNextAppContext(
    [manifest, chunk],
    new JavaScriptJsonDocuments(),
    new Set(),
  );
  expect(context(chunk)).toMatchObject({
    kind: "compiled-directory",
    directory: ".next/static/chunks/app",
  });
  expect(
    createJavaScriptNextAppContext(
      [chunk],
      new JavaScriptJsonDocuments(),
      new Set(),
    )(chunk),
  ).toMatchObject({ kind: "unknown" });
});

it("supports src/app only when app is not inventoried and retains missing framework identity", () => {
  const manifest = file(
    "package.json",
    '{"devDependencies":{"next":"16.4.2"}}',
  );
  const page = file("src/app/control/page.js");
  expect(
    createJavaScriptNextAppContext(
      [manifest, page],
      new JavaScriptJsonDocuments(),
      new Set(["src/app"]),
    )(page),
  ).toMatchObject({ kind: "app-directory", directory: "src/app" });
  expect(
    createJavaScriptNextAppContext(
      [page],
      new JavaScriptJsonDocuments(),
      new Set(["src/app"]),
    )(page),
  ).toMatchObject({ kind: "unknown", package: null });
});
