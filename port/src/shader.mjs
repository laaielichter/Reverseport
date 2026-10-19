// port_shader: first drafts between shader languages, with every untranslated piece marked.
// Unity ShaderLab/HLSL (surface and vertex/fragment) → Godot .gdshader; Shadertoy GLSL → Godot canvas_item or a
// three.js ShaderMaterial; Godot .gdshader → three.js ShaderMaterial GLSL or Unity ShaderLab.
// Shader semantics differ per engine (lighting models, coordinate spaces, built-ins), so the output is a faithful
// syntactic translation with properties/uniforms mapped, built-ins substituted, and `PORT:` comments where the
// meaning cannot be carried over mechanically. The leftovers list says exactly what still needs a human.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile } from './util.mjs';
import { workspaceDir } from './workspace.mjs';

// ------------------------------------------------------------------------------------------------ detection
export function detectShader(text, file = '') {
  const ext = path.extname(file).toLowerCase();
  if (/^\s*Shader\s+"/m.test(text) || /\b(CGPROGRAM|HLSLPROGRAM|SubShader)\b/.test(text) || ext === '.shader' && /Properties/.test(text)) return 'shaderlab';
  if (/^\s*shader_type\s+\w+/m.test(text) || ext === '.gdshader') return 'godot';
  if (/\bvoid\s+mainImage\s*\(\s*out\s+vec4\s+\w+\s*,\s*(?:in\s+)?vec2\s+\w+\s*\)/.test(text)) return 'shadertoy';
  if (/\bgl_FragColor\b|\bgl_FragCoord\b|\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(text) || ['.glsl', '.frag', '.vert', '.fs', '.vs'].includes(ext)) return 'glsl';
  if (ext === '.hlsl' || ext === '.cginc' || ext === '.hlslinc' || /\bfloat4\b|\bSV_Target\b|\btex2D\b/.test(text)) return 'hlsl';
  return 'unknown';
}

// ------------------------------------------------------------------------------------------------ HLSL → GLSL
const TYPE_MAP = [['float2', 'vec2'], ['float3', 'vec3'], ['float4', 'vec4'], ['half2', 'vec2'], ['half3', 'vec3'], ['half4', 'vec4'], ['fixed2', 'vec2'], ['fixed3', 'vec3'], ['fixed4', 'vec4'],
  ['int2', 'ivec2'], ['int3', 'ivec3'], ['int4', 'ivec4'], ['uint2', 'uvec2'], ['uint3', 'uvec3'], ['uint4', 'uvec4'], ['bool2', 'bvec2'], ['bool3', 'bvec3'], ['bool4', 'bvec4'],
  ['float2x2', 'mat2'], ['float3x3', 'mat3'], ['float4x4', 'mat4'], ['half3x3', 'mat3'], ['half4x4', 'mat4'], ['half', 'float'], ['fixed', 'float'], ['sampler2D_half', 'sampler2D'], ['sampler2D_float', 'sampler2D'], ['samplerCUBE', 'samplerCube'], ['Texture2D', 'sampler2D'], ['TextureCube', 'samplerCube']];
const FUNC_MAP = [['lerp', 'mix'], ['frac', 'fract'], ['fmod', 'mod'], ['atan2', 'atan'], ['ddx', 'dFdx'], ['ddy', 'dFdy'], ['rsqrt', 'inversesqrt'], ['tex2D', 'texture'], ['tex2Dlod', 'textureLod'], ['texCUBE', 'texture'], ['tex2Dproj', 'textureProj'], ['tex2Dbias', 'texture'], ['tex2Dgrad', 'textureGrad'], ['log10', 'log'], ['clip', 'PORT_clip']];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Find `ret name(params) { body }` with balanced braces. Returns { params, body, start, end } or null. */
export function findFunction(code, name) {
  const re = new RegExp(`\\b\\w+\\s+${name}\\s*\\(([^)]*)\\)\\s*(?::\\s*\\w+\\s*)?\\{`, 'g');
  const m = re.exec(code);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  for (; i < code.length && depth; i++) { if (code[i] === '{') depth++; else if (code[i] === '}') depth--; }
  return { params: m[1], body: code.slice(m.index + m[0].length, i - 1), start: m.index, end: i };
}
const stripFunction = (code, name) => { const f = findFunction(code, name); return f ? code.slice(0, f.start) + code.slice(f.end) : code; };
/** Integer literals that are operands next to float expressions become floats (GLSL has no implicit int→float). */
function floatLiterals(code) {
  return code.split('\n').map(l => {
    if (/\b(u?int|[iu]vec[234])\b/.test(l) || /\[/.test(l)) return l;
    return l.replace(/(?<=[(,]\s*)(\d+)(?![\w.])(?=\s*[,)])/g, '$1.0').replace(/(?<![\w.])(\d+)(?![\w.])(?=\s*[*/+-]\s*[A-Za-z_(])/g, '$1.0').replace(/([A-Za-z_)\]]\s*[*/+-]\s*)(?<![\w.])(\d+)(?![\w.])/g, '$1$2.0').replace(/([*/+-]\s*\(\s*)(\d+)(?![\w.])/g, '$1$2.0');
  }).join('\n');
}

/** Translate HLSL expressions into GLSL (types, intrinsics, swizzle-compatible); matrices via mul() are reordered. */
export function hlslToGlsl(code) {
  let out = code;
  for (const [a, b] of TYPE_MAP) out = out.replace(new RegExp(`\\b${esc(a)}\\b`, 'g'), b);
  for (const [a, b] of FUNC_MAP) out = out.replace(new RegExp(`\\b${esc(a)}\\s*\\(`, 'g'), `${b}(`);
  out = out.replace(/\bsaturate\s*\(/g, 'clamp(').replace(/clamp\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => (m.startsWith('clamp(') && !/,/.test(inner.replace(/\([^()]*\)/g, '')) ? `clamp(${inner}, 0.0, 1.0)` : m));
  // mul(A, B): HLSL row-vector convention mul(v, M) == GLSL M * v only for the transposed matrix; Unity mostly writes mul(M, v).
  for (let i = 0; i < 4; i++) out = out.replace(/\bmul\s*\(\s*((?:[^(),]|\([^()]*\))+)\s*,\s*((?:[^(),]|\([^()]*\))+)\s*\)/g, (m, a, b) => `(${a.trim()} * ${b.trim()})`);
  out = out.replace(/\bPORT_clip\(([^;]*)\);/g, 'if (($1) < 0.0) { discard; } // PORT: clip()');
  out = out.replace(/\b(\d+)\.f\b/g, '$1.0').replace(/\b(\d+\.\d+)f\b/g, '$1').replace(/\b(\d+)f\b/g, '$1.0').replace(/\b(\d+)h\b/g, '$1.0');
  // vec constructors from a single scalar: float3(1) works in both; `float4(c.rgb, 1)` fine. Integer literal in float context: leave.
  out = out.replace(/\[unroll\]|\[loop\]|\[branch\]|\[flatten\]/g, '');
  out = floatLiterals(out);
  out = out.replace(/\bstatic\s+const\b/g, 'const').replace(/\bstatic\b\s+/g, '');
  out = out.replace(/\bUNITY_PI\b/g, 'PI').replace(/\bUNITY_TWO_PI\b/g, '(2.0 * PI)').replace(/\bUNITY_HALF_PI\b/g, '(0.5 * PI)');
  return out;
}

// Unity built-ins → Godot (spatial unless noted). Order matters: longer first.
const UNITY_TO_GODOT = [
  [/\b_Time\.y\b/g, 'TIME'], [/\b_Time\.x\b/g, '(TIME / 20.0)'], [/\b_Time\.z\b/g, '(TIME * 2.0)'], [/\b_Time\.w\b/g, '(TIME * 3.0)'], [/\b_SinTime\.w\b/g, 'sin(TIME)'], [/\b_CosTime\.w\b/g, 'cos(TIME)'],
  [/\b_ScreenParams\.xy\b/g, '(1.0 / SCREEN_PIXEL_SIZE)'], [/\b_ScreenParams\.zw\b/g, '(1.0 + SCREEN_PIXEL_SIZE)'],
  [/\bUNITY_MATRIX_MVP\b/g, '(PROJECTION_MATRIX * MODELVIEW_MATRIX)'], [/\bUNITY_MATRIX_MV\b/g, 'MODELVIEW_MATRIX'], [/\bUNITY_MATRIX_V\b/g, 'VIEW_MATRIX'], [/\bUNITY_MATRIX_P\b/g, 'PROJECTION_MATRIX'], [/\bUNITY_MATRIX_VP\b/g, '(PROJECTION_MATRIX * VIEW_MATRIX)'], [/\bUNITY_MATRIX_IT_MV\b/g, 'MODELVIEW_NORMAL_MATRIX'],
  [/\bunity_ObjectToWorld\b/g, 'MODEL_MATRIX'], [/\bunity_WorldToObject\b/g, 'inverse(MODEL_MATRIX)'], [/\b_Object2World\b/g, 'MODEL_MATRIX'], [/\b_World2Object\b/g, 'inverse(MODEL_MATRIX)'], [/\bunity_CameraProjection\b/g, 'PROJECTION_MATRIX'],
  [/\b_WorldSpaceCameraPos\b/g, 'CAMERA_POSITION_WORLD'], [/\b_WorldSpaceLightPos0\.xyz\b/g, 'LIGHT_DIRECTION /* PORT: light direction is only available in light() */'], [/\b_LightColor0\b/g, 'LIGHT_COLOR /* PORT: in light() */'],
  [/\bUnityObjectToClipPos\s*\(\s*([^;]*?)\s*\)/g, '(PROJECTION_MATRIX * MODELVIEW_MATRIX * vec4(($1).xyz, 1.0))'], [/\bUnityObjectToWorldNormal\s*\(\s*([^;]*?)\s*\)/g, 'normalize((MODEL_NORMAL_MATRIX * ($1)))'], [/\bUnityObjectToWorldDir\s*\(\s*([^;]*?)\s*\)/g, 'normalize((MODEL_MATRIX * vec4(($1), 0.0)).xyz)'],
  [/\bUnityWorldSpaceViewDir\s*\(\s*([^;]*?)\s*\)/g, '(CAMERA_POSITION_WORLD - ($1).xyz)'], [/\bWorldSpaceViewDir\s*\(\s*([^;]*?)\s*\)/g, '(CAMERA_POSITION_WORLD - (MODEL_MATRIX * ($1)).xyz)'], [/\bObjSpaceViewDir\s*\(\s*([^;]*?)\s*\)/g, '((inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz - ($1).xyz)'],
  [/\bTRANSFORM_TEX\s*\(\s*([^,]+)\s*,\s*(\w+)\s*\)/g, '(($1) * $2_ST.xy + $2_ST.zw)'], [/\bComputeScreenPos\s*\(\s*([^;]*?)\s*\)/g, '($1) /* PORT: use SCREEN_UV in fragment() */'], [/\bLinear01Depth\s*\(/g, 'PORT_Linear01Depth('], [/\bUnpackNormal\s*\(\s*([^;]*?)\s*\)/g, '(($1).xyz * 2.0 - 1.0)'],
  [/\bUNITY_INITIALIZE_OUTPUT\s*\([^)]*\);?/g, ''], [/\bUNITY_SETUP_INSTANCE_ID\s*\([^)]*\);?/g, ''], [/\bUNITY_TRANSFER_INSTANCE_ID\s*\([^)]*\);?/g, ''], [/\bUNITY_VERTEX_(INPUT_INSTANCE_ID|OUTPUT_STEREO)\s*;?/g, ''], [/\bUNITY_TRANSFER_FOG\s*\([^)]*\);?/g, ''], [/\bUNITY_APPLY_FOG\s*\([^)]*\);?/g, '/* PORT: fog is automatic in Godot */'],
  [/\bSAMPLE_TEXTURE2D\s*\(\s*(\w+)\s*,\s*\w+\s*,\s*([^)]+)\)/g, 'texture($1, $2)'], [/\bTEXTURE2D\s*\((\w+)\)/g, 'sampler2D $1'], [/\bSAMPLER\s*\(\s*\w+\s*\)\s*;?/g, ''], [/\bTransformObjectToHClip\s*\(\s*([^;]*?)\s*\)/g, '(PROJECTION_MATRIX * MODELVIEW_MATRIX * vec4(($1).xyz, 1.0))'], [/\bTransformObjectToWorld\s*\(\s*([^;]*?)\s*\)/g, '(MODEL_MATRIX * vec4(($1).xyz, 1.0)).xyz'], [/\bTransformObjectToWorldNormal\s*\(\s*([^;]*?)\s*\)/g, 'normalize(MODEL_NORMAL_MATRIX * ($1))'],
];
const LEFTOVER_RE = /\b(UNITY_[A-Z_0-9]+|unity_\w+|_WorldSpace\w+|_LightColor0|_ScreenParams|_ProjectionParams|_ZBufferParams|_CameraDepthTexture|_GrabTexture|SV_\w+|TEXCOORD\d|SHADOW_\w+|LIGHTING_COORDS|TRANSFER_SHADOW|ShadeSH9|Luminance|GammaToLinearSpace|LinearToGammaSpace|PORT_\w+|tex2D\w*|appdata_\w+|v2f)\b/g;

