import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildZip, buildAxml, buildArsc, buildBplist, buildResStringPool, ANDROID_NS } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { parseAxml, manifestSummary, parseArsc, parseBinaryPlist, parseXmlPlist, parsePlist, infoPlistSummary, readStringPool, nativeLibsFromEntries } = await import('../src/mobile.mjs');
const { archiveTool } = await import('../src/archive.mjs');
const { saveTool, peel } = await import('../src/save.mjs');
const { identify } = await import('../src/formats.mjs');

// ---------------------------------------------------------------- Android
const A = { name: 0x01010003, label: 0x01010001, icon: 0x01010002, debuggable: 0x0101000f, exported: 0x01010010, minSdk: 0x0101020c, targetSdk: 0x01010270, versionCode: 0x0101021b, versionName: 0x0101021c, allowBackup: 0x01010280, cleartext: 0x010104ec, authorities: 0x01010018, configChanges: 0x0101001f, scheme: 0x01010027, value: 0x01010024 };
const named = (name, extra = []) => [{ name: 'name', resId: A.name, string: name }, ...extra];
const MANIFEST = {
  name: 'manifest',
  attrs: [{ name: 'versionCode', resId: A.versionCode, int: 42 }, { name: 'versionName', resId: A.versionName, ref: 0x7f030001 }, { name: 'package', string: 'com.example.game' }],
  children: [
    { name: 'uses-sdk', attrs: [{ name: 'minSdkVersion', resId: A.minSdk, int: 24 }, { name: 'targetSdkVersion', resId: A.targetSdk, int: 34 }] },
    { name: 'uses-permission', attrs: named('android.permission.INTERNET') },
    { name: 'uses-permission', attrs: named('android.permission.VIBRATE') },
    {
      name: 'application',
      attrs: [{ name: 'label', resId: A.label, ref: 0x7f030000 }, { name: 'icon', resId: A.icon, ref: 0x7f020000 }, { name: 'debuggable', resId: A.debuggable, bool: true }, { name: 'allowBackup', resId: A.allowBackup, bool: false }, { name: 'usesCleartextTraffic', resId: A.cleartext, bool: true }],
      children: [
        {
          name: 'activity', attrs: named('.MainActivity', [{ name: 'exported', resId: A.exported, bool: true }, { name: 'configChanges', resId: A.configChanges, hex: 0x4a0 }]),
          children: [
            { name: 'intent-filter', children: [{ name: 'action', attrs: named('android.intent.action.MAIN') }, { name: 'category', attrs: named('android.intent.category.LAUNCHER') }] },
            { name: 'intent-filter', children: [{ name: 'action', attrs: named('android.intent.action.VIEW') }, { name: 'data', attrs: [{ name: 'scheme', resId: A.scheme, string: 'examplegame' }] }] },
          ],
        },
        { name: 'activity', attrs: named('com.example.game.SettingsActivity', [{ name: 'exported', resId: A.exported, bool: false }]) },
        { name: 'service', attrs: named('.SyncService') },
        { name: 'receiver', attrs: named('.BootReceiver', [{ name: 'exported', resId: A.exported, bool: true }]), children: [{ name: 'intent-filter', children: [{ name: 'action', attrs: named('android.intent.action.BOOT_COMPLETED') }] }] },
        { name: 'provider', attrs: named('.FileProvider', [{ name: 'authorities', resId: A.authorities, string: 'com.example.game.files' }, { name: 'exported', resId: A.exported, bool: false }]) },
        { name: 'meta-data', attrs: named('unity.build-id', [{ name: 'value', resId: A.value, string: 'abc-123 <"&>' }]) },
      ],
    },
  ],
};
const ARSC = {
  types: [
    { name: 'attr', configs: [{ entries: { 0: { key: 'unused', int: 1 } } }] },
    { name: 'mipmap', configs: [{ entries: { 0: { key: 'ic_launcher', string: 'res/mipmap/ic_launcher.png' } } }] },
    {
      name: 'string', configs: [
        { language: 'de', entries: { 0: { key: 'app_name', string: 'Beispielspiel' } } },
        { entries: { 0: { key: 'app_name', ref: 0x7f030002 }, 1: { key: 'version', string: '1.4.2' }, 2: { key: 'real_name', string: 'Example Gäme ☃' }, 4: { key: 'tagline', string: 'x'.repeat(300) } } },
      ],
    },
  ],
};

