// Rust workspaces: `use` paths resolve to files, build output stays out of scans, and test files do not crowd the
// architecture picture. Also the "Missing <choice>" message that lists the allowed values (issue #15).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

const { expandRustUse } = await import('../src/symbols.mjs');
const { graphTool, graphMermaid, buildGraph, isTestFile } = await import('../src/graph.mjs');
const { scanProject } = await import('../src/scan.mjs');
const { walk } = await import('../src/util.mjs');
const { callTool } = await import('../src/tools.mjs');

async function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

async function workspace() {
  const root = await tempDir('rp-rust-');
  await writeTree(root, {
    'Cargo.toml': '[workspace]\nmembers = ["crates/demo-core", "crates/demo-cli"]\n',
    'crates/demo-core/Cargo.toml': '[package]\nname = "demo-core"\nversion = "0.1.0"\n',
    'crates/demo-core/src/lib.rs': 'pub mod scan;\npub mod util;\npub mod net;\npub const VERSION: &str = "1";\n',
    'crates/demo-core/src/scan.rs': 'use crate::util::{self, human};\nuse std::path::Path;\npub struct Report;\npub fn scan(_p: &Path) -> Report { util::x(); human(); Report }\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn t() { scan(Path::new(".")); }\n}\n',
    'crates/demo-core/src/util.rs': 'pub fn x() {}\npub fn human() {}\n',
    'crates/demo-core/src/net/mod.rs': 'mod http;\npub use self::http::get;\n',
    'crates/demo-core/src/net/http.rs': 'use super::super::util::human;\npub fn get() { human() }\n',
    'crates/demo-cli/Cargo.toml': '[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\ndemo-core = { path = "../demo-core" }\n',
    'crates/demo-cli/src/main.rs': 'use demo_core::scan::{self, Report};\nuse demo_core::{net, VERSION};\nuse std::collections::HashMap;\nfn main() { let _: Report = scan::scan(std::path::Path::new(".")); net::get(); println!("{VERSION}"); let _m: HashMap<u8, u8> = HashMap::new(); }\n',
    'crates/demo-cli/tests/cli.rs': 'use demo_core::scan;\n#[test]\nfn runs() { scan::scan(std::path::Path::new(".")); }\n',
    // Build output next to Cargo.toml: never source
    'target/debug/deps/demo-abc.d': 'x',
    'target/debug/incremental/demo/s.lock': '',
  });
  return root;
}

test('expandRustUse: braces, nested braces, self, globs, aliases', () => {
  assert.deepEqual(expandRustUse('crate::scan::{self, Report, ScanOptions}'), ['crate::scan', 'crate::scan::Report', 'crate::scan::ScanOptions']);
  assert.deepEqual(expandRustUse('a::{b::{c, d}, e}'), ['a::b::c', 'a::b::d', 'a::e']);
  assert.deepEqual(expandRustUse('super::*'), ['super']);
  assert.deepEqual(expandRustUse('foo::Bar as Baz'), ['foo::Bar']);
  assert.deepEqual(expandRustUse('::std::fmt'), ['std::fmt']);
  assert.deepEqual(expandRustUse('*'), []);
});

