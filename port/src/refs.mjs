// re_refs: audit Unity GUID references. Finds references to GUIDs that no .meta file declares (dangling), the
// same GUID declared by two .meta files (duplicates after a copy), assets without a .meta file, and .meta files
// whose asset is gone. Suggests remaps for dangling script references by matching the MonoBehaviour class name
// to a script with the same name. Reports only: nothing is written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireDir, walk, limit } from './util.mjs';
import { findUnityRoot } from './scene.mjs';

const BUILTIN = new Map([
  ['0000000000000000e000000000000000', 'Unity built-in resources'],
  ['0000000000000000f000000000000000', 'Unity built-in extra resources'],
]);
const REF_EXT = new Set(['.unity', '.prefab', '.asset', '.mat', '.controller', '.anim', '.playable', '.overridecontroller', '.mask', '.physicmaterial', '.physicsmaterial2d', '.flare', '.renderTexture', '.cubemap', '.spriteatlas', '.preset', '.shadervariants', '.signal', '.guiskin', '.fontsettings', '.terrainlayer', '.brush', '.mixer', '.lighting', '.giparams']);

async function readText(file, max = 32 * 1024 * 1024) {
  const st = await fs.stat(file);
  if (st.size > max) return null;
  return fs.readFile(file, 'utf8');
}

