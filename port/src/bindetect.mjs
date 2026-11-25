// Detection for re_binary: the MSVC "Rich" header, packers / protectors / installers / compilers / linkers /
// runtimes, and coarse capabilities from imports and strings. Every rule names what it matched (a section, an
// import, a string, an overlay signature, a resource). Detection only: nothing is unpacked, decrypted or patched.

// ---------------------------------------------------------------- Rich header
// Product ids written by Microsoft's tools (the "comp.id" of each object file). Only the ids that are documented
// by several independent Rich-header studies are named; everything else stays a raw number.
const VS = { 6: 'Visual Studio 6.0 (VC++ 6.0)', 2003: 'Visual Studio .NET 2003 (VC++ 7.1)', 2005: 'Visual Studio 2005 (VC++ 8.0)', 2008: 'Visual Studio 2008 (VC++ 9.0)', 2010: 'Visual Studio 2010 (VC++ 10.0)', 2012: 'Visual Studio 2012 (VC++ 11.0)', 2013: 'Visual Studio 2013 (VC++ 12.0)' };
const RICH_PRODUCTS = {
  0x01: ['imported symbols'],
  0x0a: ['C compiler', 6], 0x0b: ['C++ compiler', 6],
  0x5f: ['C compiler', 2003], 0x60: ['C++ compiler', 2003],
  0x6d: ['C compiler', 2005], 0x6e: ['C++ compiler', 2005], 0x78: ['linker', 2005],
  0x83: ['C compiler', 2008], 0x84: ['C++ compiler', 2008], 0x91: ['linker', 2008],
  0xaa: ['C compiler', 2010], 0xab: ['C++ compiler', 2010], 0x9d: ['linker', 2010],
  0xce: ['C compiler', 2012], 0xcf: ['C++ compiler', 2012], 0xcc: ['linker', 2012],
  0xe0: ['C compiler', 2013], 0xe1: ['C++ compiler', 2013], 0xde: ['linker', 2013],
  // Visual Studio 2015 and later share one id set; the build number tells the releases apart.
  0xff: ['resource converter (cvtres)', 0], 0x100: ['export file', 0], 0x101: ['import library', 0], 0x102: ['linker', 0],
  0x103: ['assembler (MASM)', 0], 0x104: ['C compiler', 0], 0x105: ['C++ compiler', 0],
};
// Toolset build numbers (the third part of cl.exe's version 19.xx.BUILD): 2015 = 23026–24215, 2017 = 25017–27054,
// 2019 = 27508–30159, 2022 starts at 30705. Later toolsets keep counting up, so the last range is open.
function vs2015Plus(build) {
  if (build >= 23026 && build < 25000) return 'Visual Studio 2015 (MSVC 14.0)';
  if (build >= 25000 && build < 27500) return 'Visual Studio 2017 (MSVC 14.1x)';
  if (build >= 27500 && build < 30700) return 'Visual Studio 2019 (MSVC 14.2x)';
  if (build >= 30700 && build < 40000) return 'Visual Studio 2022 or later (MSVC 14.3x+)';
  return null;
}
const rol32 = (v, n) => (n ? ((v << n) | (v >>> (32 - n))) >>> 0 : v >>> 0);

