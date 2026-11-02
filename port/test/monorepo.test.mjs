// Monorepos: workspace packages imported by name, tsconfig "paths" aliases, framework and start detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

const { scanProject } = await import('../src/scan.mjs');
const { graphTool } = await import('../src/graph.mjs');
const { parseJsonc, packageCandidates, pnpmWorkspaceGlobs, externalPackage } = await import('../src/jsworkspace.mjs');

async function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

async function monorepo() {
  const root = await tempDir('rp-mono-');
  await writeTree(root, {
    'package.json': { name: 'demo', private: true, workspaces: ['packages/*'], packageManager: 'bun@1.4.0', scripts: { dev: 'bun run --cwd packages/cli src/index.ts' } },
    'bun.lock': '{}',
    'turbo.json': '{ "tasks": {} }',
    'packages/core/package.json': { name: '@demo/core', exports: { '.': './src/index.ts', './*': './src/*.ts' }, dependencies: { effect: '1' } },
    'packages/core/src/index.ts': "export * from './store'\n",
    'packages/core/src/store.ts': 'export const store = 1\n',
    'packages/core/src/tool/read.ts': "import { store } from '../store'\nexport const read = store\n",
    'packages/cli/package.json': { name: '@demo/cli', main: 'dist/index.js', dependencies: { 'solid-js': '1', '@demo/core': 'workspace:*' } },
    // tsconfig with comments, a trailing comma and an alias
    'packages/cli/tsconfig.json': '{\n  // local alias\n  "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },\n}\n',
    'packages/cli/src/index.ts': "import { store } from '@demo/core'\nimport { read } from '@demo/core/tool/read'\nimport { log } from '@/log'\nimport { Effect } from 'effect'\nlog(store, read, Effect)\n",
    'packages/cli/src/log.ts': 'export const log = (...a: unknown[]) => a\n',
  });
  return root;
}

test('jsonc: comments, trailing commas, strings that look like comments', () => {
  assert.deepEqual(parseJsonc('{ "a": "http://x", /* b */ "c": [1, 2,], // d\n }'), { a: 'http://x', c: [1, 2] });
  assert.equal(parseJsonc('{ broken'), null);
});

test('package candidates: exports patterns and dist → src fallback', () => {
  const c = packageCandidates({ dir: 'packages/core', pkg: { exports: { './*': './src/*.ts' } } }, 'tool/read');
  assert.equal(c[0], 'packages/core/src/tool/read.ts');
  const d = packageCandidates({ dir: 'p', pkg: { main: 'dist/index.js' } }, '');
  assert.ok(d.includes('p/src/index.js'));
});