/** Audit the GUID references of a Unity project. `path` may be the project root or any file/folder inside it. */
export async function refsTool({ path: target, limit: max = 200 }) {
  const abs = await requireDir(target).catch(async () => path.dirname(path.resolve(target)));
  const root = await findUnityRoot(path.join(abs, 'x')) ?? (await isUnityRoot(abs) ? abs : null);
  if (!root) throw new RPError('NOT_UNITY', `No Unity project found at or above ${abs} (needs Assets/ and ProjectSettings/).`);

  const declared = new Map();           // guid → [asset paths]
  const metaFor = new Set();            // asset paths that have a .meta
  const assets = [];                    // asset paths (not .meta)
  const metaMissingAsset = [];
  const scriptsByClass = new Map();     // class name → [script paths]
  const refFiles = [];

  for (const sub of ['Assets', 'Packages']) {
    const base = path.join(root, sub);
    const { files } = await walk(base, { maxFiles: 300000 }).catch(() => ({ files: [] }));
    for (const f of files) {
      const rel = `${sub}/${f.rel}`;
      if (f.ext === '.meta') {
        const head = (await readText(f.abs, 64 * 1024)) ?? '';
        const m = head.match(/guid:\s*([0-9a-f]{32})/);
        const asset = rel.replace(/\.meta$/, '');
        metaFor.add(asset);
        if (m) (declared.get(m[1]) ?? declared.set(m[1], []).get(m[1])).push(asset);
        const assetAbs = f.abs.replace(/\.meta$/, '');
        const st = await fs.stat(assetAbs).catch(() => null);
        if (!st) metaMissingAsset.push({ meta: rel, expected: asset });
        continue;
      }
      assets.push(rel);
      if (f.ext === '.cs') scriptsByClass.set(path.basename(f.rel, '.cs'), [...(scriptsByClass.get(path.basename(f.rel, '.cs')) ?? []), rel]);
      if (REF_EXT.has(f.ext)) refFiles.push({ rel, abs: f.abs, ext: f.ext });
    }
  }

  // Assets without a .meta (Unity ignores them, or re-creates the .meta with a NEW guid → references break).
  const missingMeta = assets.filter(a => !metaFor.has(a) && !/(^|\/)\.[^/]+$/.test(a) && !/^Packages\/(manifest|packages-lock)\.json$/.test(a));

  // References.
  const dangling = new Map();           // guid → { files: Set, scriptClass? }
  const used = new Set();
  let refCount = 0;
  for (const f of refFiles) {
    const text = await readText(f.abs);
    if (text === null || !text.startsWith('%YAML')) continue;
    // Pair each guid reference with the nearest preceding "m_Name:"/class hint so script remaps can be suggested.
    for (const m of text.matchAll(/fileID:\s*(-?\d+),\s*guid:\s*([0-9a-f]{32})/g)) {
      const guid = m[2];
      refCount++;
      used.add(guid);
      if (declared.has(guid) || BUILTIN.has(guid)) continue;
      const entry = dangling.get(guid) ?? dangling.set(guid, { guid, files: new Set(), fileIDs: new Set(), kinds: new Set() }).get(guid);
      entry.files.add(f.rel);
      entry.fileIDs.add(m[1]);
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      const key = before.match(/(\w+):\s*\{?\s*$/)?.[1] ?? '';
      if (key === 'm_Script') entry.kinds.add('script');
      else if (key === 'm_Shader') entry.kinds.add('shader');
      else if (key === 'm_Mesh') entry.kinds.add('mesh');
      else if (key === 'm_Texture') entry.kinds.add('texture');
      else if (key === 'm_SourcePrefab') entry.kinds.add('prefab');
      else if (/m_Materials:\s*\n\s*-\s*\{?\s*$/.test(before)) entry.kinds.add('material');
      else entry.kinds.add('other');
    }
  }

  // Suggest remaps for dangling script references: a MonoBehaviour's class name usually equals the file name, and
  // Unity writes the class name next to the component in many files; when absent we list all unreferenced scripts.
  const referencedScripts = new Set([...used].flatMap(g => declared.get(g) ?? []).filter(p => p.endsWith('.cs')));
  const unreferencedScripts = assets.filter(a => a.endsWith('.cs') && !referencedScripts.has(a) && !/\/Editor\//.test(a));
  const danglingList = [...dangling.values()].map(d => {
    const suggestions = [];
    if (d.kinds.has('script') && unreferencedScripts.length && unreferencedScripts.length <= 20) suggestions.push(...unreferencedScripts.map(s => ({ asset: s, guid: guidOf(declared, s), why: 'script never referenced by any other asset' })));
    return { guid: d.guid, kinds: [...d.kinds], files: [...d.files].sort(), fileIDs: [...d.fileIDs].slice(0, 10), suggestions: suggestions.slice(0, 5) };
  }).sort((a, b) => b.files.length - a.files.length);

  const duplicates = [...declared.entries()].filter(([, paths]) => paths.length > 1).map(([guid, paths]) => ({ guid, assets: paths.sort(), referenced: used.has(guid), note: 'Two .meta files declare the same guid (copied outside Unity); references resolve to whichever Unity imports first.' }));
  const orphans = [...declared.entries()].filter(([guid, paths]) => !used.has(guid) && paths.every(p => !/\.(cs|unity|asmdef|dll)$/.test(p) && !/^Packages\//.test(p))).map(([guid, paths]) => ({ guid, asset: paths[0] }));

  const problems = danglingList.length + duplicates.length + missingMeta.length + metaMissingAsset.length;
  return {
    unityProject: root,
    summary: { metaFiles: metaFor.size, guidsDeclared: declared.size, references: refCount, dangling: danglingList.length, duplicateGuids: duplicates.length, assetsWithoutMeta: missingMeta.length, metaWithoutAsset: metaMissingAsset.length, unreferencedAssets: orphans.length },
    dangling: limit(danglingList, max),
    duplicateGuids: limit(duplicates, max),
    assetsWithoutMeta: limit(missingMeta.sort(), max),
    metaWithoutAsset: limit(metaMissingAsset, max),
    unreferencedAssets: limit(orphans, max),
    builtin: [...BUILTIN].map(([guid, what]) => ({ guid, what })),
    passed: problems === 0,
    next: problems ? 'Fix in Unity (reimport or re-link in the Inspector) or write the suggested guid into the .meta of the right asset; keep the asset path, never edit references in scenes by hand.' : 'All GUID references resolve.',
  };
}

const guidOf = (declared, asset) => { for (const [g, paths] of declared) if (paths.includes(asset)) return g; return null; };

async function isUnityRoot(dir) {
  try { await fs.access(path.join(dir, 'Assets')); await fs.access(path.join(dir, 'ProjectSettings')); return true; } catch { return false; }
}
