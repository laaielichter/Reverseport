lossless-*.webp: WebP lossless (VP8L) files made with ffmpeg + libwebp (-lossless 1, several -quality and
-compression_level values) from generated images: ffmpeg test patterns, a palette of 2/4/16/200 colours, alpha,
a 3x1000 strip and a 1x1 image, so every transform (predictor, cross-colour, subtract-green, colour indexing with
pixel bundling), the colour cache and meta prefix codes are hit. lossy.webp: VP8, for the "not decoded" path.
*.qoa: QOA files written by the reference encoder (Godot's thirdparty/misc/qoa.h) from generated samples.
expected.json: SHA-256 of the RGBA pixels as ffmpeg decodes each WebP, and of the 16-bit PCM as qoa.h decodes
each QOA file. Used by port/test/media.test.mjs.