for (const [label, opts] of [['UTF-16 pool', {}], ['UTF-8 pool', { utf8: true }], ['UTF-8 pool with stripped attribute names', { utf8: true, stripNames: true }]]) {
  test(`Android binary XML (${label}): readable XML and typed attributes`, () => {
    const { root, xml, utf8 } = parseAxml(buildAxml(MANIFEST, opts));
    assert.equal(utf8, !!opts.utf8);
    assert.equal(root.name, 'manifest');
    assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<manifest xmlns:android="http:\/\/schemas.android.com\/apk\/res\/android" android:versionCode="42" android:versionName="@0x7f030001" package="com.example.game">/);
    assert.match(xml, /<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" \/>/);
    assert.match(xml, /<activity android:name=".MainActivity" android:exported="true" android:configChanges="0x000004a0">/);
    assert.match(xml, /android:value="abc-123 &lt;&quot;&amp;&gt;"/);
    assert.match(xml, /<\/manifest>\n$/);
    const app = root.children.find(c => c.name === 'application');
    assert.deepEqual(app.attrs.debuggable, { kind: 'bool', value: true, text: 'true', ns: ANDROID_NS });
    assert.deepEqual(app.attrs.label, { kind: 'reference', value: '0x7f030000', text: '@0x7f030000', ns: ANDROID_NS });
  });
}

test('Android binary XML: other value types stay readable, unknown attribute ids keep their id', () => {
  const { xml } = parseAxml(buildAxml({ name: 'manifest', attrs: [{ name: 'a', type: 0x05, data: 0x1001 }, { name: 'b', type: 0x06, data: 0x7f }, { name: 'c', float: 1.5 }, { name: 'd', type: 0x1c, data: 0xff336699 }, { name: 'e', type: 0x02, data: 0x01010036 }, { name: 'f', ref: 0 }, { name: 'whatever', resId: 0x01019999, int: -3 }] }, { stripNames: true }));
  assert.match(xml, /a="dimension\(0x00001001\)" b="fraction\(0x0000007f\)" c="1.5" d="#ff336699" e="\?0x01010036" f="@null" android:attr_0x01019999="-3"/);
});

test('manifest summary: identity, sdk, flags, permissions, components and the launcher', () => {
  const table = parseArsc(buildArsc(ARSC));
  const s = manifestSummary(parseAxml(buildAxml(MANIFEST, { utf8: true, stripNames: true })).root, { resolve: table.resolve });
  assert.equal(s.package, 'com.example.game');
  assert.equal(s.versionCode, 42);
  assert.equal(s.versionName, '1.4.2');
  assert.equal(s.versionNameRef, '@0x7f030001');
  assert.equal(s.minSdk, 24);
  assert.equal(s.targetSdk, 34);
  assert.deepEqual(s.application, { labelRef: '@0x7f030000', label: 'Example Gäme ☃', iconRef: '@0x7f020000', icon: 'res/mipmap/ic_launcher.png' });
  assert.deepEqual(s.flags, { debuggable: true, allowBackup: false, usesCleartextTraffic: true });
  assert.deepEqual(s.permissions, ['android.permission.INTERNET', 'android.permission.VIBRATE']);
  assert.deepEqual(s.activities, [{ name: 'com.example.game.MainActivity', exported: true, intentFilters: 2, launcher: true, schemes: ['examplegame'] }, { name: 'com.example.game.SettingsActivity', exported: false }]);
  assert.deepEqual(s.services, [{ name: 'com.example.game.SyncService' }]);
  assert.deepEqual(s.receivers, [{ name: 'com.example.game.BootReceiver', exported: true, intentFilters: 1 }]);
  assert.deepEqual(s.providers, [{ name: 'com.example.game.FileProvider', exported: false, authorities: 'com.example.game.files' }]);
  assert.equal(s.launcherActivity, 'com.example.game.MainActivity');
  assert.deepEqual(s.counts, { activities: 2, services: 1, receivers: 1, providers: 1 });
  assert.deepEqual(s.engineMetaData, { 'unity.build-id': 'abc-123 <"&>' });
  // Without a resource table the references stay references; absent flags are null, not false.
  const bare = manifestSummary(parseAxml(buildAxml({ name: 'manifest', attrs: [{ name: 'package', string: 'a.b' }], children: [{ name: 'application', attrs: [{ name: 'label', resId: A.label, ref: 0x7f030000 }] }] })).root);
  assert.deepEqual(bare.application, { labelRef: '@0x7f030000' });
  assert.deepEqual(bare.flags, { debuggable: false, allowBackup: null, usesCleartextTraffic: null });
  assert.equal(bare.launcherActivity, null);
  // Flags given as @bool references are looked up in the table.
  const refs = { name: 'manifest', attrs: [{ name: 'package', string: 'a.b' }], children: [{ name: 'application', attrs: [{ name: 'allowBackup', resId: A.allowBackup, ref: 0x7f010000 }, { name: 'debuggable', resId: A.debuggable, ref: 0x7f010001 }] }] };
  const bools = parseArsc(buildArsc({ types: [{ name: 'bool', configs: [{ entries: { 0: { key: 'backup', bool: false }, 1: { key: 'debug', bool: true } } }] }] }));
  assert.deepEqual(manifestSummary(parseAxml(buildAxml(refs)).root, { resolve: bools.resolve }).flags, { debuggable: true, allowBackup: false, usesCleartextTraffic: null });
  assert.deepEqual(manifestSummary(parseAxml(buildAxml(refs)).root).flags, { debuggable: false, allowBackup: '@0x7f010000', usesCleartextTraffic: null });
});

