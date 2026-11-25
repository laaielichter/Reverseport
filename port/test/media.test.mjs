import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeWebp } from '../src/webp.mjs';
import { decodeQoa } from '../src/godot-import.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'media');
const expected = JSON.parse(await fs.readFile(path.join(F, 'expected.json'), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

for (const [name, exp] of Object.entries(expected).filter(([n]) => n.endsWith('.webp'))) {
  test(`WebP lossless ${name}: the same pixels as libwebp`, async () => {
    const r = decodeWebp(await fs.readFile(path.join(F, name)));
    assert.ok(r, 'decoded');
    assert.equal(r.rgba.length, r.width * r.height * 4);
    assert.equal(sha(r.rgba), exp.rgbaSha256);
  });
}

test('lossy WebP is not decoded (null), so the caller keeps the .webp', async () => {
  assert.equal(decodeWebp(await fs.readFile(path.join(F, 'lossy.webp'))), null);
});

test('a damaged VP8L stream is a BAD_FORMAT error, not a crash or a wrong picture', async () => {
  const buf = Buffer.from(await fs.readFile(path.join(F, 'lossless-a-q100-m6.webp')));
  const cut = buf.subarray(0, 200);
  cut.writeUInt32LE(cut.length - 8, 4);
  assert.throws(() => decodeWebp(cut), e => e.code === 'BAD_FORMAT');
});

for (const [name, exp] of Object.entries(expected).filter(([n]) => n.endsWith('.qoa'))) {
  test(`QOA ${name}: the same samples as qoa.h`, async () => {
    const r = decodeQoa(await fs.readFile(path.join(F, name)));
    assert.equal(r.channels, exp.channels);
    assert.equal(r.frames, exp.frames);
    assert.equal(r.sampleRate, 44100);
    assert.equal(sha(r.pcm), exp.pcmSha256);
  });
}

test('QOA that ends early is a BAD_FORMAT error', async () => {
  const buf = await fs.readFile(path.join(F, 'stereo-5200.qoa'));
  assert.throws(() => decodeQoa(buf.subarray(0, buf.length - 100)), e => e.code === 'BAD_FORMAT' && /ends after/.test(e.message));
});
