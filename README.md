# Compress Image

[![CI](https://img.shields.io/github/actions/workflow/status/Serbyte-Development/compress-image/ci.yml?label=CI)](https://github.com/Serbyte-Development/compress-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<!--
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/serbytedevelopment.compress-image)](https://marketplace.visualstudio.com/items?itemName=serbytedevelopment.compress-image)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/serbytedevelopment.compress-image)](https://marketplace.visualstudio.com/items?itemName=serbytedevelopment.compress-image)
[![Open VSX Version](https://img.shields.io/open-vsx/v/serbytedevelopment/compress-image)](https://open-vsx.org/extension/serbytedevelopment/compress-image)
-->

Compress or resize supported raster image assets in place from VS Code — no uploads, no quality slider, no configuration.

![Compress Image result in VS Code](images/result.png)

- **Simple Explorer menu.** Right-click a supported image and choose **Compress Image ▸ Compress** or **Resize ▸ 256 / 512 / 1080 px**.
- **Best-effort lossless compression.** A compression candidate is accepted only when it is smaller and matches the format-specific decoded validation used by the extension. AVIF intentionally uses simple 8-bit visible-image validation, so high-bit sample precision is not guaranteed exact.
- **Compression never grows a file.** The original stays untouched unless a validated compression candidate is smaller.
- **Width-only resize.** Resize preserves aspect ratio, never crops/pads/stretches, never changes format, and never upscales.
- **Optimize after resize.** Resized output is passed through the same format-specific optimizer pipeline before replacement.
- **Local and private.** Compression and resize run on your machine; images are never uploaded.
- **Strict format scope.** PNG/APNG, JPEG, static WebP, GIF, and normal static 8/10/12-bit AVIF are supported in v0.1.0.

**Developed & maintained by [Serbyte Development](https://www.serbyte.net/)** · [GitHub](https://github.com/Serbyte-Development)

## Usage

1. Find a supported image in the VS Code Explorer.
2. Right-click it.
3. Open **Compress Image**.
4. Choose **Compress** or **Resize ▸ 256 px / 512 px / 1080 px**.

**Compress** optimizes in place only when the result is both smaller and matches the format-specific validation described below. **Resize** treats the selected number as target width, preserves aspect ratio, skips images already at or below that width, then optimizes the resized result before replacement.

Resize uses high-quality Lanczos3 resampling with Sharp's `fastShrinkOnLoad` disabled to favor quality over aggressive decoder-side shrinking. It does not crop, pad, stretch, or convert the image. JPEG resizing necessarily re-encodes image samples. Static PNG, JPEG, static WebP, GIF, and normal static 8/10/12-bit AVIF resize in place; animated GIF keeps frame count, timing, and loop behavior. APNG and animated WebP resize are rejected clearly rather than flattened or corrupted; their **Compress** action remains supported. AVIF image sequences and multi-image AVIF are rejected for both actions.

## Supported formats

| Format     | Optimizer                | Validation required before replacement                                                                         |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| PNG / APNG | OxiPNG 10.2.0            | Exact decoded RGBA pixels/frames, dimensions, APNG timing/loop/frame controls, validated metadata fields       |
| JPEG / JPG | MozJPEG 4.1.5 `jpegtran` | Exact decoded RGBA pixels, dimensions, orientation/density, validated metadata fields                          |
| WebP       | libwebp 1.6.0 `cwebp`    | Exact decoded RGBA pixels including hidden RGB under transparent pixels, dimensions, validated metadata fields |
| GIF        | Gifsicle 1.96            | Exact decoded frames, dimensions, frame timing, loop behavior, validated metadata fields                       |
| AVIF       | Sharp 0.35.3 AVIF        | 8-bit decoded visible RGBA equivalence, dimensions, orientation/density, validated metadata fields             |

"Validated metadata fields" for **Compress** means the fields explicitly compared by the extension: orientation, density, alpha presence, and ICC/EXIF/IPTC/XMP blobs when exposed by Sharp for that format. It is not a claim that every possible ancillary container chunk is preserved.

For **Resize**, dimensions necessarily change. The validator instead requires target width/aspect ratio, format, frame count/timing/loop, alpha presence, and preserved ICC/XMP data when present. Resize deliberately does **not** preserve EXIF or IPTC metadata. EXIF orientation is applied to the pixels before resizing so the visible image stays correctly oriented even after EXIF is removed.

Animated WebP, AVIF image sequences, and multi-image AVIF are intentionally rejected rather than modified. HEIC, TIFF, BMP, and other formats are not supported in v0.1.0.

## Safety model

Compress Image does not trust an optimizer result just because the command succeeded.

For every candidate it:

1. Snapshots decoded image output and the format-specific fields listed above.
2. Creates optimized candidates in a temporary directory next to the source file.
3. Rejects candidates that are not smaller.
4. Decodes and compares the candidate against the original snapshot.
5. Replaces the original only after validation passes.
6. Keeps a temporary backup during replacement and restores it if the write fails.

PNG/APNG compression validation includes frame-level controls. JPEG compression compares orientation/density and exposed ICC/EXIF/IPTC/XMP metadata. AVIF uses the same simple metadata checks plus 8-bit decoded visible-image equivalence; Sharp is asked to retain the source 8/10/12-bit AVIF depth, but exact high-bit sample precision is not part of the validation contract and may normalize during decode/re-encode. Resize has a simpler contract: EXIF/IPTC are stripped, visible orientation is baked into static-image pixels, and ICC/XMP are preserved when present. Static WebP compression uses `-exact` so RGB values under fully transparent pixels remain intact and is still rejected unless decoded pixels and validated fields match.

## Compression strategy

- **PNG/APNG:** races strong OxiPNG candidates, with bounded Zopfli work for smaller files. Interlaced PNGs may be deinterlaced only when validation proves equivalent output.
- **JPEG:** races optimized progressive and baseline coefficient-level MozJPEG `jpegtran` output. Replacement still requires identical decoded pixels and validated fields.
- **WebP:** uses official libwebp `cwebp` at maximum lossless preset with exact transparent RGB preservation.
- **GIF:** uses Gifsicle `-O3`, then validates the animation before replacement.
- **AVIF:** normal static 8/10/12-bit AVIF uses Sharp lossless encoding at effort 9. Source bit depth is requested on encode when exposed by Sharp. Sequence/multi-image containers are rejected; candidates still must be smaller and match the 8-bit visible-image snapshot plus checked fields.

## Platforms

Releases are platform-specific because Compress Image ships native optimization tools.

- macOS arm64 (Apple Silicon)
- macOS x64 (Intel)
- Linux arm64 (glibc)
- Linux x64 (glibc)
- Windows x64

Windows ARM64, Alpine Linux, browser/web extensions, and virtual workspaces are not supported in v0.1.0.

The extension runs as a VS Code **workspace extension**. In Remote SSH, WSL, or dev-container sessions, the matching platform build must be installed in the remote extension host.

## VS Code and Cursor

VS Code `1.96.0` or newer is required. Cursor uses the VS Code extension model, but registry availability and platform behavior should be treated separately; see the release notes for builds that have been smoke-tested there.

## Development

Requires Node.js 22 or newer for the current `@vscode/vsce` toolchain.

```sh
npm ci
npm run check
npm run audit:runtime
npm run package:vsix
```

`npm run package:vsix` creates a VSIX for the current operating system and CPU architecture. Native binaries and redistribution licenses are acquired or built during `npm ci` and are checksum/version validated where upstream artifacts permit it.

## Support

For bugs, compatibility problems, or focused feature requests, open an issue in the GitHub repository. See [SUPPORT.md](SUPPORT.md) for the information that helps reproduce compression problems.

## License

Compress Image is MIT licensed. Bundled optimizers and libraries keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Gifsicle source archive is included in each VSIX alongside its GPLv2-licensed executable.