test('resources.arsc: pools, counts per type, default configuration and the string limit', () => {
  for (const utf8 of [true, false]) {
    const t = parseArsc(buildArsc({ ...ARSC, utf8 }), { limit: 2 });
    assert.deepEqual(t.packages, [{ id: 0x7f, name: 'com.example.game', configurations: 4, types: { attr: 1, mipmap: 1, string: 4 } }]);
    assert.equal(t.globalStrings, 5);
    assert.equal(t.resolve('@0x7f030000'), 'Example Gäme ☃', 'default config wins over de, and the reference is followed');
    assert.equal(t.resolve(0x7f030001), '1.4.2');
    assert.equal(t.resolve('@0x7f010000'), 1);
    assert.equal(t.resolve('@0x7f030003'), undefined, 'a hole in the entry table');
    assert.equal(t.resolve('@0x7f0f0000'), undefined);
    assert.equal(t.nameOf('@0x7f030001'), 'version');
    assert.equal(t.stringsTotal, 4);
    assert.equal(t.strings.length, 2);
    assert.deepEqual(t.strings[0], { id: '0x7f020000', name: 'ic_launcher', value: 'res/mipmap/ic_launcher.png' });
    assert.equal(parseArsc(buildArsc({ ...ARSC, utf8 })).strings, undefined);
    const all = parseArsc(buildArsc({ ...ARSC, utf8 }), { limit: 100 }).strings;
    assert.equal(all.find(x => x.name === 'tagline').value.length, 198, 'long values are clipped');
  }
  // Only a localized config: still resolved, from the first configuration that has the entry.
  const de = parseArsc(buildArsc({ types: [{ name: 'string', configs: [{ language: 'de', entries: { 0: { key: 'app_name', string: 'Nur Deutsch' } } }] }] }));
  assert.equal(de.resolve('@0x7f010000'), 'Nur Deutsch');
});

test('string pool: long strings use the two-unit length in both encodings', () => {
  // UTF-8 lengths hold 15 bits (two bytes); UTF-16 lengths go past 0x7fff with two units.
  for (const utf8 of [true, false]) {
    const long = 'é'.repeat(200) + 'x'.repeat(utf8 ? 20000 : 40000);
    const pool = readStringPool(buildResStringPool(['', 'a', long], { utf8 }), 0);
    assert.equal(pool.count, 3);
    assert.equal(pool.get(0), '');
    assert.equal(pool.get(1), 'a');
    assert.equal(pool.get(2), long);
    assert.equal(pool.get(3), null);
  }
});

test('damaged Android files stop with BAD_FORMAT, never a RangeError', () => {
  const axml = buildAxml(MANIFEST), arsc = buildArsc(ARSC);
  const isBad = e => e.code === 'BAD_FORMAT';
  assert.throws(() => parseAxml(Buffer.from('<?xml version="1.0"?><manifest/>')), isBad);
  assert.throws(() => parseAxml(axml.subarray(0, axml.length - 40)), isBad);
  assert.throws(() => parseArsc(arsc.subarray(0, 200)), isBad);
  assert.throws(() => parseArsc(axml), isBad);
  for (const [buf, parse] of [[axml, parseAxml], [arsc, parseArsc]]) {
    for (let i = 8; i < buf.length; i += 3) {
      const copy = Buffer.from(buf); copy[i] ^= 0xff; copy[i + 1 < copy.length ? i + 1 : i] = 0xff;
      try { const r = parse(copy); if (r.resolve) r.resolve('@0x7f030000'); } catch (e) { assert.equal(e.code, 'BAD_FORMAT', `byte ${i}: ${e.stack}`); }
    }
  }
});