/** Decode the Rich header between the DOS stub and the PE header. Returns null when there is none. */
export function parseRichHeader(buf, peOff) {
  const limit = Math.min(peOff, buf.length);
  const rich = buf.subarray(0, limit).indexOf('Rich', 0x40, 'latin1');
  if (rich < 0 || rich + 8 > limit) return null;
  const key = buf.readUInt32LE(rich + 4);
  let start = -1;
  for (let o = rich - 4; o >= 0x40; o -= 4) if ((buf.readUInt32LE(o) ^ key) >>> 0 === 0x536e6144) { start = o; break; } // "DanS"
  if (start < 0) return { offset: rich, key: '0x' + key.toString(16).padStart(8, '0'), records: [], checksumValid: false, note: 'Rich marker without a DanS start: the header is damaged or was edited' };
  const records = [];
  let sum = start;
  for (let i = 0; i < start; i++) if (i < 0x3c || i > 0x3f) sum = (sum + rol32(buf[i], i & 31)) >>> 0; // e_lfanew counts as zero
  for (let o = start + 16; o + 8 <= rich; o += 8) {
    const id = (buf.readUInt32LE(o) ^ key) >>> 0, count = (buf.readUInt32LE(o + 4) ^ key) >>> 0;
    sum = (sum + rol32(id, count & 31)) >>> 0;
    const productId = id >>> 16, build = id & 0xffff;
    const known = RICH_PRODUCTS[productId];
    const rec = { productId, build, count };
    if (known) {
      rec.tool = known[0];
      const vs = known[1] === 0 ? vs2015Plus(build) : VS[known[1]];
      if (vs) rec.visualStudio = vs;
    }
    records.push(rec);
  }
  const out = { offset: start, key: '0x' + key.toString(16).padStart(8, '0'), checksumValid: sum === key, records };
  if (!out.checksumValid) out.note = `Rich header checksum does not match (computed 0x${sum.toString(16).padStart(8, '0')}): the DOS header, stub or Rich records were changed after linking`;
  const compilers = records.filter(r => /compiler/.test(r.tool ?? '') && r.visualStudio).sort((a, b) => b.build - a.build);
  const linker = records.find(r => r.tool === 'linker' && r.visualStudio);
  if (compilers[0] || linker) out.toolchain = (compilers[0] ?? linker).visualStudio;
  return out;
}

// ---------------------------------------------------------------- packers, protectors, installers, compilers
const clip = (s, n = 90) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const hexAt = n => '0x' + n.toString(16);

/**
 * @param {object} ctx
 * @param {string} ctx.format pe | elf | macho
 * @param {object} ctx.info parsed binary (before lists are trimmed)
 * @param {Buffer} ctx.buf file bytes that were read
 * @param {string} ctx.text every extracted string, one per line
 * @param {number} [ctx.overlayOffset] where data after the last section starts
 * @returns {{name: string, kind: string, version?: string, evidence: string[]}[]}
 */
