import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { portShaderTool, detectShader, hlslToGlsl, shaderLabToGodot, shadertoyToGodot, godotToThree, godotToUnity } from '../src/shader.mjs';

const SURFACE = `Shader "Custom/Dissolve"
{
    Properties
    {
        _Color ("Color", Color) = (1,1,1,1)
        _MainTex ("Albedo (RGB)", 2D) = "white" {}
        _Cutoff ("Cutoff", Range(0,1)) = 0.5
        _Glossiness ("Smoothness", Range(0,1)) = 0.5
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        Cull Off
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows
        sampler2D _MainTex;
        struct Input { float2 uv_MainTex; };
        half _Glossiness; half _Cutoff; fixed4 _Color;
        float remap(float v, float a, float b) { return saturate((v - a) / (b - a)); }
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            fixed4 c = tex2D (_MainTex, IN.uv_MainTex) * _Color;
            clip(c.r - _Cutoff);
            float edge = 1 - remap(c.r - _Cutoff, 0, 0.1);
            if (edge > 0.5) { o.Emission = float3(1, 0, 0); }
            o.Albedo = lerp(c.rgb, float3(1,1,1), edge) * abs(sin(_Time.y));
            o.Smoothness = _Glossiness;
            o.Alpha = c.a;
        }
        ENDCG
    }
}`;

const VERTFRAG = `Shader "Unlit/Wave"
{
    Properties { _MainTex ("Texture", 2D) = "white" {} _Amp ("Amplitude", Float) = 0.1 }
    SubShader
    {
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float2 uv : TEXCOORD0; float4 vertex : SV_POSITION; float3 wp : TEXCOORD1; };
            sampler2D _MainTex; float4 _MainTex_ST; float _Amp;
            v2f vert (appdata v)
            {
                v2f o;
                float4 p = v.vertex;
                p.y += sin(p.x * 4 + _Time.y) * _Amp;
                o.vertex = UnityObjectToClipPos(p);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.wp = mul(unity_ObjectToWorld, p).xyz;
                return o;
            }
            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = tex2D(_MainTex, i.uv);
                col.rgb *= frac(i.wp.y);
                return col;
            }
            ENDCG
        }
    }
}`;

