# Changelog

## 0.1.0

- Initial release of Compress Image.
- Explorer submenu with best-effort lossless compression plus width-only 256 px, 512 px, and 1080 px resize actions for static PNG, JPEG, static WebP, GIF, and normal static 8/10/12-bit AVIF. APNG and animated WebP resize reject safely rather than flattening animation; AVIF sequences/multi-image AVIF reject for both actions.
- Resize preserves aspect ratio and source format, never crops/pads/stretches/upscales, uses high-quality Lanczos3 resampling, normalizes visible orientation into static-image pixels, intentionally strips EXIF/IPTC metadata, then runs the existing format-specific optimizer before atomic replacement.
- PNG optimization with OxiPNG `-o 1`, including validated deinterlacing; replacement requires identical decoded pixels/frames and checked fields.
- Coefficient-level JPEG optimization with MozJPEG `jpegtran` progressive `-fastcrush` for a much better time/size tradeoff without image-sample re-encoding.
- Static WebP recompression with Sharp lossless effort 6 and exact transparent RGB preservation; replacement requires identical decoded RGBA pixels and checked fields.
- GIF optimization with Sharp effort 7; replacement requires identical decoded frames, timing/loop behavior, and checked fields.
- Normal static 8/10/12-bit AVIF recompression with Sharp lossless mode at effort 4; source bit depth is requested when straightforward, while validation intentionally uses 8-bit decoded visible-image equivalence so exact high-bit sample precision may normalize. AVIF sequence/multi-image containers remain rejected safely.
- Output validation before replacement, including decoded pixels/frames, dimensions, selected exposed metadata fields, orientation/density, animation timing, loop behavior, and APNG frame controls where applicable.
- Originals are replaced only when a validated result is smaller.
- Platform-specific packages for macOS arm64/x64, Linux arm64/x64, and Windows x64.