export function detectTools({ format, info, buf, text, overlayOffset }) {
  const found = new Map();
  const add = (name, kind, evidence, version) => {
    const ev = [evidence].flat().filter(Boolean);
    if (!ev.length) return;
    const cur = found.get(name) ?? { name, kind, evidence: [] };
    if (version && !cur.version) cur.version = version;
    for (const e of ev) if (!cur.evidence.includes(e) && cur.evidence.length < 6) cur.evidence.push(e);
    found.set(name, cur);
  };
  const sectionNames = (info.sections ?? []).map(s => s.name);
  const sec = re => sectionNames.filter(n => re.test(n)).slice(0, 4).map(n => `section ${n}`);
  const str = re => { const m = re.exec(text); return m ? [`string "${clip(m[0])}"`] : []; };
  const libs = (info.imports ?? []).flatMap(i => [i.library, ...(i.libraries ?? [])]).filter(Boolean);
  const lib = re => libs.filter(l => re.test(l)).slice(0, 3).map(l => `import ${l}`);
  const overlay = overlayOffset != null && overlayOffset < buf.length ? buf.subarray(overlayOffset) : null;
  const inOverlay = (needle, window = 1 << 20, what = needle) => {
    if (!overlay) return [];
    const at = overlay.subarray(0, window).indexOf(needle, 0, 'latin1');
    return at < 0 ? [] : [`overlay signature "${clip(what)}" at ${hexAt(overlayOffset + at)}`];
  };
  const overlayStarts = (needle, what) => (overlay && overlay.subarray(0, needle.length).equals(Buffer.from(needle, 'latin1')) ? [`overlay starts with ${what} at ${hexAt(overlayOffset)}`] : []);
  const versionStrings = info.resources?.version?.strings ?? {};
  const ver = re => Object.entries(versionStrings).filter(([, v]) => re.test(v)).slice(0, 2).map(([k, v]) => `version info ${k} "${clip(v, 60)}"`);
  const resources = info.resources?.entries ?? [];
  const res = (type, name) => (resources.some(e => e.type === type && e.name === name) ? [`resource ${type === 10 ? 'RT_RCDATA' : type} "${name}"`] : []);
  const manifestName = info.resources?.manifest?.identity?.name ?? '';
  const head = buf.subarray(0, 4096);
  const marker = (needle, area, where) => { const at = area.indexOf(needle, 0, 'latin1'); return at < 0 ? [] : [`marker "${needle}" ${where}`]; };

  // --- any format
  const upx = [...sec(/^UPX[0-9!]$/), ...marker('UPX!', head, 'in the first 4 KiB'), ...str(/\$Info: This file is packed with the UPX executable packer[^$\n]{0,40}/)];
  add('UPX', 'packer', upx);
  const goSections = sec(/^(\.gopclntab|\.note\.go\.buildid|\.go\.buildinfo|[\w]+,__gopclntab|[\w]+,__go_buildinfo)$/);
  const goEvidence = [...goSections, ...str(/Go build ID: "[^"\n]{0,60}/), ...str(/Go buildinf:/)];
  if (goEvidence.length) add('Go', 'compiler', goEvidence, /\bgo(1\.\d+(?:\.\d+)?)\b/.exec(text)?.[1]);
  const rust = [...str(/rustc version [\d.]+[^\n]{0,40}/), ...str(/\/rustc\/[0-9a-f]{40}/), ...str(/\brust_(?:begin_unwind|eh_personality|panic)\b/)];
  if (rust.length) add('Rust', 'compiler', rust, /rustc version ([\d.]+)/.exec(text)?.[1]);
  const pyiCookie = overlay ? overlay.lastIndexOf('MEI\x0c\x0b\x0a\x0b\x0e', overlay.length, 'latin1') : -1;
  add('PyInstaller', 'packer', [...(pyiCookie >= 0 ? [`overlay cookie "MEI\\x0c\\x0b\\x0a\\x0b\\x0e" at ${hexAt(overlayOffset + pyiCookie)}`] : []), ...sec(/^pydata$/)]);
  add('Nuitka', 'compiler', [...str(/NUITKA_ONEFILE_PARENT/), ...str(/__nuitka_binary_dir/)]);
  add('Electron', 'runtime', [...str(/ELECTRON_RUN_AS_NODE/), ...str(/\belectron\.asar\b/), ...ver(/^Electron$/)]);
  add('NW.js', 'runtime', [...lib(/^nw(_elf)?\.dll$/i), ...str(/\bnode-webkit\b/)]);

  if (format === 'pe') {
    add('ASPack', 'packer', sec(/^\.aspack$/).length ? [...sec(/^\.aspack$/), ...sec(/^\.adata$/)] : []);
    add('MPRESS', 'packer', sec(/^\.MPRESS[12]$/));
    add('PECompact', 'packer', [...sec(/^(PEC2|PEC2TO|PEC2MO|pec[12])$/), ...str(/PECompact2/)]);
    add('Themida/WinLicense', 'protector', sec(/^\.(themida|winlice)$/));
    add('VMProtect', 'protector', sec(/^\.vmp[0-9]$/));
    add('Enigma Protector', 'protector', sec(/^\.enigma[12]$/));
    add('NSIS', 'installer', [...inOverlay('\xef\xbe\xad\xdeNullsoftInst', 1 << 16, 'NullsoftInst'), ...(/^Nullsoft\.NSIS/i.test(manifestName) ? [`manifest identity "${manifestName}"`] : [])]);
    add('Inno Setup', 'installer', [...str(/Inno Setup Setup Data \([^)\n]{1,24}\)/), ...ver(/Inno Setup/)], /Inno Setup Setup Data \((\d[\d.]*)/.exec(text)?.[1]);
    add('InstallShield', 'installer', [...inOverlay('ISSetupStream', 1 << 16), ...ver(/InstallShield/)]);
    add('WiX Burn bundle', 'installer', sec(/^\.wixburn$/));
    add('7-Zip SFX', 'sfx', [...overlayStarts('7z\xbc\xaf\x27\x1c', 'a 7z archive'), ...inOverlay(';!@Install@!UTF-8!', 1 << 16), ...ver(/^7z (Setup )?SFX/)]);
    add('WinRAR SFX', 'sfx', [...overlayStarts('Rar!\x1a\x07', 'a RAR archive'), ...ver(/^WinRAR (self-extracting|SFX)/i)]);
    add('AutoIt', 'runtime', [...str(/AU3!EA0[56]/), ...ver(/^AutoIt v3 Script/)]);
    add('Delphi / C++Builder (Borland, Embarcadero)', 'compiler', [
      ...res(10, 'DVCLAL'), ...res(10, 'PACKAGEINFO'), ...str(/Embarcadero Delphi for Win(?:32|64) compiler version [\d.]+/), ...str(/SOFTWARE\\Borland\\Delphi\\RTL/i),
      ...(head.subarray(0x40, 0x200).includes('This program must be run under Win') ? ['DOS stub text "This program must be run under Win32/Win64" (Borland linker)'] : []),
    ], /Embarcadero Delphi for Win(?:32|64) compiler version ([\d.]+)/.exec(text)?.[1]);
    const gcc = /GCC: \(([^)\n]*)\) ([\d.]+)/.exec(text);
    add('MinGW (GCC)', 'compiler', [...(gcc ? [`string "${clip(gcc[0])}"`] : []), ...str(/Mingw-w64 runtime failure:/), ...str(/Mingw runtime failure:/), ...lib(/^(libgcc_s_[\w-]+|libstdc\+\+-\d+|libwinpthread-\d+)\.dll$/i)], gcc?.[2]);
    const rich = info.richHeader;
    const crt = lib(/^(vcruntime\d+(_\d+)?d?|msvcp\d+(_\w+)?d?|msvcr\d+d?)\.dll$/i);
    const cl = rich?.records.filter(r => /compiler/.test(r.tool ?? '')).sort((a, b) => b.build - a.build)[0];
    if (cl || crt.length) add('Microsoft Visual C++', 'compiler', [...(cl ? [`Rich header: ${cl.tool} record, product id ${cl.productId}, build ${cl.build}`] : []), ...crt], cl?.visualStudio);
    if (rich) add('Microsoft linker (link.exe)', 'linker', [`Rich header at ${hexAt(rich.offset)}${info.linkerVersion ? `, linker version ${info.linkerVersion} in the optional header` : ''}`], rich.records.find(r => r.tool === 'linker')?.visualStudio);
    if (info.dotnet && !info.dotnet.warning) add('.NET', 'runtime', [`CLI header (data directory 14)${info.dotnet.runtime ? `, metadata runtime ${info.dotnet.runtime}` : ''}`, ...lib(/^mscoree\.dll$/i)], info.dotnet.runtime);
  }
  if (format === 'elf') {
    for (const line of info.comment ?? []) {
      let m;
      if ((m = /^GCC: \(([^)]*)\) ([\d.]+)/.exec(line))) add('GCC', 'compiler', `.comment "${clip(line)}"`, m[2]);
      else if ((m = /clang version ([\d.]+)/.exec(line))) add('Clang', 'compiler', `.comment "${clip(line)}"`, m[1]);
      else if ((m = /^Linker: LLD ([\d.]+)/.exec(line))) add('LLD', 'linker', `.comment "${clip(line)}"`, m[1]);
      else if ((m = /^mold ([\d.]+)/.exec(line))) add('mold', 'linker', `.comment "${clip(line)}"`, m[1]);
      else if ((m = /^rustc version ([\d.]+)/.exec(line))) add('Rust', 'compiler', `.comment "${clip(line)}"`, m[1]);
    }
    add('GNU gold', 'linker', sec(/^\.note\.gnu\.gold-version$/));
  }
  if (format === 'macho') {
    for (const t of info.platform?.tools ?? []) {
      if (t.tool === 'ld') add('Apple ld', 'linker', `LC_BUILD_VERSION tool ld ${t.version}`, t.version);
      if (t.tool === 'lld') add('LLD', 'linker', `LC_BUILD_VERSION tool lld ${t.version}`, t.version);
      if (t.tool === 'clang') add('Apple clang', 'compiler', `LC_BUILD_VERSION tool clang ${t.version}`, t.version);
      if (t.tool === 'swift') add('Swift', 'compiler', `LC_BUILD_VERSION tool swift ${t.version}`, t.version);
    }
  }
  const order = ['packer', 'protector', 'installer', 'sfx', 'runtime', 'compiler', 'linker'];
  return [...found.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

// ---------------------------------------------------------------- capabilities (imports and strings)
export const CAPABILITY_NOTE = 'From the import table and strings only. Packed or protected binaries hide their imports, APIs can be resolved at run time, and an import is not proof that the code path is used.';

const CAPABILITIES = [
  { name: 'networking',
    api: /^(socket|connect|send|recv|sendto|recvfrom|bind|listen|accept|getaddrinfo|gethostbyname|WSAStartup|WSASocket[AW]|WSAConnect|closesocket|InternetOpen[AW]|InternetOpenUrl[AW]|InternetConnect[AW]|InternetReadFile|HttpOpenRequest[AW]|HttpSendRequest(Ex)?[AW]|WinHttpOpen|WinHttpConnect|WinHttpOpenRequest|WinHttpSendRequest|WinHttpReadData|URLDownloadToFile[AW]|curl_easy_\w+|curl_multi_\w+|DnsQuery_[AW])$/,
    lib: /^(ws2_32|wsock32|winhttp|wininet|urlmon|mswsock|dnsapi)\.dll$|^libcurl\b/i, text: /libcurl\/\d[\d.]+/ },
  { name: 'cryptography',
    api: /^(BCrypt\w+|NCrypt\w+|Crypt(AcquireContext[AW]|Encrypt|Decrypt|GenKey|ImportKey|ExportKey|CreateHash|HashData|DeriveKey|GenRandom|ProtectData|UnprotectData|StringToBinary[AW]|BinaryToString[AW])|EVP_\w+|AES_(set_)?(en|de)crypt\w*|RSA_\w+|SHA(1|224|256|384|512)(_\w+)?|MD5(_\w+)?|HMAC(_\w+)?|SSL_\w+|CCCrypt\w*|CC_(SHA\d+|MD5)\w*|SecKey\w+|mbedtls_\w+|gcry_\w+)$/,
    lib: /^(bcrypt|ncrypt|crypt32|cryptsp)\.dll$|^lib(crypto|ssl|gcrypt|mbedcrypto|sodium)\b/i, text: /OpenSSL \d+\.\d+\.\d+[a-z]? +\d+ \w+ \d{4}/ },
  { name: 'file system',
    api: /^(CreateFile(2|[AW])|ReadFile|WriteFile|DeleteFile[AW]|MoveFile(Ex)?[AW]|CopyFile(Ex)?[AW]|FindFirstFile(Ex)?[AW]|FindNextFile[AW]|CreateDirectory[AW]|RemoveDirectory[AW]|GetTempPath[AW]|SetFileAttributes[AW]|NtCreateFile|NtWriteFile|NtReadFile|fopen(64)?|open(64|at)?|unlink(at)?|rename(at)?|mkdir(at)?|rmdir|opendir|readdir(64)?|fwrite|fread)$/ },
  { name: 'registry',
    api: /^(Reg(Open|Create|Delete|Enum|Query|Set|Get|Save|Load|Rename)\w*|NtSetValueKey|NtOpenKey(Ex)?|NtCreateKey|NtQueryValueKey|SH(RegGetValue|GetValue|SetValue|DeleteKey)[AW])$/ },
  { name: 'process creation',
    api: /^(CreateProcess(AsUser|WithLogon|WithToken)?[AW]|ShellExecute(Ex)?[AW]|WinExec|NtCreateUserProcess|NtCreateProcess(Ex)?|_?w?system|_?w?popen|fork|vfork|exec[lv]p?e?|posix_spawnp?)$/ },
  { name: 'writes memory of other processes',
    api: /^(WriteProcessMemory|VirtualAllocEx|VirtualProtectEx|CreateRemoteThread(Ex)?|NtWriteVirtualMemory|NtCreateThreadEx|RtlCreateUserThread|QueueUserAPC|NtQueueApcThread|SetThreadContext|NtUnmapViewOfSection|process_vm_writev|mach_vm_write|task_for_pid)$/ },
  { name: 'inspects other processes',
    api: /^(OpenProcess|ReadProcessMemory|NtReadVirtualMemory|CreateToolhelp32Snapshot|Process32(First|Next)W?|Module32(First|Next)W?|EnumProcesses|EnumProcessModules(Ex)?|NtOpenProcess|process_vm_readv|mach_vm_read)$/ },
  { name: 'anti-debugging checks',
    api: /^(IsDebuggerPresent|CheckRemoteDebuggerPresent|NtQueryInformationProcess|ZwQueryInformationProcess|NtSetInformationThread|ZwSetInformationThread|OutputDebugString[AW]|ptrace)$/ },
  { name: 'screen capture', api: /^(BitBlt|StretchBlt|PrintWindow)$/, all: /^(GetDC|GetWindowDC|CreateDC[AW]|GetDIBits|GetDesktopWindow)$/ },
  { name: 'screen capture', api: /^(CGDisplayCreateImage(ForRect)?|CGWindowListCreateImage|XGetImage|XShmGetImage|SCScreenshotManager)$/ },
  { name: 'keyboard hooks',
    api: /^(SetWindowsHookEx[AW]|GetAsyncKeyState|GetKeyboardState|RegisterRawInputDevices|CGEventTapCreate|XGrabKeyboard|XQueryKeymap)$/ },
  { name: 'service installation',
    api: /^(CreateService[AW]|OpenSCManager[AW]|StartService[AW]|ChangeServiceConfig2?[AW]|StartServiceCtrlDispatcher[AW]|RegisterServiceCtrlHandler(Ex)?[AW]|DeleteService)$/ },
  { name: 'dynamic code loading',
    api: /^(LoadLibrary(Ex)?[AW]|GetProcAddress|LdrLoadDll|LdrGetProcedureAddress|VirtualProtect|VirtualAlloc|NtProtectVirtualMemory|dlopen|dlsym|dlmopen|mprotect|memfd_create|NSCreateObjectFileImageFromMemory)$/ },
];

/**
 * @param {object} args
 * @param {{library?: string, libraries?: string[], functions?: string[]}[]} args.imports
 * @param {string[]} args.strings extracted strings (used for API names that are not imported, and library banners)
 * @param {string} args.text the same strings joined
 * @param {string} args.format
 */
export function detectCapabilities({ imports = [], strings = [], text = '', format }) {
  const strip = format === 'macho' ? n => n.replace(/^_/, '') : n => n;
  const imported = [...new Set(imports.flatMap(i => i.functions ?? []).filter(f => typeof f === 'string').map(strip))];
  const libraries = [...new Set(imports.flatMap(i => [i.library, ...(i.libraries ?? [])]).filter(l => l && !l.startsWith('(')))];
  const importedSet = new Set(imported);
  // API names that only occur as strings (resolved with GetProcAddress/dlsym, or statically linked): distinctive ones only.
  const named = [...new Set(strings.filter(s => s.length >= 8 && s.length <= 48 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && /[a-z]/.test(s) && (/[A-Z]/.test(s) || s.includes('_')) && !importedSet.has(s)))];
  const out = new Map();
  for (const rule of CAPABILITIES) {
    const hit = imported.filter(f => rule.api.test(f));
    if (rule.all && !imported.some(f => rule.all.test(f))) continue;
    const extra = rule.all ? imported.filter(f => rule.all.test(f)) : [];
    const libs = rule.lib ? libraries.filter(l => rule.lib.test(l)) : [];
    const strs = rule.all ? [] : named.filter(s => rule.api.test(s));
    const banner = rule.text?.exec(text)?.[0];
    if (banner) strs.unshift(banner);
    if (!hit.length && !libs.length && !strs.length) continue;
    const cur = out.get(rule.name) ?? { name: rule.name, imports: [], libraries: [], strings: [] };
    cur.imports.push(...hit, ...extra); cur.libraries.push(...libs); cur.strings.push(...strs);
    out.set(rule.name, cur);
  }
  return [...out.values()].map(c => {
    const r = { name: c.name };
    let more = 0;
    const cap = (key, list, max) => { const uniq = [...new Set(list)]; if (!uniq.length) return; r[key] = uniq.slice(0, max); more += Math.max(0, uniq.length - max); };
    cap('libraries', c.libraries, 4); cap('imports', c.imports, 8); cap('strings', c.strings, 4);
    if (more) r.more = more;
    return r;
  });
}
