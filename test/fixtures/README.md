# Regression fixture corpus

These fixtures exist to catch behavior that clean programmatically generated test images can miss.

Tests should prefer fixed files from this directory for product-level regression coverage. Small synthetic images are still useful for narrow unit cases where constructing the exact edge condition is clearer than storing another binary.

## PNG

- `png/macos-screenshot-opaque-alpha.png` — exact macOS screenshot that exposed the redundant-opaque-alpha validation bug. Source file was copied from this repository's `images/` directory without modification. OxiPNG can remove its unused alpha channel while preserving the decoded RGBA image.
- `png/extension-icon-transparent.png` — fixed copy of the real extension icon. Contains genuine transparency plus EXIF/XMP metadata.
- `png/vscode-result-metadata.png` — fixed copy of the real VS Code result screenshot. Useful for a larger metadata-bearing PNG.
- `png/already-optimized.png` — the opaque-alpha screenshot after an OxiPNG `-o max -i keep` pass. Used to verify no-op/idempotent behavior on an already optimized real image.

## JPEG

- `jpeg/oriented-exif.jpg` — fixed regression file derived once from the repository-owned VS Code screenshot and stored with EXIF orientation 6 and density metadata. Used to test displayed-width resize and EXIF stripping.

## WebP

- `webp/static-transparent.webp` — fixed lossless WebP produced from the repository-owned extension icon with libwebp `cwebp`, including real transparency.
- `webp/hidden-rgb.webp` — fixed lossless WebP derived from the public-domain `blackbug.png` fixture used by Sharp, with deliberately nonzero RGB values under fully transparent pixels. Used to prove Sharp optimization can replace the file while keeping hidden transparent RGB intact.
- `webp/animated.webp` — fixed two-frame animated WebP derived from the GIF fixture. Used for rejection coverage.

## GIF

- `gif/animated.gif` — fixed two-frame GIF with distinct frame delays and looping behavior.

## AVIF

- `avif/static-8.avif` — fixed 8-bit static AVIF derived from the repository-owned extension icon.
- `avif/static-10.avif` / `avif/static-12.avif` — fixed high-bit AVIF fixtures already used by the regression suite, now stored as files instead of relying only on runtime generation.
- `avif/sequence.avif` — fixed AVIF image-sequence container that Sharp does not support as a normal static AVIF.
- `avif/multi-image.avif` — fixed non-sequence AVIF containing multiple images/pages.

## APNG

- `apng/animated.apng` — fixed two-frame APNG with different frame delays and alpha behavior.

## Fixture rules

- Do not regenerate these files during normal tests.
- When a real customer/user/developer image exposes a bug, prefer adding a minimal fixed copy here when licensing/privacy permit it.
- Record why the fixture exists and its provenance in this file.
- Keep third-party downloaded images out of the corpus unless their redistribution terms are explicitly understood.
- Product-level fixture tests should copy the fixture to a temporary directory before exercising in-place compression or resize.
