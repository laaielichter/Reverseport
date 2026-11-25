// re_binary detection: PE resources, Rich header, packers/protectors/installers/compilers, capabilities,
// ELF notes and DWARF, Mach-O load commands and code signature, WebAssembly names. All fixtures are built in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  tempDir, buildDotNetDll, buildWasm, buildPe, buildVersionResource, buildGroupIcon, buildStringBlock, buildElf, elfNote,
  elfDynamicSections, elfSymtabSections, elfDwarfSections, buildMachO, buildWasmWithNames,
} from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { inspectBinary, parseWasm } = await import('../src/binary.mjs');
const { parseRichHeader, CAPABILITY_NOTE } = await import('../src/bindetect.mjs');

let n = 0;
async function inspect(buf, options = {}) {
  const file = path.join(dir, `sample-${n++}.bin`);
  await fs.writeFile(file, buf);
  return inspectBinary({ file, ...options });
}
const text = { name: '.text', data: Buffer.alloc(64, 0x90) };
const rdata = s => ({ name: '.rdata', data: Buffer.concat([Buffer.alloc(4), Buffer.from(s, 'latin1'), Buffer.alloc(4)]) });
const named = names => names.map(name => ({ name, data: Buffer.alloc(16, 1) }));
const find = (r, name) => r.detected.find(d => d.name === name);
const MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="Example.Game" version="2.5.0.0" processorArchitecture="x86"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
  </requestedPrivileges></security></trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
  </windowsSettings></application>
  <dependency><dependentAssembly>
    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
  </dependentAssembly></dependency>