/** Parse ShaderLab Properties: _Name ("Label", Type) = default */
export function parseShaderLab(text) {
  const name = text.match(/^\s*Shader\s+"([^"]+)"/m)?.[1] ?? 'Shader';
  const propsBlock = text.match(/Properties\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const properties = [];
  for (const m of propsBlock.matchAll(/(?:\[[^\]]*\]\s*)*(\w+)\s*\(\s*"([^"]*)"\s*,\s*(Color|2D|3D|Cube|2DArray|Float|Int|Integer|Range\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)|Vector)\s*\)\s*=\s*([^\n]+)/g)) {
    const type = m[3].replace(/\s/g, '').replace(/^Range.*/, 'Range');
    properties.push({ name: m[1], label: m[2], type, ...(type === 'Range' ? { min: Number(m[4]), max: Number(m[5]) } : {}), default: m[6].trim().replace(/\s*\{\s*\}\s*$/, '') });
  }
  const tags = Object.fromEntries([...(text.match(/Tags\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/"(\w+)"\s*=\s*"([^"]*)"/g)].map(t => [t[1], t[2]]));
  const programs = [...text.matchAll(/(CGPROGRAM|HLSLPROGRAM)([\s\S]*?)(ENDCG|ENDHLSL)/g)].map(m => m[2]);
  const code = programs.join('\n');
  const surface = code.match(/#pragma\s+surface\s+(\w+)\s+(\w+)([^\n]*)/);
  const vertexFn = code.match(/#pragma\s+vertex\s+(\w+)/)?.[1] ?? null, fragmentFn = code.match(/#pragma\s+fragment\s+(\w+)/)?.[1] ?? null;
  const blend = text.match(/\bBlend\s+(\w+)\s+(\w+)/), cull = text.match(/\bCull\s+(\w+)/)?.[1], zwrite = text.match(/\bZWrite\s+(\w+)/)?.[1];
  return { name, properties, tags, programs, code, surface: surface ? { fn: surface[1], model: surface[2], options: surface[3].trim() } : null, vertexFn, fragmentFn, blend: blend ? [blend[1], blend[2]] : null, cull, zwrite };
}

function godotUniform(p) {
  const def = p.default;
  switch (p.type) {
    case 'Color': { const c = [...def.matchAll(/[-\d.]+/g)].map(x => x[0]); return `uniform vec4 ${p.name} : source_color = vec4(${(c.length === 4 ? c : ['1', '1', '1', '1']).map(n => (n.includes('.') ? n : `${n}.0`)).join(', ')});`; }
    case '2D': return `uniform sampler2D ${p.name}${/white/.test(def) ? ' : source_color, hint_default_white' : /black/.test(def) ? ' : hint_default_black' : /bump/.test(def) ? ' : hint_normal' : ' : source_color'};\nuniform vec4 ${p.name}_ST = vec4(1.0, 1.0, 0.0, 0.0);`;
    case 'Cube': return `uniform samplerCube ${p.name};`;
    case '3D': return `uniform sampler3D ${p.name};`;
    case 'Range': return `uniform float ${p.name} : hint_range(${p.min}, ${p.max}) = ${/\./.test(def) ? def : `${def}.0`};`;
    case 'Float': return `uniform float ${p.name} = ${/\./.test(def) ? def : `${def}.0`};`;
    case 'Int': case 'Integer': return `uniform int ${p.name} = ${def};`;
    case 'Vector': { const c = [...def.matchAll(/[-\d.]+/g)].map(x => x[0]); return `uniform vec4 ${p.name} = vec4(${(c.length === 4 ? c : ['0', '0', '0', '0']).map(n => (n.includes('.') ? n : `${n}.0`)).join(', ')});`; }
    default: return `// PORT: property ${p.name} (${p.type}) = ${def}`;
  }
}

/** Unity ShaderLab → Godot .gdshader (spatial, or canvas_item for sprite/UI shaders). */
export function shaderLabToGodot(text) {
  const sl = parseShaderLab(text);
  const notes = [], leftovers = new Set();
  const isSprite = /Sprites\/|"Queue"\s*=\s*"Transparent"|_MainTex.*Sprite|UI\//.test(text) && !sl.surface && !/NORMAL|normal/.test(sl.code);
  const type = isSprite ? 'canvas_item' : 'spatial';
  const modes = [];
  if (sl.cull === 'Off') modes.push('cull_disabled'); else if (sl.cull === 'Front') modes.push('cull_front');
  if (sl.blend) { const b = sl.blend.join(' '); if (/SrcAlpha OneMinusSrcAlpha/.test(b)) modes.push('blend_mix'); else if (/One One/.test(b)) modes.push('blend_add'); else if (/DstColor Zero/.test(b)) modes.push('blend_mul'); else notes.push(`Blend ${b}: pick the closest render_mode (blend_mix/add/sub/mul)`); }
  if (sl.zwrite === 'Off') modes.push('depth_draw_never');
  if (type === 'spatial' && sl.surface && /Unlit|NoLighting/i.test(sl.surface.model)) modes.push('unlit');
  if (type === 'spatial' && !sl.surface && !/lighting|_LightColor0|ShadeSH9|LIGHTING/i.test(sl.code)) modes.push('unlit');
  const uniforms = sl.properties.map(godotUniform);
  let body = hlslToGlsl(sl.code);
  for (const [re, to] of UNITY_TO_GODOT) body = body.replace(re, to);
  // Strip pragmas, includes, struct declarations with semantics, and the CG preamble.
  body = body.replace(/^\s*#pragma[^\n]*\n/gm, '').replace(/^\s*#include[^\n]*\n/gm, '').replace(/^\s*#(if|ifdef|ifndef|endif|else|elif|define)[^\n]*\n/gm, m => `// PORT: ${m.trim()}\n`);
  body = body.replace(/^\s*(?:uniform\s+)?(sampler2D|samplerCube|float|vec4|vec3|vec2|int|mat4|mat3)\s+(_\w+(?:_ST)?)\s*;\s*$/gm, (m, t, n) => (sl.properties.some(p => p.name === n || `${p.name}_ST` === n) ? '' : `uniform ${t} ${n}; // PORT: not in Properties; set it from code`));
  body = body.replace(/\bCBUFFER_START\s*\([^)]*\)|\bCBUFFER_END\b/g, '');
  const sections = [];
  if (sl.surface) {
    // Surface shader: surf(Input IN, inout SurfaceOutput o) → fragment() with ALBEDO/NORMAL_MAP/METALLIC/ROUGHNESS/EMISSION/ALPHA.
    const surfFn = findFunction(body, sl.surface.fn);
    let frag = surfFn ? surfFn.body : '\t// PORT: surf() body not found';
    const o = surfFn?.params.match(/inout\s+\w+\s+(\w+)/)?.[1] ?? 'o', inp = surfFn?.params.match(/(\w+)\s+(\w+)\s*,/)?.[2] ?? 'IN';
    frag = frag.replace(new RegExp(`\\b${inp}\\.uv_(\\w+)\\b`, 'g'), (m, tex) => `(UV * _${tex}_ST.xy + _${tex}_ST.zw)`).replace(new RegExp(`\\b${inp}\\.(worldPos|viewDir|screenPos|color|worldNormal)\\b`, 'g'), (m, k) => ({ worldPos: '(INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz', viewDir: 'VIEW', screenPos: 'vec4(SCREEN_UV, 0.0, 1.0)', color: 'COLOR', worldNormal: '(INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz' })[k]);
    frag = frag.replace(new RegExp(`\\b${o}\\.Albedo\\b`, 'g'), 'ALBEDO').replace(new RegExp(`\\b${o}\\.Normal\\b`, 'g'), 'NORMAL_MAP').replace(new RegExp(`\\b${o}\\.Metallic\\b`, 'g'), 'METALLIC').replace(new RegExp(`\\b${o}\\.Smoothness\\b`, 'g'), 'PORT_SMOOTHNESS').replace(new RegExp(`\\b${o}\\.Emission\\b`, 'g'), 'EMISSION').replace(new RegExp(`\\b${o}\\.Alpha\\b`, 'g'), 'ALPHA').replace(new RegExp(`\\b${o}\\.Occlusion\\b`, 'g'), 'AO').replace(new RegExp(`\\b${o}\\.Specular\\b`, 'g'), 'SPECULAR').replace(new RegExp(`\\b${o}\\.Gloss\\b`, 'g'), 'PORT_SMOOTHNESS');
    if (/PORT_SMOOTHNESS/.test(frag)) { frag = frag.replace(/PORT_SMOOTHNESS\s*=\s*([^;]+);/g, 'ROUGHNESS = 1.0 - ($1);').replace(/PORT_SMOOTHNESS/g, '(1.0 - ROUGHNESS)'); }
    if (/NORMAL_MAP\s*=/.test(frag)) { frag += '\n\tNORMAL_MAP_DEPTH = 1.0;'; }
    if (/\bALPHA\b/.test(frag) && !modes.includes('blend_mix')) notes.push('o.Alpha is written: the Godot shader uses ALPHA (transparent); for alphatest use ALPHA_SCISSOR_THRESHOLD');
    sections.push(`void fragment() {\n${frag.trim().split('\n').map(l => `\t${l.trim()}`).join('\n')}\n}`);
    if (sl.surface.options.includes('vertex:')) { const vfn = sl.surface.options.match(/vertex:(\w+)/)[1]; notes.push(`surface vertex function ${vfn}: move its body into vertex() (VERTEX/NORMAL/UV)`); }
    const helpers = stripFunction(body, sl.surface.fn).replace(/struct\s+\w+\s*\{[\s\S]*?\};/g, '');
    if (helpers.trim()) sections.unshift(helpers.trim().split('\n').filter(l => l.trim()).join('\n'));
  } else {
    // Vertex/fragment: appdata/v2f structs → VERTEX/UV/COLOR and varyings.
    const structs = [...body.matchAll(/struct\s+(\w+)\s*\{([\s\S]*?)\};/g)].map(m => ({ name: m[1], fields: [...m[2].matchAll(/\s*(\w+)\s+(\w+)\s*:\s*(\w+)\s*;/g)].map(f => ({ type: f[1], name: f[2], semantic: f[3] })) }));
    const varyings = [];
    const semanticMap = { POSITION: 'VERTEX', SV_POSITION: 'POSITION', NORMAL: 'NORMAL', TANGENT: 'TANGENT', COLOR: 'COLOR', TEXCOORD0: 'UV', TEXCOORD1: 'UV2' };
    let code2 = body.replace(/struct\s+\w+\s*\{[\s\S]*?\};/g, '');
    const vIn = structs.find(s => /appdata|Attributes|VertexInput/i.test(s.name)) ?? structs[0], vOut = structs.find(s => /v2f|Varyings|VertexOutput/i.test(s.name)) ?? structs[1];
    if (vOut) for (const fld of vOut.fields) if (!/SV_POSITION|POSITION/.test(fld.semantic)) varyings.push(`varying ${fld.type} v_${fld.name};`);
    const asMatch = fn => { if (!fn) return null; const pm = fn.params.match(/(\w+)\s+(\w+)/); return pm ? [null, pm[1], pm[2], fn.body] : [null, '', '', fn.body]; };
    const vert = sl.vertexFn ? asMatch(findFunction(code2, sl.vertexFn)) : null;
    const frag = sl.fragmentFn ? asMatch(findFunction(code2, sl.fragmentFn)) : null;
    let vbody = '', fbody = '';
    if (vert) {
      const inVar = vert[2];
      vbody = vert[3];
      const outVar = vbody.match(/\b(\w+)\s+(\w+)\s*;/)?.[2];
      for (const fld of vIn?.fields ?? []) vbody = vbody.replace(new RegExp(`\\b${inVar}\\.${fld.name}\\b`, 'g'), semanticMap[fld.semantic] ? (fld.semantic === 'POSITION' ? (type === 'spatial' ? 'vec4(VERTEX, 1.0)' : 'vec4(VERTEX, 0.0, 1.0)') : semanticMap[fld.semantic]) : `/* PORT: ${fld.semantic} */ ${fld.name}`);
      if (outVar) {
        vbody = vbody.replace(new RegExp(`^\\s*\\w+\\s+${outVar}\\s*;\\s*$`, 'm'), '').replace(new RegExp(`\\breturn\\s+${outVar}\\s*;`), '');
        for (const fld of vOut?.fields ?? []) vbody = vbody.replace(new RegExp(`\\b${outVar}\\.${fld.name}\\b`, 'g'), /SV_POSITION|POSITION/.test(fld.semantic) ? 'POSITION' : `v_${fld.name}`);
      }
      vbody = vbody.replace(/\bPOSITION\s*=\s*\(PROJECTION_MATRIX \* MODELVIEW_MATRIX \* vec4\(\(vec4\(VERTEX, (?:0\.0, )?1\.0\)\)\.xyz, 1\.0\)\);/g, '// vertex position: Godot projects VERTEX itself');
      vbody = vbody.replace(/\bPOSITION\s*=\s*\(PROJECTION_MATRIX \* MODELVIEW_MATRIX \* vec4\(\(([^;]+?)\)\.xyz, 1\.0\)\);/g, (m, e) => (type === 'spatial' ? `VERTEX = (${e}).xyz;` : `VERTEX = (${e}).xy;`));
      if (type === 'canvas_item') vbody = vbody.replace(/\bPOSITION\s*=\s*[^;]+;/g, m => `// PORT: ${m.trim()} (canvas_item: modify VERTEX instead)`);
    }
    if (frag) {
      const inVar = frag[2];
      fbody = frag[3];
      for (const fld of vOut?.fields ?? []) fbody = fbody.replace(new RegExp(`\\b${inVar}\\.${fld.name}\\b`, 'g'), /SV_POSITION|POSITION/.test(fld.semantic) ? 'FRAGCOORD' : vert ? `v_${fld.name}` : (semanticMap[fld.semantic] ?? `v_${fld.name}`));
      fbody = fbody.replace(/\breturn\s+([^;]+);/g, (m, e) => (type === 'canvas_item' ? `COLOR = ${e};` : `ALBEDO = (${e}).rgb;${/\.a\b|vec4/.test(e) ? `\n\tALPHA = (${e}).a;` : ''}`));
    }
    if (!vert && !frag) notes.push('vertex/fragment functions not found; the program body is kept as-is below');
    if (varyings.length) sections.push(varyings.join('\n'));
    let helpers = code2; if (sl.vertexFn) helpers = stripFunction(helpers, sl.vertexFn); if (sl.fragmentFn) helpers = stripFunction(helpers, sl.fragmentFn);
    helpers = helpers.split('\n').map(l => l.trim()).filter(l => l && !/^(sampler2D|float|vec[234]|int|mat[34])\s+_\w+;$/.test(l)).join('\n');
    if (helpers.trim()) sections.push(helpers);
    if (vbody.trim()) sections.push(`void vertex() {\n${vbody.trim().split('\n').map(l => `\t${l.trim()}`).join('\n')}\n}`);
    if (fbody.trim()) sections.push(`void fragment() {\n${fbody.trim().split('\n').map(l => `\t${l.trim()}`).join('\n')}\n}`);
    if (!vert && !frag) sections.push(`/* PORT: original program\n${body}\n*/`);
  }
  let out = [`shader_type ${type};`, modes.length ? `render_mode ${modes.join(', ')};` : '', `// Ported by ReversePort from Unity shader "${sl.name}". PORT: comments mark what needs a human.`, '', uniforms.join('\n'), '', ...sections].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
  for (const m of out.matchAll(LEFTOVER_RE)) leftovers.add(m[0]);
  out = out.replace(/\/\/ PORT: #(if|ifdef|ifndef|endif|else|elif|define)/g, '// PORT: #$1');
  if (/_ST\.xy/.test(out)) notes.push('Texture tiling/offset: *_ST uniforms kept (xy tiling, zw offset); set them in the material or remove');
  if (type === 'spatial' && !sl.surface) notes.push('Vertex/fragment shader ported as unlit spatial: Godot lights via light() or by removing render_mode unlit');
  return { text: out, type, name: sl.name, uniforms: sl.properties.map(p => p.name), leftovers: [...leftovers], notes };
}

// ------------------------------------------------------------------------------------------------ Shadertoy
export function shadertoyToGodot(text) {
  const notes = [];
  let body = text.replace(/\bmainImage\s*\(\s*out\s+vec4\s+(\w+)\s*,\s*(?:in\s+)?vec2\s+(\w+)\s*\)/, (m, color, coord) => `fragment()`).replace(/\biTime\b/g, 'TIME').replace(/\biTimeDelta\b/g, '(1.0 / 60.0)').replace(/\biFrame\b/g, 'int(TIME * 60.0)');
  const color = text.match(/mainImage\s*\(\s*out\s+vec4\s+(\w+)/)?.[1] ?? 'fragColor', coord = text.match(/mainImage\s*\([^,]+,\s*(?:in\s+)?vec2\s+(\w+)/)?.[1] ?? 'fragCoord';
  body = body.replace(new RegExp(`\\b${color}\\b`, 'g'), 'COLOR').replace(new RegExp(`\\b${coord}\\b`, 'g'), 'vec2(FRAGCOORD.x, iResolution.y - FRAGCOORD.y)');
  body = body.replace(/\biResolution\.xy\b/g, 'iResolution').replace(/\biResolution\b(?!\.y)/g, 'iResolution').replace(/\biMouse\b/g, 'iMouse');
  const channels = [...new Set([...text.matchAll(/\biChannel(\d)\b/g)].map(m => m[1]))];
  const uniforms = ['uniform vec2 iResolution = vec2(1920.0, 1080.0); // set from script: material.set_shader_parameter("iResolution", size)', 'uniform vec4 iMouse = vec4(0.0);', ...channels.map(c => `uniform sampler2D iChannel${c} : repeat_enable, filter_linear;`)];
  if (/\btexelFetch\b|\biChannelResolution\b|\biDate\b|\biSampleRate\b/.test(text)) notes.push('texelFetch/iChannelResolution/iDate/iSampleRate need uniforms or TEXTURE_PIXEL_SIZE equivalents');
  if (/\bmainSound\b|\bmainVR\b/.test(text)) notes.push('mainSound/mainVR are not ported');
  const out = ['shader_type canvas_item;', '// Ported by ReversePort from Shadertoy GLSL. Put it on a full-screen ColorRect and feed iResolution from code.', '', ...uniforms, '', body.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '')].join('\n') + '\n';
  return { text: out, type: 'canvas_item', uniforms: ['iResolution', 'iMouse', ...channels.map(c => `iChannel${c}`)], leftovers: [], notes };
}

export function shadertoyToThree(text) {
  const channels = [...new Set([...text.matchAll(/\biChannel(\d)\b/g)].map(m => m[1]))];
  const frag = ['precision highp float;', 'uniform vec3 iResolution;', 'uniform float iTime;', 'uniform float iTimeDelta;', 'uniform int iFrame;', 'uniform vec4 iMouse;', ...channels.map(c => `uniform sampler2D iChannel${c};`), '', text.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, ''), '', 'void main() { mainImage(gl_FragColor, gl_FragCoord.xy); }'].join('\n');
  const js = `// three.js ShaderMaterial for a Shadertoy shader (ported by ReversePort). Render it on a full-screen quad.
import * as THREE from 'three';
export const fragmentShader = ${JSON.stringify(frag)};
export const vertexShader = 'void main() { gl_Position = vec4(position, 1.0); }';
export function createShadertoyMaterial(renderer) {
  const uniforms = { iResolution: { value: new THREE.Vector3(1, 1, 1) }, iTime: { value: 0 }, iTimeDelta: { value: 0 }, iFrame: { value: 0 }, iMouse: { value: new THREE.Vector4() }${channels.map(c => `, iChannel${c}: { value: null }`).join('')} };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  const size = new THREE.Vector2();
  material.userData.update = (dt) => { renderer.getSize(size); uniforms.iResolution.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), 1); uniforms.iTime.value += dt; uniforms.iTimeDelta.value = dt; uniforms.iFrame.value++; };
  return material;
}
`;
  return { text: js, type: 'threejs', uniforms: ['iResolution', 'iTime', 'iMouse', ...channels.map(c => `iChannel${c}`)], leftovers: [], notes: ['Call material.userData.update(dt) every frame; load textures into iChannelN.'] };
}

// ------------------------------------------------------------------------------------------------ Godot → others
export function parseGodotShader(text) {
  const type = text.match(/^\s*shader_type\s+(\w+)/m)?.[1] ?? 'spatial';
  const modes = (text.match(/^\s*render_mode\s+([^;]+);/m)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const uniforms = [...text.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)\s*(?::\s*([^=;]+))?\s*(?:=\s*([^;]+))?;/gm)].map(m => ({ type: m[1], name: m[2], hints: (m[3] ?? '').split(',').map(s => s.trim()).filter(Boolean), default: m[4]?.trim() ?? null }));
  const fn = n => text.match(new RegExp(`void\\s+${n}\\s*\\(\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? null;
  const rest = text.replace(/^\s*shader_type[^\n]*\n|^\s*render_mode[^\n]*\n|^\s*uniform[^\n]*\n/gm, '').replace(/void\s+(vertex|fragment|light)\s*\(\s*\)\s*\{[\s\S]*?\n\}/g, '').split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).join('\n');
  return { type, modes, uniforms, vertex: fn('vertex'), fragment: fn('fragment'), light: fn('light'), helpers: rest };
}

export function godotToThree(text) {
  const g = parseGodotShader(text);
  const notes = [], leftovers = new Set();
  const uDecl = g.uniforms.map(u => `uniform ${u.type === 'sampler2D' ? 'sampler2D' : u.type} ${u.name};`);
  const nums = d => (d ?? '').replace(/^\w+\s*\(/, '').match(/[-\d.]+/g) ?? [];
  const uJs = g.uniforms.map(u => `${u.name}: { value: ${u.type === 'sampler2D' ? 'null' : u.type.startsWith('vec') ? `new THREE.${u.type === 'vec2' ? 'Vector2' : u.type === 'vec3' ? 'Vector3' : 'Vector4'}(${nums(u.default).join(', ')})` : u.type === 'bool' ? (u.default ?? 'false') : (u.default ?? '0')} }`);
  const sub = s => s.replace(/\bMETALLIC\b/g, 'metallic').replace(/\bROUGHNESS\b/g, 'roughness').replace(/\bVIEW\b/g, 'normalize(vViewDir)').replace(/\bNORMAL\b/g, 'normalize(vNormal)').replace(/\bTIME\b/g, 'time').replace(/\bUV\b/g, 'vUv').replace(/\bCOLOR\b/g, 'gl_FragColor').replace(/\bTEXTURE\b/g, 'map').replace(/\bSCREEN_PIXEL_SIZE\b/g, '(1.0 / resolution)').replace(/\bFRAGCOORD\b/g, 'gl_FragCoord').replace(/\bSCREEN_UV\b/g, '(gl_FragCoord.xy / resolution)').replace(/\bTEXTURE_PIXEL_SIZE\b/g, 'texturePixelSize').replace(/\bPI\b/g, '3.14159265359').replace(/\bVERTEX\b/g, 'position').replace(/\bNORMAL\b/g, 'normal').replace(/\bALBEDO\b/g, 'albedo').replace(/\bALPHA\b/g, 'alpha').replace(/\bEMISSION\b/g, 'emission');
  const frag = sub(g.fragment ?? '');
  const vert = sub(g.vertex ?? '');
  const extra = ['uniform float time;', 'uniform vec2 resolution;', ...(/\bmap\b/.test(frag) ? ['uniform sampler2D map;', 'uniform vec2 texturePixelSize;'] : [])];
  const is2d = g.type === 'canvas_item';
  const fragmentShader = [...extra, ...uDecl, 'varying vec2 vUv;', sub(g.helpers), is2d ? `void main() {\n\tvec4 gl_FragColor_in = vec4(1.0);\n${frag.replace(/^\s*/gm, '\t').replace(/gl_FragColor\s*=\s*/g, 'gl_FragColor = ')}\n}` : `varying vec3 vNormal;\nvarying vec3 vViewDir;\nvoid main() {\n\tvec3 albedo = vec3(1.0); float alpha = 1.0; vec3 emission = vec3(0.0); float metallic = 0.0; float roughness = 1.0;\n${frag.replace(/^\s*/gm, '\t')}\n\tgl_FragColor = vec4(albedo + emission, alpha); // PORT: unlit (metallic/roughness ignored); for PBR use MeshStandardMaterial.onBeforeCompile\n}`].filter(Boolean).join('\n');
  const vertexShader = ['varying vec2 vUv;', ...(is2d ? [] : ['varying vec3 vNormal;', 'varying vec3 vViewDir;']), ...uDecl.filter(d => /sampler/.test(d) === false), 'uniform float time;', `void main() {\n\tvUv = uv;\n\tvec3 pos = position;${is2d ? '' : '\n\tvNormal = normalize(normalMatrix * normal);\n\tvViewDir = -(modelViewMatrix * vec4(pos, 1.0)).xyz;'}${vert ? '\n' + vert.replace(/\bposition\b/g, 'pos').replace(/^\s*/gm, '\t') : ''}\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);\n}`].join('\n');
  for (const m of (fragmentShader + vertexShader).matchAll(/\b(LIGHT\w*|ATTENUATION|SPECULAR|METALLIC|ROUGHNESS|NORMAL_MAP\w*|VIEW|CAMERA_\w+|MODEL\w*_MATRIX|INV_\w+_MATRIX|PROJECTION_MATRIX|VIEW_MATRIX|CANVAS_MATRIX|SCREEN_TEXTURE|DEPTH_TEXTURE|NORMAL_ROUGHNESS_TEXTURE|POINT_COORD|INSTANCE_CUSTOM|AT_LIGHT_PASS|hint_\w+|source_color)\b/g)) leftovers.add(m[0]);
  if (g.light) notes.push('light() has no three.js equivalent in a ShaderMaterial; use MeshStandardMaterial with onBeforeCompile or a custom lighting loop');
  const js = `// three.js ShaderMaterial ported by ReversePort from a Godot ${g.type} shader. PORT: comments mark what needs a human.
import * as THREE from 'three';
export const vertexShader = ${JSON.stringify(vertexShader)};
export const fragmentShader = ${JSON.stringify(fragmentShader)};
export function createMaterial() {
  const uniforms = { time: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) }${/\bmap\b/.test(frag) ? ', map: { value: null }, texturePixelSize: { value: new THREE.Vector2(1 / 256, 1 / 256) }' : ''}${uJs.length ? ', ' + uJs.join(', ') : ''} };
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader${is2d || g.modes.includes('blend_mix') ? ', transparent: true' : ''}${g.modes.includes('blend_add') ? ', blending: THREE.AdditiveBlending' : ''}${g.modes.includes('cull_disabled') ? ', side: THREE.DoubleSide' : ''} });
}
`;
  return { text: js, type: 'threejs', uniforms: g.uniforms.map(u => u.name), leftovers: [...leftovers], notes };
}

export function godotToUnity(text, name = 'Ported') {
  const g = parseGodotShader(text);
  const notes = [], leftovers = new Set();
  const nums = d => (d ?? '').replace(/^\w+\s*\(/, '').match(/[-\d.]+/g);
  const propOf = u => {
    const hint = u.hints.join(' ');
    if (u.type === 'sampler2D') return `${u.name} ("${u.name}", 2D) = "${/hint_normal/.test(hint) ? 'bump' : 'white'}" {}`;
    if (u.type === 'vec4' && /source_color|hint_color/.test(hint)) return `${u.name} ("${u.name}", Color) = (${(nums(u.default) ?? ['1', '1', '1', '1']).join(', ')})`;
    if (u.type === 'vec4' || u.type === 'vec3' || u.type === 'vec2') return `${u.name} ("${u.name}", Vector) = (${[...(nums(u.default) ?? []), '0', '0', '0', '0'].slice(0, 4).join(', ')})`;
    if (u.type === 'float') { const r = hint.match(/hint_range\(([^,]+),\s*([^,)]+)/); return r ? `${u.name} ("${u.name}", Range(${r[1].trim()}, ${r[2].trim()})) = ${u.default ?? '0'}` : `${u.name} ("${u.name}", Float) = ${u.default ?? '0'}`; }
    if (u.type === 'int') return `${u.name} ("${u.name}", Int) = ${u.default ?? '0'}`;
    return `// PORT: uniform ${u.type} ${u.name}`;
  };
  const toHlsl = s => s.replace(/\bvec2\b/g, 'float2').replace(/\bvec3\b/g, 'float3').replace(/\bvec4\b/g, 'float4').replace(/\bmat3\b/g, 'float3x3').replace(/\bmat4\b/g, 'float4x4').replace(/\bmix\s*\(/g, 'lerp(').replace(/\bfract\s*\(/g, 'frac(').replace(/\bmod\s*\(/g, 'fmod(').replace(/\bdFdx\s*\(/g, 'ddx(').replace(/\bdFdy\s*\(/g, 'ddy(').replace(/\binversesqrt\s*\(/g, 'rsqrt(').replace(/\btexture\s*\(\s*(\w+)\s*,/g, 'tex2D($1,').replace(/\btextureLod\s*\(\s*(\w+)\s*,\s*([^,]+),\s*([^)]+)\)/g, 'tex2Dlod($1, float4($2, 0, $3))').replace(/\bTIME\b/g, '_Time.y').replace(/\bUV\b/g, 'i.uv').replace(/\bCOLOR\b/g, 'col').replace(/\bTEXTURE\b/g, '_MainTex').replace(/\bSCREEN_PIXEL_SIZE\b/g, '(1.0 / _ScreenParams.xy)').replace(/\bFRAGCOORD\b/g, 'i.vertex').replace(/\bPI\b/g, 'UNITY_PI').replace(/\bSCREEN_UV\b/g, '(i.vertex.xy / _ScreenParams.xy)').replace(/\bVERTEX\b/g, 'v.vertex.xyz').replace(/\bNORMAL\b/g, 'v.normal');
  const is2d = g.type === 'canvas_item';
  const props = g.uniforms.map(propOf);
  const hlslUniforms = g.uniforms.map(u => `${u.type === 'sampler2D' ? 'sampler2D' : u.type === 'vec4' ? 'float4' : u.type === 'vec3' ? 'float3' : u.type === 'vec2' ? 'float2' : u.type} ${u.name};`);
  let out;
  if (is2d) {
    const frag = toHlsl(g.fragment ?? '\tcol = tex2D(_MainTex, i.uv) * i.color;');
    out = `Shader "ReversePort/${name}"
{
    // Ported by ReversePort from a Godot canvas_item shader. PORT: comments mark what needs a human.
    Properties
    {
        _MainTex ("Sprite Texture", 2D) = "white" {}
${props.map(p => `        ${p}`).join('\n')}
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Cull Off ZWrite Off Blend ${g.modes.includes('blend_add') ? 'One One' : 'SrcAlpha OneMinusSrcAlpha'}
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            struct v2f { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            sampler2D _MainTex;
${hlslUniforms.map(l => `            ${l}`).join('\n')}
${toHlsl(g.helpers).split('\n').map(l => `            ${l}`).join('\n')}
            v2f vert (appdata v) { v2f o; o.vertex = UnityObjectToClipPos(v.vertex); o.uv = v.uv; o.color = v.color; ${g.vertex ? '/* PORT: vertex() body: ' + toHlsl(g.vertex).trim().replace(/\n/g, ' ') + ' */' : ''} return o; }
            fixed4 frag (v2f i) : SV_Target
            {
                float4 col = tex2D(_MainTex, i.uv) * i.color;
${frag.split('\n').map(l => `                ${l.trim()}`).join('\n')}
                return col;
            }
            ENDCG
        }
    }
}
`;
  } else {
    const frag = toHlsl((g.fragment ?? '').replace(/\bNORMAL\b/g, 'IN.worldNormal').replace(/\bVIEW\b/g, 'normalize(IN.viewDir)')).replace(/\bALBEDO\b/g, 'o.Albedo').replace(/\bALPHA\b/g, 'o.Alpha').replace(/\bMETALLIC\b/g, 'o.Metallic').replace(/\bROUGHNESS\s*=\s*([^;]+);/g, 'o.Smoothness = 1.0 - ($1);').replace(/\bROUGHNESS\b/g, '(1.0 - o.Smoothness)').replace(/\bEMISSION\b/g, 'o.Emission').replace(/\bNORMAL_MAP\b/g, 'o.Normal').replace(/\bAO\b/g, 'o.Occlusion').replace(/\bi\.uv\b/g, 'IN.uv_MainTex');
    out = `Shader "ReversePort/${name}"
{
    // Ported by ReversePort from a Godot spatial shader as a Standard surface shader (built-in pipeline). PORT: comments mark what needs a human.
    Properties
    {
        _MainTex ("Albedo", 2D) = "white" {}
${props.map(p => `        ${p}`).join('\n')}
    }
    SubShader
    {
        Tags { "RenderType"="${g.modes.includes('blend_mix') ? 'Transparent" "Queue"="Transparent' : 'Opaque'}" }
        ${g.modes.includes('cull_disabled') ? 'Cull Off' : ''}
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows${g.modes.includes('blend_mix') ? ' alpha:fade' : ''}${g.modes.includes('unlit') ? ' // PORT: unlit in Godot; use an Unlit shader or #pragma surface surf NoLighting' : ''}
        #pragma target 3.0
        sampler2D _MainTex;
${hlslUniforms.map(l => `        ${l}`).join('\n')}
        struct Input { float2 uv_MainTex; float3 worldPos; float3 worldNormal; float3 viewDir; float4 screenPos; float4 color : COLOR; };
${toHlsl(g.helpers).split('\n').map(l => `        ${l}`).join('\n')}
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            o.Albedo = tex2D(_MainTex, IN.uv_MainTex).rgb;
${frag.split('\n').map(l => `            ${l.trim()}`).join('\n')}
        }
        ENDCG
    }
    FallBack "Diffuse"
}
`;
    if (g.vertex) notes.push('vertex() body: add "vertex:vert" to the surface pragma and port it into void vert(inout appdata_full v)');
    if (g.light) notes.push('light(): write a custom lighting model (#pragma surface surf Custom) by hand');
  }
  for (const m of out.matchAll(/\b(LIGHT\w*|ATTENUATION|VIEW|CAMERA_\w+|MODEL\w*_MATRIX|INV_\w+_MATRIX|PROJECTION_MATRIX|VIEW_MATRIX|SCREEN_TEXTURE|DEPTH_TEXTURE|POINT_COORD|INSTANCE_CUSTOM|TEXTURE_PIXEL_SIZE|UV2|TANGENT|BINORMAL|RIM|CLEARCOAT\w*|ANISOTROPY\w*|SSS_\w+|BACKLIGHT|FOG)\b/g)) leftovers.add(m[0]);
  return { text: out, type: 'shaderlab', uniforms: g.uniforms.map(u => u.name), leftovers: [...leftovers], notes };
}

// ------------------------------------------------------------------------------------------------ tool
export async function portShaderTool({ file, content, to = 'godot', out, name } = {}) {
  if (!file && !content) throw new RPError('INVALID_ARGUMENT', 'Give file or content.');
  let text = content, abs = null;
  if (file) { abs = (await requireFile(file)).abs; text = await fs.readFile(abs, 'utf8'); }
  const kind = detectShader(text, abs ?? '');
  const target = String(to).toLowerCase().replace(/[^a-z]/g, '');
  const base = name ?? (abs ? path.basename(abs).replace(/\.[^.]+$/, '') : 'shader');
  let r, ext;
  if (kind === 'shaderlab' && target === 'godot') { r = shaderLabToGodot(text); ext = '.gdshader'; }
  else if (kind === 'shadertoy' && target === 'godot') { r = shadertoyToGodot(text); ext = '.gdshader'; }
  else if (kind === 'shadertoy' && target === 'threejs') { r = shadertoyToThree(text); ext = '.js'; }
  else if (kind === 'godot' && target === 'threejs') { r = godotToThree(text); ext = '.js'; }
  else if (kind === 'godot' && target === 'unity') { r = godotToUnity(text, base); ext = '.shader'; }
  else if (kind === 'glsl' && target === 'godot') { r = shadertoyToGodot(text.replace(/\bgl_FragColor\b/g, 'fragColor').replace(/\bgl_FragCoord\.xy\b/g, 'fragCoord').replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, 'void mainImage(out vec4 fragColor, in vec2 fragCoord)')); ext = '.gdshader'; r.notes.push('Plain GLSL treated like a Shadertoy image shader (gl_FragColor/gl_FragCoord mapped); declare any other uniforms'); }
  else if (kind === 'hlsl' && target === 'godot') { r = { text: `shader_type spatial;\n// Ported by ReversePort: HLSL include translated to GLSL syntax; wire it into vertex()/fragment() by hand.\n\n${hlslToGlsl(text)}`, type: 'spatial', uniforms: [], leftovers: [...new Set([...hlslToGlsl(text).matchAll(LEFTOVER_RE)].map(m => m[0]))], notes: ['No ShaderLab wrapper found: functions translated, entry points left to you'] }; ext = '.gdshader'; }
  else throw new RPError('INVALID_ARGUMENT', `Cannot port a ${kind} shader to ${target}. Supported: shaderlab→godot, shadertoy/glsl→godot, shadertoy→threejs, godot→threejs, godot→unity, hlsl→godot.`);
  const dest = out ? path.resolve(out) : path.join(await workspaceDir('shaders'), `${base}${ext}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, r.text);
  const portMarks = (r.text.match(/PORT:/g) ?? []).length;
  return {
    source: abs ?? '(content)', detected: kind, target, file: dest, shaderType: r.type, uniforms: r.uniforms, leftovers: r.leftovers, portMarkers: portMarks, notes: r.notes,
    preview: r.text.slice(0, 6000),
    next: r.leftovers.length || portMarks ? `Resolve the ${r.leftovers.length} leftover identifier(s) and ${portMarks} PORT: marker(s) in ${dest}, then compile it in the target engine; lighting and coordinate-space differences are not provable here.` : `Compile ${dest} in the target engine and compare against the original on the same mesh/sprite.`,
  };
}