const TOY = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/iResolution.xy;
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
    col *= texture(iChannel0, uv).rgb;
    fragColor = vec4(col,1.0);
}`;

const GD2D = `shader_type canvas_item;
render_mode blend_add;
uniform vec4 tint : source_color = vec4(1.0, 0.5, 0.0, 1.0);
uniform float strength : hint_range(0.0, 4.0) = 1.5;
float pulse(float t) { return 0.5 + 0.5 * sin(t * 3.0); }
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	COLOR = c * tint * (strength * pulse(TIME));
}`;

const GD3D = `shader_type spatial;
uniform vec4 albedo_color : source_color = vec4(0.2, 0.4, 1.0, 1.0);
uniform float rim_power : hint_range(0.5, 8.0) = 3.0;
void fragment() {
	float rim = pow(1.0 - dot(NORMAL, VIEW), rim_power);
	ALBEDO = albedo_color.rgb;
	EMISSION = vec3(rim);
	ROUGHNESS = 0.4;
}`;

test('detection and HLSL → GLSL basics', () => {
  assert.equal(detectShader(SURFACE), 'shaderlab');
  assert.equal(detectShader(TOY), 'shadertoy');
  assert.equal(detectShader(GD2D), 'godot');
  const g = hlslToGlsl('float4 c = lerp(a, b, saturate(t)); float2 d = frac(uv) * 2; half3 n = mul(M, v).xyz; clip(c.a - 0.5);');
  assert.ok(g.includes('vec4 c = mix(a, b, clamp(t, 0.0, 1.0));'));
  assert.ok(g.includes('vec2 d = fract(uv) * 2.0;'));
  assert.ok(g.includes('vec3 n = (M * v).xyz;'));
  assert.ok(g.includes('if ((c.a - 0.5) < 0.0) { discard; }'));
});

test('ShaderLab surface shader → Godot spatial with mapped outputs', () => {
  const r = shaderLabToGodot(SURFACE);
  assert.equal(r.type, 'spatial');
  assert.ok(r.text.includes('render_mode cull_disabled;'));
  assert.ok(r.text.includes('uniform vec4 _Color : source_color = vec4(1.0, 1.0, 1.0, 1.0);'));
  assert.ok(r.text.includes('uniform float _Cutoff : hint_range(0, 1) = 0.5;'));
  assert.ok(r.text.includes('float remap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }'));
  assert.ok(r.text.includes('texture(_MainTex, (UV * _MainTex_ST.xy + _MainTex_ST.zw)) * _Color;'));
  assert.ok(r.text.includes('ALBEDO = mix(c.rgb, vec3(1.0,1.0,1.0), edge) * abs(sin(TIME));'), r.text);
  assert.ok(r.text.includes('ROUGHNESS = 1.0 - (_Glossiness);') && r.text.includes('ALPHA = c.a;') && r.text.includes('EMISSION = vec3(1.0, 0.0, 0.0);'));
  assert.ok(r.text.includes('discard;'));
  assert.ok(r.text.includes('float edge = 1.0 - remap(c.r - _Cutoff, 0.0, 0.1);'));
  assert.deepEqual(r.leftovers, []);
});

test('ShaderLab vertex/fragment shader → Godot vertex()/fragment() with varyings', () => {
  const r = shaderLabToGodot(VERTFRAG);
  assert.ok(r.text.includes('render_mode unlit;'));
  assert.ok(r.text.includes('varying vec2 v_uv;') && r.text.includes('varying vec3 v_wp;'));
  assert.ok(r.text.includes('void vertex() {') && r.text.includes('vec4 p = vec4(VERTEX, 1.0);') && r.text.includes('VERTEX = (p).xyz;'));
  assert.ok(r.text.includes('p.y += sin(p.x * 4.0 + TIME) * _Amp;'));
  assert.ok(r.text.includes('v_wp = (MODEL_MATRIX * p).xyz;'));
  assert.ok(r.text.includes('void fragment() {') && r.text.includes('vec4 col = texture(_MainTex, v_uv);') && r.text.includes('ALBEDO = (col).rgb;'));
  assert.deepEqual(r.leftovers, []);
});

test('Shadertoy → Godot canvas_item and three.js; Godot → three.js and Unity', async () => {
  const g = shadertoyToGodot(TOY);
  assert.ok(g.text.startsWith('shader_type canvas_item;'));
  assert.ok(g.text.includes('uniform sampler2D iChannel0') && g.text.includes('vec2 uv = vec2(FRAGCOORD.x, iResolution.y - FRAGCOORD.y)/iResolution;') && g.text.includes('cos(TIME+') && g.text.includes('COLOR = vec4(col,1.0);'));
  const t3 = godotToThree(GD2D);
  assert.ok(t3.text.includes('gl_FragColor = c * tint * (strength * pulse(time));') && t3.text.includes('tint: { value: new THREE.Vector4(1.0, 0.5, 0.0, 1.0) }') && t3.text.includes('blending: THREE.AdditiveBlending'));
  const u2 = godotToUnity(GD2D, 'glow');
  assert.ok(u2.text.includes('tint ("tint", Color) = (1.0, 0.5, 0.0, 1.0)') && u2.text.includes('Blend One One') && u2.text.includes('col = c * tint * (strength * pulse(_Time.y));'));
  const u3 = godotToUnity(GD3D, 'rim');
  assert.ok(u3.text.includes('#pragma surface surf Standard') && u3.text.includes('dot(IN.worldNormal, normalize(IN.viewDir))') && u3.text.includes('o.Smoothness = 1.0 - (0.4);'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-shader-'));
  const r = await portShaderTool({ content: TOY, to: 'threejs', out: path.join(dir, 'toy.js') });
  assert.equal(r.detected, 'shadertoy');
  assert.ok((await fs.readFile(path.join(dir, 'toy.js'), 'utf8')).includes('createShadertoyMaterial'));
  await assert.rejects(portShaderTool({ content: SURFACE, to: 'threejs' }), /Cannot port/);
  await fs.rm(dir, { recursive: true, force: true });
});