</assembly>`;
const manifestResource = xml => ({ type: 24, items: [{ name: 1, data: Buffer.from(xml) }] });
const versionResource = strings => ({ type: 16, items: [{ name: 1, data: buildVersionResource({ fileVersion: [2, 5, 0, 117], productVersion: [2, 5, 0, 0], strings }) }] });

// ---------------------------------------------------------------- plain binaries: nothing detected
test('plain PE, ELF and Mach-O files get no detections and no capabilities', async () => {
  for (const buf of [buildPe(), buildElf(), buildMachO()]) {
    const r = await inspect(buf);
    assert.deepEqual(r.detected, [], `${r.binary.format}: ${JSON.stringify(r.detected)}`);
    assert.deepEqual(r.capabilities, []);
    assert.match(r.capabilitiesNote, /import table and strings only/);
  }
  const pe = (await inspect(buildPe())).binary;
  assert.equal(pe.richHeader, undefined);
  assert.equal(pe.resources, undefined);
  assert.equal(pe.msvcRichHeader, false);
  const wasm = await inspect(buildWasm());
  assert.equal(wasm.detected, undefined);
});

test('a PE with ordinary imports, resources and a Rich header is not called packed or protected', async () => {
  const r = await inspect(buildPe({
    sections: [text, rdata('Hello world, this is an ordinary program.')], imports: { 'KERNEL32.dll': ['GetLastError', 'ExitProcess'] },
    resources: [versionResource({ CompanyName: 'Example Ltd', ProductName: 'Example Game' }), manifestResource(MANIFEST)], rich: [{ id: 0x105, build: 29112, count: 4 }, { id: 0x102, build: 29112, count: 1 }],
  }));
  assert.deepEqual(r.detected.map(d => d.kind).sort(), ['compiler', 'linker']);
  assert.deepEqual(r.capabilities, []);
});

// ---------------------------------------------------------------- PE resources
test('PE resources: version info, manifest, icons, type counts and string tables', async () => {
  const strings = { CompanyName: 'Example Ltd', ProductName: 'Example Game', OriginalFilename: 'game.exe', FileDescription: 'Example Game Launcher', LegalCopyright: '© 2024 Example Ltd' };
  const buf = buildPe({ resources: [
    { type: 3, items: [{ name: 1, data: Buffer.alloc(40) }, { name: 2, data: Buffer.alloc(80) }] },
    { type: 14, items: [{ name: 'MAINICON', data: buildGroupIcon([[32, 32, 32, 4264], [0, 0, 32, 20000]]) }] },
    versionResource(strings), manifestResource(MANIFEST),
    { type: 6, items: [{ name: 2, data: buildStringBlock(['Start game', '', 'Quit', 'Options']) }] },
    { type: 10, items: [{ name: 'SETTINGS', data: Buffer.from('k=v') }] },
    { type: 'TYPELIB', items: [{ name: 1, data: Buffer.alloc(8) }] },
  ] });
  const res = (await inspect(buf)).binary.resources;
  assert.equal(res.count, 8);
  const types = Object.fromEntries(res.types.map(t => [t.type, t]));
  assert.deepEqual(Object.keys(types).sort(), ['"TYPELIB"', 'RT_GROUP_ICON', 'RT_ICON', 'RT_MANIFEST', 'RT_RCDATA', 'RT_STRING', 'RT_VERSION']);
  assert.deepEqual([types.RT_ICON.count, types.RT_ICON.bytes, types.RT_ICON.names], [2, 120, [1, 2]]);
  assert.deepEqual(types.RT_RCDATA.names, ['SETTINGS']);
  assert.equal(res.version.fileVersion, '2.5.0.117');
  assert.equal(res.version.productVersion, '2.5.0.0');
  assert.equal(res.version.fileType, 'application');
  assert.deepEqual(res.version.strings, strings);
  assert.deepEqual(res.version.translations, [{ language: 0x409, codePage: 1200 }]);
  assert.equal(res.manifest.requestedExecutionLevel, 'requireAdministrator');
  assert.equal(res.manifest.uiAccess, 'false');
  assert.equal(res.manifest.dpiAware, 'true/pm');
  assert.equal(res.manifest.dpiAwareness, 'PerMonitorV2');
  assert.deepEqual(res.manifest.identity, { name: 'Example.Game', version: '2.5.0.0', processorArchitecture: 'x86' });
  assert.deepEqual(res.manifest.dependencies, [{ name: 'Microsoft.Windows.Common-Controls', version: '6.0.0.0' }]);
  assert.ok(res.manifest.text.startsWith('<?xml'));
  assert.deepEqual(res.icons, [{ group: 'MAINICON', count: 2, images: [{ width: 32, height: 32, bitCount: 32, bytes: 4264 }, { width: 256, height: 256, bitCount: 32, bytes: 20000 }] }]);
  assert.equal(res.stringTables.blocks, 1);
  assert.equal(res.stringTables.strings, 3);
  assert.equal(res.stringTables.items, undefined, 'strings are listed on request only');

  const listed = (await inspect(buf, { resources: { strings: true, limit: 2 } })).binary.resources.stringTables;
  assert.deepEqual(listed.items, [{ id: 16, lang: 1033, text: 'Start game' }, { id: 18, lang: 1033, text: 'Quit' }]);
  assert.equal(listed.more, 1);
});

test('PE resources: a damaged directory is reported, not thrown', async () => {
  const buf = buildPe({ resources: [manifestResource(MANIFEST)] });
  const rsrc = buf.indexOf(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 24, 0, 0, 0]));
  buf.writeUInt32LE(0x80ffff00, rsrc + 20); // type directory far outside the section
  const r = await inspect(buf);
  assert.equal(r.binary.format, 'pe');
  assert.equal(r.binary.resources.count, 0);
  assert.match(r.binary.resources.warnings.join(), /outside the resource section/);
});

// ---------------------------------------------------------------- Rich header
test('Rich header: records, Visual Studio mapping and checksum', async () => {
  const rich = [{ id: 0x105, build: 29112, count: 12 }, { id: 0x104, build: 29112, count: 3 }, { id: 0x102, build: 29112, count: 1 }, { id: 0x01, build: 0, count: 77 }, { id: 0x1234, build: 99, count: 2 }];
  const good = (await inspect(buildPe({ rich }))).binary;
  assert.equal(good.msvcRichHeader, true);
  assert.equal(good.richHeader.checksumValid, true);
  assert.equal(good.richHeader.note, undefined);
  assert.deepEqual(good.richHeader.records[0], { productId: 0x105, build: 29112, count: 12, tool: 'C++ compiler', visualStudio: 'Visual Studio 2019 (MSVC 14.2x)' });
  assert.deepEqual(good.richHeader.records[3], { productId: 1, build: 0, count: 77, tool: 'imported symbols' });
  assert.deepEqual(good.richHeader.records[4], { productId: 0x1234, build: 99, count: 2 }, 'unknown ids stay raw numbers');
  assert.equal(good.richHeader.toolchain, 'Visual Studio 2019 (MSVC 14.2x)');

  const bad = (await inspect(buildPe({ rich, richTamper: true }))).binary.richHeader;
  assert.equal(bad.checksumValid, false);
  assert.match(bad.note, /checksum does not match/);
  assert.equal(bad.records.length, 5, 'records are still decoded');

  const years = [[0x105, 23026, /2015/], [0x105, 25017, /2017/], [0x104, 30159, /2019/], [0x105, 31933, /2022 or later/], [0x84, 30729, /2008/], [0xab, 40219, /2010/], [0xcf, 50727, /2012/], [0xe1, 21005, /2013/], [0x6e, 50727, /2005/], [0x60, 3077, /2003/], [0x0b, 8168, /6\.0/]];
  for (const [id, build, re] of years) {
    const buf = buildPe({ rich: [{ id, build, count: 1 }] });
    assert.match(parseRichHeader(buf, buf.readUInt32LE(0x3c)).records[0].visualStudio, re, `id ${id} build ${build}`);
  }
  const odd = buildPe({ rich: [{ id: 0x105, build: 12, count: 1 }] });
  assert.equal(parseRichHeader(odd, odd.readUInt32LE(0x3c)).records[0].visualStudio, undefined, 'a build outside the known ranges gets no label');
});

// ---------------------------------------------------------------- packers, protectors, installers, compilers (PE)
const hash40 = '0123456789abcdef0123456789abcdef01234567';
const PE_RULES = [
  ['UPX', 'packer', { sections: named(['UPX0', 'UPX1', '.rsrc']), headerTail: 'UPX!' }, /section UPX0.*section UPX1.*marker "UPX!"/],
  ['UPX', 'packer', { sections: [text, rdata('$Info: This file is packed with the UPX executable packer http://upx.sf.net $')] }, /string "\$Info: This file is packed with the UPX/],
  ['ASPack', 'packer', { sections: named(['.text', '.aspack', '.adata']) }, /section \.aspack.*section \.adata/],
  ['MPRESS', 'packer', { sections: named(['.MPRESS1', '.MPRESS2']) }, /section \.MPRESS1.*section \.MPRESS2/],
  ['PECompact', 'packer', { sections: named(['.text', 'PEC2']) }, /section PEC2/],
  ['PECompact', 'packer', { sections: [text, rdata('PECompact2')] }, /string "PECompact2"/],
  ['Themida/WinLicense', 'protector', { sections: named(['.text', '.themida']) }, /section \.themida/],
  ['Themida/WinLicense', 'protector', { sections: named(['.text', '.winlice']) }, /section \.winlice/],
  ['VMProtect', 'protector', { sections: named(['.text', '.vmp0', '.vmp1']) }, /section \.vmp0.*section \.vmp1/],
  ['Enigma Protector', 'protector', { sections: named(['.text', '.enigma1', '.enigma2']) }, /section \.enigma1/],
  ['NSIS', 'installer', { overlay: Buffer.concat([Buffer.from([0, 0, 0, 0, 0xef, 0xbe, 0xad, 0xde]), Buffer.from('NullsoftInst'), Buffer.alloc(64)]) }, /overlay signature "NullsoftInst" at 0x604/],
  ['NSIS', 'installer', { resources: [manifestResource(MANIFEST.replace('Example.Game', 'Nullsoft.NSIS.exehead'))] }, /manifest identity "Nullsoft\.NSIS\.exehead"/],
  ['Inno Setup', 'installer', { sections: [text], overlay: Buffer.concat([Buffer.alloc(8), Buffer.from('Inno Setup Setup Data (6.2.2) (u)'), Buffer.alloc(32)]) }, /string "Inno Setup Setup Data \(6\.2\.2\)"/, '6.2.2'],
  ['Inno Setup', 'installer', { resources: [versionResource({ Comments: 'This installation was built with Inno Setup.' })] }, /version info Comments/],
  ['InstallShield', 'installer', { overlay: Buffer.concat([Buffer.from('ISSetupStream\0'), Buffer.alloc(64)]) }, /overlay signature "ISSetupStream"/],
  ['InstallShield', 'installer', { resources: [versionResource({ CompanyName: 'InstallShield Software Corporation' })] }, /version info CompanyName/],
  ['WiX Burn bundle', 'installer', { sections: named(['.text', '.wixburn']) }, /section \.wixburn/],
  ['7-Zip SFX', 'sfx', { overlay: Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), Buffer.alloc(64)]) }, /overlay starts with a 7z archive at 0x600/],
  ['7-Zip SFX', 'sfx', { overlay: Buffer.from(';!@Install@!UTF-8!\nTitle="Setup"\n;!@InstallEnd@!' + '\0'.repeat(32)) }, /overlay signature ";!@Install@!UTF-8!"/],
  ['WinRAR SFX', 'sfx', { overlay: Buffer.concat([Buffer.from('Rar!\x1a\x07\x01\0', 'latin1'), Buffer.alloc(64)]) }, /overlay starts with a RAR archive/],
  ['AutoIt', 'runtime', { sections: [text, rdata('\xa3HK\xbe\x98lJ\xa9\x99LS\n\x86\xd6H}AU3!EA06')] }, /string "AU3!EA06"/],
  ['AutoIt', 'runtime', { resources: [versionResource({ FileDescription: 'AutoIt v3 Script: 3, 3, 16, 1' })] }, /version info FileDescription/],
  ['PyInstaller', 'packer', { overlay: Buffer.concat([Buffer.alloc(300, 0x78), Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1'), Buffer.alloc(80)]) }, /overlay cookie "MEI.*at 0x72c/],
  ['Nuitka', 'compiler', { sections: [text, rdata('NUITKA_ONEFILE_PARENT')] }, /string "NUITKA_ONEFILE_PARENT"/],
  ['Electron', 'runtime', { sections: [text, rdata('ELECTRON_RUN_AS_NODE')] }, /string "ELECTRON_RUN_AS_NODE"/],
  ['Electron', 'runtime', { resources: [versionResource({ ProductName: 'Electron' })] }, /version info ProductName "Electron"/],
  ['NW.js', 'runtime', { imports: { 'nw.dll': ['NWMain'] } }, /import nw\.dll/],
  ['Go', 'compiler', { sections: [text, rdata('\xff Go buildinf:\x08\x02\0\0go1.22.3\0')] }, /string "Go buildinf:"/, '1.22.3'],
  ['Go', 'compiler', { sections: [text, rdata('\xff Go build ID: "abcDEF123/xyz"\n \xff')] }, /string "Go build ID: "abcDEF123\/xyz"/],
  ['Rust', 'compiler', { sections: [text, rdata(`/rustc/${hash40}/library/core/src/panicking.rs`)] }, /string "\/rustc\/0123456789abcdef/],
  ['Rust', 'compiler', { sections: [text, rdata('rust_begin_unwind')] }, /string "rust_begin_unwind"/],
  ['Delphi / C++Builder (Borland, Embarcadero)', 'compiler', { resources: [{ type: 10, items: [{ name: 'DVCLAL', data: Buffer.alloc(16) }, { name: 'PACKAGEINFO', data: Buffer.alloc(16) }] }] }, /resource RT_RCDATA "DVCLAL".*resource RT_RCDATA "PACKAGEINFO"/],
  ['Delphi / C++Builder (Borland, Embarcadero)', 'compiler', { stub: 'This program must be run under Win32\r\n$' }, /DOS stub text/],
  ['Delphi / C++Builder (Borland, Embarcadero)', 'compiler', { sections: [text, rdata('Embarcadero Delphi for Win32 compiler version 35.0 (28.0.46141.0937)')] }, /string "Embarcadero Delphi for Win32 compiler version 35\.0/, '35.0'],
  ['MinGW (GCC)', 'compiler', { sections: [text, rdata('GCC: (MinGW-W64 x86_64-posix-seh, built by Brecht Sanders) 13.2.0')] }, /string "GCC: \(MinGW-W64/, '13.2.0'],
  ['MinGW (GCC)', 'compiler', { sections: [text, rdata('Mingw-w64 runtime failure:')], imports: { 'libgcc_s_seh-1.dll': ['__gcc_personality_seh0'], 'libstdc++-6.dll': ['_Znwy'] } }, /string "Mingw-w64 runtime failure:".*import libgcc_s_seh-1\.dll.*import libstdc\+\+-6\.dll/],
  ['Microsoft Visual C++', 'compiler', { rich: [{ id: 0x105, build: 29112, count: 9 }, { id: 0x102, build: 29112, count: 1 }], imports: { 'VCRUNTIME140.dll': ['memcpy'], 'MSVCP140.dll': ['_Xbad_alloc'] } }, /Rich header: C\+\+ compiler record, product id 261, build 29112.*import VCRUNTIME140\.dll.*import MSVCP140\.dll/, 'Visual Studio 2019 (MSVC 14.2x)'],
  ['Microsoft Visual C++', 'compiler', { imports: { 'MSVCR100.dll': ['printf'] } }, /^import MSVCR100\.dll$/],
  ['Microsoft linker (link.exe)', 'linker', { rich: [{ id: 0x102, build: 29112, count: 1 }], linker: [14, 29] }, /Rich header at 0x80, linker version 14\.29/, 'Visual Studio 2019 (MSVC 14.2x)'],
];
for (const [i, [name, kind, options, evidence, version]] of PE_RULES.entries()) {
  test(`PE detection ${i + 1}: ${name} (${evidence.source.slice(0, 40)})`, async () => {
    const r = await inspect(buildPe(options));
    const hit = find(r, name);
    assert.ok(hit, `${name} not detected: ${JSON.stringify(r.detected)}`);
    assert.equal(hit.kind, kind);
    assert.match(hit.evidence.join(' | '), evidence);
    if (version) assert.equal(hit.version, version);
    const others = r.detected.filter(d => d.name !== name).map(d => d.name);
    const expectedOthers = name === 'Microsoft Visual C++' && options.rich ? ['Microsoft linker (link.exe)'] : [];
    assert.deepEqual(others, expectedOthers, 'no other tool is detected from this fixture');
  });
}

test('.NET is reported once as a runtime, with the CLI header as evidence', async () => {
  const r = await inspect(buildDotNetDll());
  assert.deepEqual(r.detected, [{ name: '.NET', kind: 'runtime', evidence: ['CLI header (data directory 14), metadata runtime v4.0.30319'], version: 'v4.0.30319' }]);
  assert.equal(r.hints.runtime, '.NET (CLR)');
});

test('packers come first in the list', async () => {
  const r = await inspect(buildPe({ sections: named(['UPX0', 'UPX1']), rich: [{ id: 0x105, build: 29112, count: 1 }] }));
  assert.deepEqual(r.detected.map(d => d.kind), ['packer', 'compiler', 'linker']);
});

// ---------------------------------------------------------------- capabilities
const CAPABILITY_CASES = [
  ['networking', { 'WS2_32.dll': ['socket', 'connect', 'WSAStartup'], 'WINHTTP.dll': ['WinHttpOpen'] }, ['socket', 'connect', 'WSAStartup', 'WinHttpOpen'], ['WS2_32.dll', 'WINHTTP.dll']],
  ['networking', { 'WININET.dll': ['InternetOpenUrlW'] }, ['InternetOpenUrlW'], ['WININET.dll']],
  ['cryptography', { 'bcrypt.dll': ['BCryptEncrypt'], 'ADVAPI32.dll': ['CryptAcquireContextW'] }, ['BCryptEncrypt', 'CryptAcquireContextW'], ['bcrypt.dll']],
  ['file system', { 'KERNEL32.dll': ['CreateFileW', 'DeleteFileW'] }, ['CreateFileW', 'DeleteFileW']],
  ['registry', { 'ADVAPI32.dll': ['RegSetValueExW', 'RegOpenKeyExW'] }, ['RegSetValueExW', 'RegOpenKeyExW']],
  ['process creation', { 'KERNEL32.dll': ['CreateProcessW'], 'SHELL32.dll': ['ShellExecuteExW'] }, ['CreateProcessW', 'ShellExecuteExW']],
  ['writes memory of other processes', { 'KERNEL32.dll': ['CreateRemoteThread', 'WriteProcessMemory', 'VirtualAllocEx'] }, ['CreateRemoteThread', 'WriteProcessMemory', 'VirtualAllocEx']],
  ['inspects other processes', { 'KERNEL32.dll': ['OpenProcess', 'ReadProcessMemory'] }, ['OpenProcess', 'ReadProcessMemory']],
  ['anti-debugging checks', { 'KERNEL32.dll': ['IsDebuggerPresent'], 'ntdll.dll': ['NtQueryInformationProcess'] }, ['IsDebuggerPresent', 'NtQueryInformationProcess']],
  ['screen capture', { 'GDI32.dll': ['BitBlt'], 'USER32.dll': ['GetDC'] }, ['BitBlt', 'GetDC']],
  ['keyboard hooks', { 'USER32.dll': ['SetWindowsHookExW', 'GetAsyncKeyState'] }, ['SetWindowsHookExW', 'GetAsyncKeyState']],
  ['service installation', { 'ADVAPI32.dll': ['OpenSCManagerW', 'CreateServiceW'] }, ['OpenSCManagerW', 'CreateServiceW']],
  ['dynamic code loading', { 'KERNEL32.dll': ['LoadLibraryW', 'GetProcAddress'] }, ['LoadLibraryW', 'GetProcAddress']],
];
for (const [name, imports, expected, libraries] of CAPABILITY_CASES) {
  test(`capability from imports: ${name} (${expected[0]})`, async () => {
    const r = await inspect(buildPe({ imports }));
    assert.deepEqual(r.capabilities, [{ name, ...(libraries ? { libraries } : {}), imports: expected }]);
    assert.equal(r.capabilitiesNote, CAPABILITY_NOTE);
  });
}

test('capabilities: strings as evidence, a cap with a more count, and no guess from one drawing call', async () => {
  const viaStrings = await inspect(buildPe({ sections: [text, rdata('WinHttpOpen\0\0CreateRemoteThread\0\0libcurl/8.4.0\0\0OpenSSL 3.0.13 30 Jan 2024\0\0SSL_CTX_new')] }));
  const byName = Object.fromEntries(viaStrings.capabilities.map(c => [c.name, c]));
  assert.deepEqual(byName.networking, { name: 'networking', strings: ['libcurl/8.4.0', 'WinHttpOpen'] });
  assert.deepEqual(byName.cryptography, { name: 'cryptography', strings: ['OpenSSL 3.0.13 30 Jan 2024', 'SSL_CTX_new'] });
  assert.deepEqual(byName['writes memory of other processes'], { name: 'writes memory of other processes', strings: ['CreateRemoteThread'] });
  assert.match(viaStrings.capabilitiesNote, /no named imports/);

  const many = await inspect(buildPe({ imports: { 'ADVAPI32.dll': ['RegOpenKeyExW', 'RegSaveKeyW', 'RegSetValueExW', 'RegQueryValueExW', 'RegDeleteKeyW', 'RegEnumKeyExW', 'RegCreateKeyExW', 'RegDeleteValueW', 'RegEnumValueW', 'RegGetValueW'] } }));
  assert.equal(many.capabilities[0].imports.length, 8);
  assert.equal(many.capabilities[0].more, 2);

  const drawing = await inspect(buildPe({ imports: { 'GDI32.dll': ['BitBlt', 'CreateSolidBrush'] } }));
  assert.deepEqual(drawing.capabilities, [], 'BitBlt alone is ordinary drawing');
  const plainWords = await inspect(buildPe({ sections: [text, rdata('connect\0\0system\0\0SSL_CTX_DATA\0\0socket')] }));
  assert.deepEqual(plainWords.capabilities, [], 'plain words and constants are not API evidence');
});

test('capabilities on ELF and Mach-O imports', async () => {
  const elf = await inspect(buildElf({ sections: [{ name: '.text', data: Buffer.alloc(16) }, ...elfDynamicSections({ needed: ['libcurl.so.4', 'libc.so.6'], imports: ['socket', 'curl_easy_perform', 'dlopen', 'ptrace', 'fork', 'XGetImage'] })] }));
  assert.deepEqual(elf.capabilities.map(c => c.name), ['networking', 'process creation', 'anti-debugging checks', 'screen capture', 'dynamic code loading']);
  assert.deepEqual(elf.capabilities[0], { name: 'networking', libraries: ['libcurl.so.4'], imports: ['socket', 'curl_easy_perform'] });
  const macho = await inspect(buildMachO({ symbols: { imports: ['_socket', '_CCCrypt', '_task_for_pid', '_CGEventTapCreate'] } }));
  assert.deepEqual(macho.capabilities.map(c => [c.name, c.imports]), [['networking', ['socket']], ['cryptography', ['CCCrypt']], ['writes memory of other processes', ['task_for_pid']], ['keyboard hooks', ['CGEventTapCreate']]]);
});

// ---------------------------------------------------------------- ELF
test('ELF: build id, ABI tag, interpreter, RUNPATH, needed libraries, .comment, DWARF producer, not stripped', async () => {
  const abi = Buffer.alloc(16); abi.writeUInt32LE(0, 0); abi.writeUInt32LE(3, 4); abi.writeUInt32LE(2, 8);
  const buildId = Buffer.from('00112233445566778899aabbccddeeff01234567', 'hex');
  const r = await inspect(buildElf({ interp: '/lib64/ld-linux-x86-64.so.2', sections: [
    { name: '.text', data: Buffer.alloc(16) },
    { name: '.note.gnu.build-id', type: 7, data: elfNote('GNU', 3, buildId) },
    { name: '.note.ABI-tag', type: 7, data: elfNote('GNU', 1, abi) },
    { name: '.comment', data: Buffer.from('GCC: (Ubuntu 13.2.0-23ubuntu4) 13.2.0\0clang version 17.0.6\0Linker: LLD 17.0.6\0') },
    ...elfDynamicSections({ needed: ['libm.so.6', 'libc.so.6'], runpath: '$ORIGIN/lib' }),
    ...elfSymtabSections(['main', 'helper']),
    ...elfDwarfSections('GNU C17 13.2.0 -mtune=generic -O2 -g'),
  ] }));
  const b = r.binary;
  assert.equal(b.buildId, '00112233445566778899aabbccddeeff01234567');
  assert.deepEqual(b.abiTag, { os: 'Linux', minVersion: '3.2.0' });
  assert.deepEqual(b.notes, [{ owner: 'GNU', type: 3, name: 'build id', size: 20 }, { owner: 'GNU', type: 1, name: 'ABI tag', size: 16 }]);
  assert.equal(b.interpreter, '/lib64/ld-linux-x86-64.so.2');
  assert.deepEqual(b.runpath, ['$ORIGIN/lib']);
  assert.deepEqual(b.rpath, ['$ORIGIN/lib']);
  assert.deepEqual(b.imports[0].libraries, ['libm.so.6', 'libc.so.6']);
  assert.deepEqual(b.comment, ['GCC: (Ubuntu 13.2.0-23ubuntu4) 13.2.0', 'clang version 17.0.6', 'Linker: LLD 17.0.6']);
  assert.equal(b.stripped, false);
  assert.equal(b.functionSymbols, 2);
  assert.equal(b.debugInfo, true);
  assert.deepEqual(b.dwarf, { sections: 3, version: '4', compileUnits: 1, producers: [{ producer: 'GNU C17 13.2.0 -mtune=generic -O2 -g', units: 1 }] });
  assert.deepEqual(r.detected, [
    { name: 'GCC', kind: 'compiler', evidence: ['.comment "GCC: (Ubuntu 13.2.0-23ubuntu4) 13.2.0"'], version: '13.2.0' },
    { name: 'Clang', kind: 'compiler', evidence: ['.comment "clang version 17.0.6"'], version: '17.0.6' },
    { name: 'LLD', kind: 'linker', evidence: ['.comment "Linker: LLD 17.0.6"'], version: '17.0.6' },
  ]);
});

test('ELF: DT_RPATH is not reported as RUNPATH; a file without .symtab is stripped; repeated notes are counted', async () => {
  const r = await inspect(buildElf({ sections: [{ name: '.text', data: Buffer.alloc(16) }, ...elfDynamicSections({ needed: ['libc.so.6'], rpath: '/opt/app/lib' }),
    { name: '.note.stapsdt', type: 7, data: Buffer.concat([elfNote('stapsdt', 3, Buffer.alloc(8)), elfNote('stapsdt', 3, Buffer.alloc(8))]) }] }));
  assert.deepEqual(r.binary.rpath, ['/opt/app/lib']);
  assert.equal(r.binary.runpath, undefined);
  assert.equal(r.binary.stripped, true);
  assert.equal(r.binary.buildId, undefined);
  assert.equal(r.binary.dwarf, undefined);
  assert.deepEqual(r.binary.notes, [{ owner: 'stapsdt', type: 3, name: 'SystemTap probe', size: 8, count: 2 }]);
});

const ELF_RULES = [
  ['UPX', 'packer', { sectionHeaders: false, sections: [{ name: '.text', data: Buffer.concat([Buffer.alloc(40), Buffer.from('UPX!'), Buffer.alloc(40), Buffer.from('$Info: This file is packed with the UPX executable packer http://upx.sf.net $\0')]) }] }, /marker "UPX!" in the first 4 KiB.*string "\$Info: This file is packed with the UPX/],
  ['Go', 'compiler', { sections: [{ name: '.text', data: Buffer.alloc(16) }, { name: '.gopclntab', data: Buffer.alloc(16) }, { name: '.go.buildinfo', data: Buffer.from('\xff Go buildinf:\x08\x02\0\0go1.21.5\0', 'latin1') }, { name: '.note.go.buildid', type: 7, data: elfNote('Go', 4, Buffer.from('abc123/def456')) }] }, /section \.gopclntab.*section \.go\.buildinfo.*section \.note\.go\.buildid/, '1.21.5'],
  ['Rust', 'compiler', { sections: [{ name: '.text', data: Buffer.alloc(16) }, { name: '.comment', data: Buffer.from('rustc version 1.75.0 (82e1608df 2023-12-21)\0') }] }, /\.comment "rustc version 1\.75\.0/, '1.75.0'],
  ['GCC', 'compiler', { sections: [{ name: '.comment', data: Buffer.from('GCC: (GNU) 12.3.0\0') }] }, /^\.comment "GCC: \(GNU\) 12\.3\.0"$/, '12.3.0'],
  ['Clang', 'compiler', { sections: [{ name: '.comment', data: Buffer.from('Ubuntu clang version 18.1.3 (1ubuntu1)\0') }] }, /\.comment "Ubuntu clang version 18\.1\.3/, '18.1.3'],
  ['LLD', 'linker', { sections: [{ name: '.comment', data: Buffer.from('Linker: LLD 18.1.3\0') }] }, /\.comment "Linker: LLD 18\.1\.3"/, '18.1.3'],
  ['mold', 'linker', { sections: [{ name: '.comment', data: Buffer.from('mold 2.30.0 (compatible with GNU ld)\0') }] }, /\.comment "mold 2\.30\.0/, '2.30.0'],
  ['GNU gold', 'linker', { sections: [{ name: '.note.gnu.gold-version', type: 7, data: elfNote('GNU', 4, Buffer.from('gold 1.16\0')) }] }, /section \.note\.gnu\.gold-version/],
  ['PyInstaller', 'packer', { sections: [{ name: '.text', data: Buffer.alloc(16) }, { name: 'pydata', data: Buffer.alloc(64, 0x78) }] }, /section pydata/],
];
for (const [name, kind, options, evidence, version] of ELF_RULES) {
  test(`ELF detection: ${name}`, async () => {
    const r = await inspect(buildElf(options));
    const hit = find(r, name);
    assert.ok(hit, `${name} not detected: ${JSON.stringify(r.detected)}`);
    assert.equal(hit.kind, kind);
    assert.match(hit.evidence.join(' | '), evidence);
    if (version) assert.equal(hit.version, version);
    assert.equal(r.detected.length, 1, JSON.stringify(r.detected));
  });
}

test('ELF: the Go build id and gold version are read from their notes', async () => {
  const go = await inspect(buildElf(ELF_RULES[1][2]));
  assert.equal(go.binary.goBuildId, 'abc123/def456');
  assert.equal(go.binary.goBinary, true);
  const gold = await inspect(buildElf(ELF_RULES[7][2]));
  assert.equal(gold.binary.goldVersion, 'gold 1.16');
});

// ---------------------------------------------------------------- Mach-O
test('Mach-O: LC_UUID, LC_BUILD_VERSION with tools, code signature and entitlement keys', async () => {
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
    <key>com.apple.security.app-sandbox</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.temporary-exception.sbpl</key><array><dict><key>nested-not-listed</key><true/></dict></array>
    <key>keychain-access-groups</key><array><string>ABCDE12345.com.example.app</string></array>
  </dict></plist>`;
  const r = await inspect(buildMachO({
    uuid: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', build: { platform: 1, minos: [11, 0, 0], sdk: [14, 2, 0], tools: [[3, [1053, 12, 0]], [1, [15, 0, 0]]] },
    dylibs: ['/usr/lib/libSystem.B.dylib'], symbols: { imports: ['_puts'], locals: ['_helper'] },
    signature: { identifier: 'com.example.app', teamId: 'ABCDE12345', entitlements, cms: true, flags: 0x10000 },
  }));
  const b = r.binary;
  assert.equal(b.uuid, '0f1e2d3c4b5a69788796a5b4c3d2e1f0');
  assert.deepEqual(b.platform, { platform: 'macOS', minOS: '11.0.0', sdk: '14.2.0', source: 'LC_BUILD_VERSION', tools: [{ tool: 'ld', version: '1053.12.0' }, { tool: 'clang', version: '15.0.0' }] });
  assert.equal(b.signed, true);
  assert.equal(b.stripped, false);
  assert.deepEqual({ ...b.codeSignature, offset: 0, size: 0 }, {
    offset: 0, size: 0, identifier: 'com.example.app', teamId: 'ABCDE12345', adHoc: false, hardenedRuntime: true,
    entitlements: { count: 4, keys: ['com.apple.security.app-sandbox', 'com.apple.security.network.client', 'com.apple.security.temporary-exception.sbpl', 'keychain-access-groups'] }, cmsSignature: true,
  });
  assert.deepEqual(r.detected, [
    { name: 'Apple clang', kind: 'compiler', evidence: ['LC_BUILD_VERSION tool clang 15.0.0'], version: '15.0.0' },
    { name: 'Apple ld', kind: 'linker', evidence: ['LC_BUILD_VERSION tool ld 1053.12.0'], version: '1053.12.0' },
  ]);
});