test('re_archive on an .apk adds the android block; manifest:true adds the XML', async () => {
  const file = path.join(dir, 'game.apk');
  await fs.writeFile(file, buildZip({
    'AndroidManifest.xml': buildAxml(MANIFEST, { utf8: true }), 'resources.arsc': buildArsc(ARSC), 'classes.dex': 'dex\n035\0', 'classes2.dex': 'dex\n035\0',
    'lib/arm64-v8a/libunity.so': 'x', 'lib/arm64-v8a/libil2cpp.so': 'x', 'lib/armeabi-v7a/libunity.so': 'x', 'assets/bin/Data/data.unity3d': 'x',
  }));
  const list = await archiveTool({ file });
  assert.equal(list.format, 'zip');
  assert.equal(list.totalEntries, 8);
  const a = list.android;
  assert.equal(a.package, 'com.example.game');
  assert.equal(a.versionName, '1.4.2');
  assert.equal(a.application.label, 'Example Gäme ☃');
  assert.equal(a.launcherActivity, 'com.example.game.MainActivity');
  assert.deepEqual(a.nativeLibs, { abis: ['arm64-v8a', 'armeabi-v7a'], libraries: ['libil2cpp.so', 'libunity.so'] });
  assert.equal(a.dexFiles, 2);
  assert.deepEqual(a.resources, { packages: [{ id: 0x7f, name: 'com.example.game', configurations: 4, types: { attr: 1, mipmap: 1, string: 4 } }], globalStrings: 5 });
  assert.equal(a.manifestXml, undefined);
  assert.equal(list.ios, undefined);
  const full = await archiveTool({ file, manifest: true, resourceStrings: 3 });
  assert.match(full.android.manifestXml, /<application android:label="@0x7f030000"/);
  assert.equal(full.android.resources.strings.length, 3);
  assert.equal(full.android.resources.stringsTotal, 4);
  // No resource table: the references stay, the listing still works.
  const noTable = path.join(dir, 'bare.apk');
  await fs.writeFile(noTable, buildZip({ 'AndroidManifest.xml': buildAxml(MANIFEST) }));
  const bare = (await archiveTool({ file: noTable })).android;
  assert.equal(bare.versionNameRef, '@0x7f030001');
  assert.equal(bare.versionName, undefined);
  assert.deepEqual(bare.nativeLibs, { abis: [], libraries: [] });
  // A damaged manifest is reported inside the block; the listing itself still answers.
  const broken = path.join(dir, 'broken.apk');
  await fs.writeFile(broken, buildZip({ 'AndroidManifest.xml': buildAxml(MANIFEST).subarray(0, 300), 'a.txt': 'x' }));
  const b = await archiveTool({ file: broken });
  assert.equal(b.totalEntries, 2);
  assert.match(b.android.error, /chunk/);
  // A plain zip gets neither block; a text manifest in a non-apk zip is left alone.
  const plain = path.join(dir, 'src.zip');
  await fs.writeFile(plain, buildZip({ 'AndroidManifest.xml': '<manifest package="x"/>', 'a.txt': 'x' }));
  const p = await archiveTool({ file: plain });
  assert.equal(p.android, undefined);
  assert.equal(p.ios, undefined);
  assert.deepEqual(nativeLibsFromEntries(['lib/x86/liba.so', 'lib/x86/deep/libb.so', 'libs/x86/libc.so']), { abis: ['x86'], libraries: ['liba.so'] });
});

