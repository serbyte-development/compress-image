# Compress Image — Build Plan

Build a small VS Code extension that lets a developer right-click an image in the Explorer and compress it in place with no configuration or format conversion.

This is a living build plan, not a rigid implementation spec. Use the best solution discovered while building, keep the product simple, and update the plan when real implementation or testing reveals a better direction.

## Product rules

- Keep the original file format and image dimensions.
- Keep v1 limited to formats where losslessness can be validated strongly enough for predictable in-place replacement.
- Require identical decoded pixels/frames plus the format-specific animation controls and exposed metadata fields the validator explicitly compares.
- Never replace the original unless the resulting file is smaller and valid.
- Keep the user experience to one primary action: **Compress Image**.
- Support as many common image formats as can be handled strongly and reliably without bloating the extension.

## Build checklist

- [x] Establish the minimal VS Code extension structure and a fast local development/test loop.
- [x] Implement the Explorer right-click **Compress Image** workflow for supported image files.
- [x] Build the compression layer around the strongest practical optimizer(s) for each supported format, allowing the exact tool choices and strategy to evolve from testing.
- [x] Make compression safe: validate decoded output and explicitly checked format fields, avoid destructive writes, and keep the original whenever optimization does not produce a real win.
- [x] Give concise success, no-op, unsupported-format, and failure feedback inside VS Code.
- [x] Test representative real-world images across the supported formats, including already-optimized files and edge cases such as transparency, metadata/orientation, and animation where applicable.
- [x] Add automated coverage for the important product guarantees and compression behavior.
- [ ] Verify the extension works cleanly across every practical VS Code platform we intend to support and that any bundled/native tooling is handled reliably. macOS arm64, macOS x64, and Linux arm64 are verified locally; Linux x64 and Windows x64 are wired into CI and must pass there before publishing.
- [x] Keep the codebase and dependency surface as small and understandable as possible while preserving compression quality.
- [x] Prepare the project for a separate publishing-readiness pass, but do not publish anything without Austin's manual review and approval.

## Current implementation notes

- Supported in v1: PNG/APNG, JPEG, static WebP, and GIF. Animated WebP is rejected safely rather than modified.
- PNG/APNG uses OxiPNG 10.2.0. Normal files race `-o max` against benchmark-selected Zopfli (`-o max --fast -z --zi 8`) while small enough to keep latency practical. Interlaced inputs also race a deinterlaced `-o max` candidate, with Zopfli applied to the deinterlaced path; only candidates identical under decoded-pixel/frame-control and checked-field validation can win. Local representative benchmarks showed `-o max` costs about the same as `-o 6`, deinterlacing materially reduced the interlaced sample, and higher Zopfli iteration counts had diminishing returns.
- JPEG uses MozJPEG 4.1.5 `jpegtran`, built as a static coefficient-level transcoder from checksum-pinned upstream source during setup. Standard baseline Huffman optimization races MozJPEG progressive/jpegrescan optimization without decoding/re-encoding image samples. The build disables SIMD to avoid a NASM/Yasm packaging dependency; this changes speed, not JPEG coefficients or compression decisions.
- Static WebP uses Google's official statically linked libwebp 1.6.0 `cwebp` binaries with maximum lossless preset, `-exact`, metadata copying, and multithreading. This preserves RGB values under fully transparent pixels; automated coverage verifies that edge case. Official binaries cover macOS ARM/x64, Linux ARM64/x64, and Windows x64.
- GIF uses Gifsicle. Sharp remains the decoder/validator and runtime image metadata layer, not the WebP encoder.
- Output is decoded and compared against the original before replacement. APNG validation checks every frame plus timing/loop/frame controls; GIF validation checks decoded frames/timing/loop; orientation, density, alpha presence, and ICC/EXIF/IPTC/XMP blobs are compared when exposed by Sharp. This does not claim preservation of every possible ancillary container chunk.
- Native tool acquisition is checksum-pinned. OxiPNG and official libwebp binaries are fetched per platform; MozJPEG is compiled with a dev-only cross-platform CMake runtime so local/CI packaging does not depend on a system CMake install. Native VSIX packaging is platform-tagged. macOS arm64 packaging/install/runtime behavior is verified locally. macOS x64 and Linux arm64 also pass clean platform-native dependency installation, the full compression test suite, bundle activation checking, runtime audit, packaging, and VSIX content auditing; their four bundled native executables were confirmed to match the target architecture. CI is configured for macOS arm64/x64, Linux arm64/x64, and Windows x64. Linux x64 and Windows x64 still need green CI runs before cross-platform verification is complete. Windows ARM64 is intentionally unsupported because the selected OxiPNG/libwebp release path does not provide the required official native binaries there.
- Release-readiness metadata and polish are complete locally: MIT license, README, changelog, support policy, third-party notices/source availability, icon, real VS Code result screenshot, marketplace metadata/keywords, workspace/virtual-workspace capability declarations, platform-specific packaging, bundle activation check, runtime dependency audit, and actual VSIX contents audit.
- The darwin-arm64 VSIX has been installed into an isolated VS Code 1.133.0 profile and exercised through the Explorer context menu. An intentionally inefficient 3.09 MB PNG compressed to 5.77 KB, with output validation passing before replacement. The VSIX also installs successfully into an isolated Cursor 3.16.17 profile; Cursor's fresh-profile login/onboarding gate prevented a clean no-account Explorer interaction smoke test.
- Publishing remains a hard manual gate. No Visual Studio Marketplace/Open VSX publish, public GitHub repo creation/push, release tag, or other public release action may occur until Austin reviews and explicitly approves it.