test('alias targets: every * in the target is replaced, and $-sequences in the match stay literal', async () => {
  // Node: "./*": "./dist/*/*.js" → every * in the target takes the matched subpath.
  const c = packageCandidates({ dir: 'p', pkg: { exports: { './*': './dist/*/*.js' } } }, 'a');
  assert.equal(c[0], 'p/dist/a/a.js');
  // A subpath such as "$lib" or "a$&b" must not be read as a replacement pattern.
  const d = packageCandidates({ dir: 'p', pkg: { exports: { './*': './src/*.ts' } } }, 'a$&b');
  assert.equal(d[0], 'p/src/a$&b.ts');
  // tsconfig "paths": same rules for the target.
  const root = await tempDir('rp-alias-');
  await writeTree(root, {
    'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '$lib/*': ['./lib/*/*.ts'], '@/*': ['./src/*'] } } },
    'lib/util/util.ts': 'export const u = 1\n',
    'src/index.ts': "import { u } from '$lib/util'\nexport const x = u\n",
  });
  const g = await graphTool({ path: root });
  assert.ok(g.edges.some(e => e.from === 'src/index.ts' && e.to === 'lib/util/util.ts'), JSON.stringify(g.edges));
});

test('scan: monorepo tooling, frameworks, and a root script that starts a file in a package', async () => {
  const s = await scanProject({ path: await monorepo() });
  assert.equal(s.primary.id, 'js-monorepo');
  const mono = s.engines.find(e => e.id === 'js-monorepo');
  assert.equal(mono.details.packageManager, 'bun');
  assert.deepEqual(mono.details.tools, ['Turborepo']);
  assert.equal(mono.details.packages, 3);
  const cli = s.engines.find(e => e.root === 'packages/cli');
  assert.ok(cli.details.frameworks.includes('SolidJS'));
  const rootPkg = s.engines.find(e => e.id === 'node' && e.root === '');
  assert.deepEqual(rootPkg.details.starts, ['packages/cli/src/index.ts']);
});

test('graph: workspace package names and tsconfig paths resolve to files; package-level edges', async () => {
  const g = await graphTool({ path: await monorepo() });
  const from = 'packages/cli/src/index.ts';
  const to = new Set(g.edges.filter(e => e.from === from).map(e => e.to));
  assert.ok(to.has('packages/core/src/index.ts'), 'bare package name → exports "."');
  assert.ok(to.has('packages/core/src/tool/read.ts'), 'subpath → exports "./*"');
  assert.ok(to.has('packages/cli/src/log.ts'), 'tsconfig paths alias');
  const ext = g.externals.map(e => e.name);
  assert.ok(ext.includes('effect'));
  assert.ok(!ext.includes('@demo/core') && !ext.includes('@/log'), 'workspace imports are not external');
  assert.ok(g.entryPoints.includes(from));
  assert.equal(g.workspace.resolvedByTsconfigPaths, 1);
  assert.deepEqual(g.workspace.packageEdges[0], { from: '@demo/cli', to: '@demo/core', uses: 2 });
});

test('pnpm-workspace.yaml: package globs without a YAML library', async () => {
  assert.deepEqual(pnpmWorkspaceGlobs("packages:\n  - 'packages/*'\n  - \"apps/*\"\n  # comment lines are skipped\n  - tools/** # so are trailing comments\n  - '!**/test/**'\ncatalog:\n  react: ^19\n"), ['packages/*', 'apps/*', 'tools/**', '!**/test/**']);
  assert.deepEqual(pnpmWorkspaceGlobs("packages: ['a/*', \"b\"]\n"), ['a/*', 'b']);
  assert.deepEqual(pnpmWorkspaceGlobs('packages:\n- a/*\nonlyBuiltDependencies:\n- esbuild\n'), ['a/*'], 'items of the next key are not packages');
  assert.deepEqual(pnpmWorkspaceGlobs('catalog: {}\n'), []);
  const root = await tempDir('rp-pnpm-');
  await writeTree(root, {
    'package.json': { name: 'pn', private: true },
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - \"apps/*\"\n  # comment lines are skipped\n",
    'packages/a/package.json': { name: 'a' },
    'apps/web/package.json': { name: 'web' },
  });
  const mono = (await scanProject({ path: root })).engines.find(e => e.id === 'js-monorepo');
  assert.deepEqual(mono.details.workspaces, ['packages/*', 'apps/*']);
  assert.equal(mono.details.packageManager, 'pnpm');
});

test('scan: game and physics libraries in package.json', async () => {
  const root = await tempDir('rp-gamelibs-');
  await writeTree(root, { 'package.json': { name: 'g', dependencies: { melonjs: '17', 'matter-js': '0.20', howler: '2', '@dimforge/rapier3d-compat': '0.14' } } });
  const node = (await scanProject({ path: root })).engines.find(e => e.id === 'node');
  for (const n of ['melonJS', 'Matter.js', 'Howler.js', 'Rapier']) assert.ok(node.details.frameworks.includes(n), n);
});

test('graph: package.json #imports resolve (exact, * pattern, conditions); a package target stays external', async () => {
  const root = await tempDir('rp-hash-');
  await writeTree(root, {
    'package.json': { name: 'h', type: 'module', imports: { '#worker': './src/worker.ts', '#utils/*': './src/utils/*.ts', '#db': { node: './src/db-node.ts', default: './src/db-web.ts' }, '#fetch': 'undici' } },
    'src/index.ts': "import w from '#worker'\nimport { pad } from '#utils/text'\nimport db from '#db'\nimport { fetch } from '#fetch'\nconsole.log(w, pad, db, fetch)\n",
    'src/worker.ts': 'export default 1\n',
    'src/utils/text.ts': 'export const pad = 1\n',
    'src/db-node.ts': 'export default 1\n',
    'src/db-web.ts': 'export default 2\n',
  });
  const g = await graphTool({ path: root });
  const to = new Set(g.edges.filter(e => e.from === 'src/index.ts').map(e => e.to));
  for (const f of ['src/worker.ts', 'src/utils/text.ts', 'src/db-node.ts']) assert.ok(to.has(f), f);
  const ext = g.externals.map(e => e.name);
  assert.ok(!ext.some(n => n.startsWith('#')), 'no #imports in externals');
  assert.ok(ext.includes('undici'), 'a #import that maps to a package counts as that package');
  assert.equal(g.workspace.resolvedByImportMaps, 3);
});

test('graph: deno.json import maps resolve local entries; jsr:, npm: and https: stay external', async () => {
  const root = await tempDir('rp-deno-');
  await writeTree(root, {
    'deno.jsonc': '{\n  // import map\n  "imports": { "@/": "./src/", "utils": "./lib/utils.ts", "std/": "jsr:@std/", "zod": "npm:zod@3.23.8", "preact": "https://esm.sh/preact@10" },\n}\n',
    'main.ts': 'import { db } from "@/db.ts"\nimport { u } from "utils"\nimport { join } from "std/path/mod.ts"\nimport { z } from "zod"\nimport { h } from "preact"\nimport { assert } from "jsr:@std/assert@1"\nconsole.log(db, u, join, z, h, assert)\n',
    'src/db.ts': 'export const db = 1\n',
    'lib/utils.ts': 'export const u = 1\n',
  });
  const g = await graphTool({ path: root });
  const to = new Set(g.edges.filter(e => e.from === 'main.ts').map(e => e.to));
  assert.ok(to.has('src/db.ts'), 'prefix ending in /');
  assert.ok(to.has('lib/utils.ts'), 'exact name');
  const ext = g.externals.map(e => e.name).sort();
  assert.deepEqual(ext, ['esm.sh', 'jsr:@std/assert', 'jsr:@std/path', 'npm:zod']);
  assert.equal(externalPackage('npm:@scope/pkg@1.2.3/sub'), 'npm:@scope/pkg');
  assert.equal(externalPackage('lodash/fp'), 'lodash');
});