// ---------------------------------------------------------------- property lists
const WHEN = new Date(Date.UTC(2024, 0, 31, 12, 0, 0));
const PREFS = { gold: 1500, name: 'Hero', ratio: 0.25, muted: true, fullscreen: false, saved_at: WHEN, blob: Buffer.from([0, 1, 2, 255]), items: ['sword', 'shield', 3], nested: { level: 7, neg: -5, big: 2 ** 40 }, title: 'Héros ☃', long: 'a string of more than fifteen chars' };
const PREFS_PARSED = { gold: 1500, name: 'Hero', ratio: 0.25, muted: true, fullscreen: false, saved_at: { $plist_type: 'date', iso8601: '2024-01-31T12:00:00Z' }, blob: { $plist_type: 'data', base64: 'AAEC/w==' }, items: ['sword', 'shield', 3], nested: { level: 7, neg: -5, big: 2 ** 40 }, title: 'Héros ☃', long: 'a string of more than fifteen chars' };
// The same dictionary written by Python's plistlib (FMT_BINARY, sort_keys=False): cross-checks the test encoder.
const PLISTLIB_BINARY = 'YnBsaXN0MDDbAQIDBAUGBwgJCgsMDQ4PEBESExceH1Rnb2xkVG5hbWVVcmF0aW9VbXV0ZWRaZnVsbHNjcmVlblhzYXZlZF9hdFRibG9iVWl0ZW1zVm5lc3RlZFV0aXRsZVRsb25nEQXcVEhlcm8jP9AAAAAAAAAJCDNBxbU24AAAAEQAAQL/oxQVFlVzd29yZFZzaGllbGQQA9MYGRobHB1VbGV2ZWxTbmVnU2JpZxAHE//////////7EwAAAQAAAAAAZwBIAOkAcgBvAHMAICYDXxAjYSBzdHJpbmcgb2YgbW9yZSB0aGFuIGZpZnRlZW4gY2hhcnMIHyQpLzVASU5UW2FmaW53eHmCh4uRmJqhp6uvsbrD0gAAAAAAAAEBAAAAAAAAACAAAAAAAAAAAAAAAAAAAAD4';
const PREFS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>gold</key>
	<integer>1500</integer>
	<key>name</key>
	<string>Hero</string>
	<key>ratio</key>
	<real>0.25</real>
	<key>muted</key>
	<true/>
	<key>fullscreen</key>
	<false/>
	<key>saved_at</key>
	<date>2024-01-31T12:00:00Z</date>
	<key>blob</key>
	<data>
	AAEC/w==
	</data>
	<key>items</key>
	<array>
		<string>sword</string>
		<string>shield</string>
		<integer>3</integer>
	</array>
	<key>nested</key>
	<dict>
		<key>level</key>
		<integer>7</integer>
		<key>neg</key>
		<integer>-5</integer>
		<key>big</key>
		<integer>1099511627776</integer>
	</dict>
	<key>title</key>
	<string>Héros ☃</string>
	<key>long</key>
	<string>a string of more than fifteen chars</string>