test('graph: crate::, self::, super::, workspace crates by package name, inline test modules', async () => {
  const root = await workspace();
  const g = await graphTool({ path: root });
  const full = await buildGraph(root);
  const has = (from, to) => full.edges.some(e => e.from === from && e.to === to);
  // crate:: and braces: scan.rs → util.rs (both `self` and `human` land on the same file)
  assert.ok(has('crates/demo-core/src/scan.rs', 'crates/demo-core/src/util.rs'));
  // super::super:: from a nested module
  assert.ok(has('crates/demo-core/src/net/http.rs', 'crates/demo-core/src/util.rs'));
  // self:: from mod.rs and the `mod http;` declaration
  assert.ok(has('crates/demo-core/src/net/mod.rs', 'crates/demo-core/src/net/http.rs'));
  // workspace crate "demo-core" is `demo_core` in code; items in lib.rs itself (VERSION) point at lib.rs
  assert.ok(has('crates/demo-cli/src/main.rs', 'crates/demo-core/src/scan.rs'));
  assert.ok(has('crates/demo-cli/src/main.rs', 'crates/demo-core/src/net/mod.rs'));
  assert.ok(has('crates/demo-cli/src/main.rs', 'crates/demo-core/src/lib.rs'));
  assert.ok(has('crates/demo-cli/tests/cli.rs', 'crates/demo-core/src/scan.rs'));
  // `use super::*` inside `mod tests { … }` is the file itself: no edge to lib.rs
  assert.ok(!has('crates/demo-core/src/scan.rs', 'crates/demo-core/src/lib.rs'));
  // std is external, the workspace crate is not
  assert.ok(g.externals.some(e => e.name === 'std'));
  assert.ok(!g.externals.some(e => e.name === 'demo_core'));
  // dependencies come before the files that use them
  const order = g.portOrder;
  assert.ok(order.indexOf('crates/demo-core/src/util.rs') < order.indexOf('crates/demo-core/src/scan.rs'));
  assert.ok(order.indexOf('crates/demo-core/src/scan.rs') < order.indexOf('crates/demo-cli/src/main.rs'));
});

test('scan and walk: target/ beside Cargo.toml is build output; elsewhere it is a folder like any other', async () => {
  const root = await workspace();
  const s = await scanProject({ path: root });
  assert.ok(s.skippedDirs.includes('target'));
  assert.ok(!s.files || s.files < 15, `files: ${s.files}`);
  const plain = await tempDir('rp-target-');
  await writeTree(plain, { 'target/scene.tscn': '[gd_scene]\n', 'README.md': '# game\n' });
  const { files, skippedDirs } = await walk(plain);
  assert.deepEqual(skippedDirs, []);
  assert.ok(files.some(f => f.rel === 'target/scene.tscn'));
  const go = await tempDir('rp-vendor-');
  await writeTree(go, { 'go.mod': 'module x\n', 'vendor/dep/dep.go': 'package dep\n', 'main.go': 'package main\nfunc main() {}\n' });
  assert.deepEqual((await walk(go)).skippedDirs, ['vendor']);
});

test('graphMermaid: modules first, test files only when there is room', async () => {
  const root = await tempDir('rp-mermaid-');
  const tree = {};
  for (let i = 0; i < 4; i++) tree[`src/m${i}.mjs`] = `export const m${i} = 1;\n`;
  tree['src/hub.mjs'] = Array.from({ length: 4 }, (_, i) => `import { m${i} } from './m${i}.mjs';\n`).join('');
  // tests import everything, so by degree alone they would win
  for (let i = 0; i < 3; i++) tree[`test/t${i}.test.mjs`] = `import './../src/hub.mjs';\n${Array.from({ length: 4 }, (_, j) => `import '../src/m${j}.mjs';\n`).join('')}`;
  await writeTree(root, tree);
  const g = await buildGraph(root);
  const names = m => [...m.matchAll(/f\d+\["([^"]+)"\]/g)].map(x => x[1]);
  const small = names(graphMermaid(g, 5));
  assert.deepEqual(small.filter(n => n.includes('.test.')), []);
  assert.ok(small.includes('hub.mjs'));
  const all = names(graphMermaid(g, 20));
  assert.equal(all.filter(n => n.includes('.test.')).length, 3);
  assert.ok(isTestFile('tests/cli.rs') && isTestFile('a/b_test.go') && isTestFile('x/test_scan.py') && isTestFile('src/a.spec.ts'));
  assert.ok(!isTestFile('src/testutil.rs') && !isTestFile('src/contest.mjs'));
});

test('missing required choice lists the allowed values (issue #15)', async () => {
  await assert.rejects(callTool('re_case', {}), e => e.code === 'INVALID_ARGUMENT' && /^Missing action \(What to do\)\. One of: init, evidence, claim, .*remember\.$/.test(e.message));
  await assert.rejects(callTool('re_scan', {}), e => e.code === 'INVALID_ARGUMENT' && e.message === 'Missing path (Folder to scan).');
});
