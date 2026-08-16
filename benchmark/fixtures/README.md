# Compression benchmark corpus

This directory is intentionally separate from `test/fixtures/`.

- `test/fixtures/` exists to catch regressions and odd container/metadata cases.
- `benchmark/fixtures/` exists to compare compression time against output size on a small set of realistic images.

The benchmark corpus is capped at eight image files so it remains fast enough to run during tuning work. The files are never modified by the benchmark and are excluded from the packaged VSIX.

## Sources

### JPEG

- `jpeg/photo-portrait.jpg` — `Portrait_1.jpg` from `recurser/exif-orientation-examples`. The repository states that its example images are MIT licensed.
- `jpeg/photo-oriented.jpg` — `Landscape_6.jpg` from the same MIT-licensed fixture set. It carries EXIF orientation 6 so JPEG strategies also exercise metadata/orientation preservation.

Source repository: `https://github.com/recurser/exif-orientation-examples`

The upstream MIT license notice is preserved in `LICENSE-exif-orientation-examples.txt`.

### PNG

- `png/transparent-graphic.png` — Sharp's `blackbug.png` fixture. Sharp's fixture index marks it as public domain.
- `png/photo.png` — derived locally from the MIT-licensed `photo-portrait.jpg` fixture using Sharp PNG compression level 3 with adaptive filtering disabled. This intentionally leaves useful lossless optimization work for the benchmark.

### WebP

- `webp/photo.webp` — derived locally from `photo-portrait.jpg` with libwebp `cwebp` using lossless preset `-z 3` and `-exact`.
- `webp/transparent-graphic.webp` — derived locally from the public-domain `transparent-graphic.png` with the same `cwebp` settings.

These inputs use a moderate lossless encode rather than a maximum-effort encode so the benchmark can measure whether higher effort is worth its runtime.

### GIF

- `gif/animation.gif` — Sharp's `rotating-squares.gif` fixture. Sharp's fixture index identifies the source as CC0 from loading.io. It contains 30 animation frames.

### AVIF

- `avif/photo.avif` — derived locally from `photo-portrait.jpg` using Sharp lossless AVIF at effort 2 and 8-bit depth. The lower source effort intentionally leaves room to compare effort 4/6/9 re-encoding.

## Regenerating derived files

The checked-in derived files should normally remain fixed. If they intentionally need to be regenerated, use the same source files and settings:

```sh
node - <<'NODE'
const sharp = require("sharp");

(async () => {
  await sharp("benchmark/fixtures/jpeg/photo-portrait.jpg")
    .png({ compressionLevel: 3, adaptiveFiltering: false, palette: false })
    .toFile("benchmark/fixtures/png/photo.png");

  await sharp("benchmark/fixtures/jpeg/photo-portrait.jpg")
    .avif({ lossless: true, effort: 2, bitdepth: 8 })
    .toFile("benchmark/fixtures/avif/photo.avif");
})();
NODE

cwebp -quiet -lossless -z 3 -exact \
  benchmark/fixtures/jpeg/photo-portrait.jpg \
  -o benchmark/fixtures/webp/photo.webp

cwebp -quiet -lossless -z 3 -exact \
  benchmark/fixtures/png/transparent-graphic.png \
  -o benchmark/fixtures/webp/transparent-graphic.webp
```

The two WebP regeneration commands require a separately installed libwebp `cwebp`; it is no longer bundled by the extension.

Do not replace these with random downloaded images without recording provenance and redistribution terms here.