</dict>
</plist>
`;

test('binary plist: every object type, read through the offset table', () => {
  assert.deepEqual(parseBinaryPlist(buildBplist(PREFS)), PREFS_PARSED);
  assert.deepEqual(parseBinaryPlist(Buffer.from(PLISTLIB_BINARY, 'base64')), PREFS_PARSED);
  assert.equal(buildBplist(PREFS).length, Buffer.from(PLISTLIB_BINARY, 'base64').length, 'the test encoder lays the file out as plistlib does');
  const odd = parseBinaryPlist(buildBplist({ nothing: null, uid: { uid: 7 }, set: new Set(['a', 'b']), huge: 2n ** 63n - 1n, min: -(2n ** 63n), u32: 4294967295, empty: '', none: [], real: { real: 3 }, many: Array.from({ length: 20 }, (_, i) => i) }));
  assert.deepEqual(odd, { nothing: null, uid: { $plist_type: 'uid', value: 7 }, set: ['a', 'b'], huge: { $plist_type: 'integer', decimal: '9223372036854775807' }, min: { $plist_type: 'integer', decimal: '-9223372036854775808' }, u32: 4294967295, empty: '', none: [], real: 3, many: Array.from({ length: 20 }, (_, i) => i) });
  // More than 255 objects: two-byte references and offsets.
  const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, i * 1000]));
  assert.deepEqual(parseBinaryPlist(buildBplist(wide)), wide);
  assert.deepEqual(parseBinaryPlist(buildBplist('just a string')), 'just a string');
  assert.deepEqual(Object.keys(parseBinaryPlist(buildBplist({ ['__proto__']: 1, ok: 2 }))), ['__proto__', 'ok']);
});

test('XML plist: same values as the binary form, tolerant of comments, CDATA and entities', () => {
  assert.deepEqual(parseXmlPlist(PREFS_XML), PREFS_PARSED);
  assert.deepEqual(parsePlist(Buffer.from(PREFS_XML)), PREFS_PARSED);
  assert.deepEqual(parsePlist(Buffer.from('﻿' + PREFS_XML, 'utf16le')), PREFS_PARSED);
  const loose = parseXmlPlist('<plist><!-- hi --><dict><key>a &amp; b</key><string><![CDATA[<raw> & text]]></string><key>e</key><string>&lt;x&gt; &#233;&#x2603; &unknown;</string><key>big</key><integer>18446744073709551615</integer><key>empty</key><string/><key>d</key><dict/><key>l</key><array/><key>t</key><true></true><key>r</key><real>1e3</real></dict></plist>');
  assert.deepEqual(loose, { 'a & b': '<raw> & text', e: '<x> é☃ &unknown;', big: { $plist_type: 'integer', decimal: '18446744073709551615' }, empty: '', d: {}, l: [], t: true, r: 1000 });
  assert.deepEqual(parseXmlPlist('<array><integer>1</integer><string>two</string></array>'), [1, 'two']);
  for (const text of ['<plist version="1.0"></plist>', '<plist><dict><key>a</key></dict></plist>', '<plist><dict><string>no key</string></dict></plist>', '<plist><dict><key>a</key><integer>12x</integer></dict></plist>', '<plist><array><string>open', `<plist>${'<array>'.repeat(100)}`]) assert.throws(() => parseXmlPlist(text), e => e.code === 'BAD_FORMAT', text.slice(0, 50));
  assert.throws(() => parsePlist(Buffer.from('<html></html>')), e => e.code === 'BAD_FORMAT');
});

test('damaged binary plists stop with a clear reason', () => {
  const good = buildBplist(PREFS);
  const t = good.length - 32;
  const patch = fn => { const b = Buffer.from(good); fn(b); return b; };
  const cases = [
    [patch(b => b.writeBigUInt64BE(BigInt(good.length + 100), t + 24)), /offset table lies outside the file/],
    [patch(b => { b[t + 6] = 0; }), /impossible offset size/],
    [patch(b => { b[t + 7] = 9; }), /object-reference size/],
    [patch(b => b.writeBigUInt64BE(99n, t + 16)), /top object 99 is past the object count/],
    [patch(b => b.writeBigUInt64BE(10n ** 12n, t + 8)), /claims 1000000000000 objects/],
    [patch(b => { b[9] = 200; }), /object reference 200 is past the object count/], // first key ref of the top dict
    [good.subarray(0, 30), /too short/],
    [Buffer.from('not a plist at all, really'), /no bplist header/],
  ];
  for (const [buf, re] of cases) assert.throws(() => parseBinaryPlist(buf), e => e.code === 'BAD_FORMAT' && re.test(e.message), String(re));
  // An array that contains itself: object 0 is an array whose only element is object 0.
  const loop = Buffer.concat([Buffer.from('bplist00'), Buffer.from([0xa1, 0x00]), Buffer.from([8]), Buffer.alloc(6), Buffer.from([1, 1]), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), Buffer.alloc(8), Buffer.from([0, 0, 0, 0, 0, 0, 0, 10])]);
  assert.throws(() => parseBinaryPlist(loop), e => e.code === 'BAD_FORMAT' && /contains itself/.test(e.message));
  // Two arrays that fan out to each other ten levels deep would expand to 16^10 values: stopped by the budget.
  const levels = 10, fan = 16;
  const objs = Array.from({ length: levels }, (_, i) => Buffer.from([0xaf, 0x10, fan, ...Array(fan).fill(i + 1)]));
  objs.push(Buffer.from([0x09]));
  let at = 8; const offs = objs.map(o => { const x = at; at += o.length; return x; });
  const bomb = Buffer.concat([Buffer.from('bplist00'), ...objs, Buffer.from(offs), Buffer.alloc(6), Buffer.from([1, 1]), Buffer.from([0, 0, 0, 0, 0, 0, 0, objs.length]), Buffer.alloc(8), Buffer.from([0, 0, 0, 0, 0, 0, 0, at])]);
  assert.throws(() => parseBinaryPlist(bomb), e => e.code === 'BAD_FORMAT' && /more than a million/.test(e.message));
  // Any single damaged byte: BAD_FORMAT or a value, never another error.
  for (let i = 8; i < good.length; i++) {
    const copy = Buffer.from(good); copy[i] ^= 0xff;
    try { parseBinaryPlist(copy); } catch (e) { assert.equal(e.code, 'BAD_FORMAT', `byte ${i}: ${e.stack}`); }
  }
});

const INFO = {
  CFBundleIdentifier: 'com.example.game', CFBundleName: 'Game', CFBundleDisplayName: 'Example Game', CFBundleShortVersionString: '1.4.2', CFBundleVersion: '42', CFBundleExecutable: 'Game',
  MinimumOSVersion: '13.0', CFBundleSupportedPlatforms: ['iPhoneOS'], UIDeviceFamily: [1, 2], UIRequiredDeviceCapabilities: ['arm64', 'metal'],
  CFBundleURLTypes: [{ CFBundleURLName: 'main', CFBundleURLSchemes: ['examplegame', 'fb1234'] }, { CFBundleURLSchemes: ['examplegame'] }],
  NSCameraUsageDescription: 'Scan codes', NSMicrophoneUsageDescription: 'Voice chat', NSAppTransportSecurity: { NSAllowsArbitraryLoads: true }, LSApplicationQueriesSchemes: ['fb'], UIBackgroundModes: ['audio'],
};
const INFO_SUMMARY = {
  bundleId: 'com.example.game', name: 'Game', displayName: 'Example Game', version: '1.4.2', build: '42', executable: 'Game', minimumOS: '13.0', platforms: ['iPhoneOS'], deviceFamily: [1, 2],
  requiredCapabilities: ['arm64', 'metal'], urlSchemes: ['examplegame', 'fb1234'], queriesSchemes: ['fb'], permissions: { NSCameraUsageDescription: 'Scan codes', NSMicrophoneUsageDescription: 'Voice chat' }, allowsArbitraryLoads: true, backgroundModes: ['audio'],
};

test('Info.plist summary and re_archive on an .ipa', async () => {
  assert.deepEqual(infoPlistSummary(parseBinaryPlist(buildBplist(INFO))), INFO_SUMMARY);
  assert.deepEqual(infoPlistSummary({ LSMinimumSystemVersion: '10.15', CFBundleIdentifier: 'a.b' }), { bundleId: 'a.b', minimumOS: '10.15', urlSchemes: [], permissions: {} });
  assert.throws(() => infoPlistSummary(['x']), e => e.code === 'BAD_FORMAT');
  const file = path.join(dir, 'game.ipa');
  await fs.writeFile(file, buildZip({
    'Payload/Game.app/Info.plist': buildBplist(INFO), 'Payload/Game.app/Game': 'x', 'Payload/Game.app/Frameworks/UnityFramework.framework/UnityFramework': 'x',
    'Payload/Game.app/Frameworks/UnityFramework.framework/Info.plist': buildBplist({ CFBundleIdentifier: 'com.unity3d.framework' }), 'Payload/Game.app/Frameworks/libswiftCore.dylib': 'x',
  }));
  const list = await archiveTool({ file });
  assert.deepEqual(list.ios, { app: 'Payload/Game.app', ...INFO_SUMMARY, frameworks: ['UnityFramework', 'libswiftCore'] });
  assert.equal(list.android, undefined);
  const full = await archiveTool({ file, manifest: true });
  assert.deepEqual(full.ios.infoPlist, INFO);
  // XML Info.plist, and a damaged one.
  const xmlIpa = path.join(dir, 'xml.ipa');
  await fs.writeFile(xmlIpa, buildZip({ 'Payload/X.app/Info.plist': '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.x</string><key>NSLocationWhenInUseUsageDescription</key><string>Nearby</string></dict></plist>' }));
  assert.deepEqual((await archiveTool({ file: xmlIpa })).ios, { app: 'Payload/X.app', bundleId: 'com.x', urlSchemes: [], permissions: { NSLocationWhenInUseUsageDescription: 'Nearby' } });
  const badIpa = path.join(dir, 'bad.ipa');
  await fs.writeFile(badIpa, buildZip({ 'Payload/X.app/Info.plist': buildBplist(INFO).subarray(0, 60) }));
  assert.match((await archiveTool({ file: badIpa })).ios.error, /plist/);
});

// ---------------------------------------------------------------- re_save and identify
test('re_save reads binary and XML property lists as layers with the same fields', async () => {
  const bin = path.join(dir, 'unity.game.plist'), xml = path.join(dir, 'unity.game.xml.plist');
  await fs.writeFile(bin, buildBplist(PREFS));
  await fs.writeFile(xml, PREFS_XML);
  const b = await saveTool({ file: bin }), x = await saveTool({ file: xml });
  assert.deepEqual(b.layers, ['bplist']);
  assert.deepEqual(x.layers, ['plist-xml']);
  assert.deepEqual(b.fields, x.fields);
  const field = p => b.fields.items.find(f => f.path === p);
  assert.deepEqual(field('gold'), { path: 'gold', type: 'number', sample: 1500, role: 'currency' });
  assert.deepEqual(field('muted'), { path: 'muted', type: 'boolean', sample: true });
  assert.deepEqual(field('saved_at'), { path: 'saved_at', type: 'date', sample: '2024-01-31T12:00:00Z', role: 'time' });
  assert.deepEqual(field('blob'), { path: 'blob', type: 'data', sample: '4 bytes' });
  assert.deepEqual(field('items'), { path: 'items', type: 'array', length: 3, sample: ['sword', 'shield', 3] });
  assert.deepEqual(field('nested.level'), { path: 'nested.level', type: 'number', sample: 7, role: 'progress' });
  assert.equal(field('title').sample, 'Héros ☃');
  assert.deepEqual(b.roles.currency, ['gold']);
  // compare: a changed number and a changed date are one change each.
  const later = path.join(dir, 'later.plist');
  await fs.writeFile(later, buildBplist({ ...PREFS, gold: 1750, saved_at: new Date(WHEN.getTime() + 60000) }));
  const cmp = await saveTool({ file: bin, compare: later });
  assert.deepEqual(cmp.compare.changed.items, [{ path: 'gold', before: 1500, after: 1750 }, { path: 'saved_at', before: { $plist_type: 'date', iso8601: '2024-01-31T12:00:00Z' }, after: { $plist_type: 'date', iso8601: '2024-01-31T12:01:00Z' } }]);
  // schema: dates and data are strings with a format, not sub-objects.
  const out = path.join(dir, 'schema-out');
  const s = await saveTool({ file: xml, action: 'schema', out });
  assert.deepEqual(s.layersToReproduce, ['plist-xml']);
  const schema = JSON.parse(await fs.readFile(path.join(out, 'unity.game.xml.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.saved_at, { type: 'string', format: 'date-time' });
  assert.deepEqual(schema.properties.blob, { type: 'string', contentEncoding: 'base64' });
  assert.deepEqual(schema.properties.gold, { type: 'integer' });
  assert.match(await fs.readFile(path.join(out, 'SaveData.gd'), 'utf8'), /var gold: int/);
  // gzip around a plist is peeled first.
  const { default: zlib } = await import('node:zlib');
  assert.deepEqual(peel(zlib.gzipSync(buildBplist(PREFS))).layers, ['gzip', 'bplist']);
  // A damaged plist names the reason and falls back to strides and strings.
  const broken = path.join(dir, 'broken.plist');
  const bytes = buildBplist(PREFS); bytes.writeBigUInt64BE(BigInt(bytes.length + 5), bytes.length - 8);
  await fs.writeFile(broken, bytes);
  const d = await saveTool({ file: broken });
  assert.deepEqual(d.layers, ['bplist']);
  assert.match(d.stopped, /offset table lies outside the file/);
  assert.equal(d.fields, undefined);
  assert.ok(Array.isArray(d.strides));
  // Other XML keeps going to the shallow reader.
  assert.deepEqual(peel(Buffer.from('<?xml version="1.0"?><save><gold>5</gold><name>Hero</name></save>')).layers, ['xml']);
});

test('identify names Android binary XML, resource tables and property lists', () => {
  assert.equal(identify(buildAxml(MANIFEST)).id, 'android-axml');
  assert.equal(identify(buildArsc(ARSC)).id, 'android-arsc');
  assert.deepEqual(identify(buildBplist(PREFS)), { id: 'bplist', name: 'Apple binary property list (bplist)', category: 'data' });
  assert.equal(identify(Buffer.from(PREFS_XML)).id, 'plist-xml');
  assert.equal(identify(Buffer.from('<?xml version="1.0"?><save/>')).id, 'xml');
  assert.equal(identify(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0])).id, 'ico');
});