test('Mach-O: LC_VERSION_MIN_MACOSX, an ad-hoc signature without entitlements, stripped, and Go / UPX rules', async () => {
  const old = (await inspect(buildMachO({ versionMin: { cmd: 0x24, minos: [10, 9, 0], sdk: [10, 14, 0] }, signature: { identifier: 'a.out', flags: 0x2 } }))).binary;
  assert.deepEqual(old.platform, { platform: 'macOS', minOS: '10.9.0', sdk: '10.14.0', source: 'LC_VERSION_MIN_MACOSX' });
  assert.equal(old.uuid, null);
  assert.equal(old.codeSignature.adHoc, true);
  assert.equal(old.codeSignature.entitlements, null);
  assert.equal(old.codeSignature.teamId, undefined);
  assert.equal(old.stripped, true);
  const unsigned = (await inspect(buildMachO())).binary;
  assert.equal(unsigned.signed, false);
  assert.equal(unsigned.codeSignature, undefined);

  const go = await inspect(buildMachO({ segments: [{ name: '__TEXT', sections: ['__text'], data: Buffer.alloc(16) }, { name: '__DATA', sections: ['__go_buildinfo'], data: Buffer.from('\xff Go buildinf:\x08\x02\0\0go1.22.1\0', 'latin1') }] }));
  assert.deepEqual(go.detected.map(d => [d.name, d.version, d.evidence[0]]), [['Go', '1.22.1', 'section __DATA,__go_buildinfo']]);
  const upx = await inspect(buildMachO({ segments: [{ name: '__TEXT', sections: ['__text'], data: Buffer.concat([Buffer.alloc(8), Buffer.from('UPX!'), Buffer.alloc(8)]) }] }));
  assert.deepEqual(upx.detected.map(d => [d.name, d.kind]), [['UPX', 'packer']]);
});

// ---------------------------------------------------------------- WebAssembly
test('WebAssembly: name section, function list with body sizes, producers', async () => {
  const w = parseWasm(buildWasmWithNames());
  assert.equal(w.moduleName, 'demo');
  assert.deepEqual(w.producers, { language: [{ name: 'Rust' }], 'processed-by': [{ name: 'rustc', version: '1.75.0' }] });
  assert.deepEqual(w.functions, { count: 2, imported: 1, named: 2, items: [
    { index: 0, name: 'host_log', source: 'name section', imported: true },
    { index: 1, name: 'run_game', source: 'name section', size: 2 },
  ] });
  assert.deepEqual(w.sections.filter(s => s.customName).map(s => s.customName), ['name', 'producers']);

  const bare = parseWasm(buildWasm());
  assert.deepEqual(bare.functions.items, [{ index: 0, name: 'env.log', source: 'import', imported: true }, { index: 1, name: 'main', source: 'export', size: 2 }]);
  assert.equal(bare.producers, undefined);

  const limited = await inspect(buildWasmWithNames(), { names: { limit: 1 } });
  assert.equal(limited.binary.functions.items.length, 1);
  assert.equal(limited.binary.functions.more, 1);
  const matched = await inspect(buildWasmWithNames(), { names: { match: 'run_' } });
  assert.deepEqual(matched.binary.functions.items.map(f => f.name), ['run_game']);
});

test('WebAssembly: a damaged name section does not stop the parse', () => {
  const buf = buildWasmWithNames();
  const at = buf.indexOf('host_log') - 1;
  buf[at] = 0xff; buf[at + 1] = 0xff; // name length runs far past the section
  const w = parseWasm(buf);
  assert.equal(w.functions.count, 2);
  assert.deepEqual(w.exports.names, ['main']);
});
