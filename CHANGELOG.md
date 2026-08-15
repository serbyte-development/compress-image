# Changelog

## 0.1.0

- Initial release of Compress Image.
- One-click Explorer compression for PNG/APNG, JPEG, static WebP, and GIF.
- PNG optimization with OxiPNG, including validated deinterlacing and a bounded Zopfli path for smaller files; replacement requires identical decoded pixels/frames and checked fields.
- Coefficient-level JPEG optimization with MozJPEG `jpegtran`.
- Static WebP recompression with official libwebp `cwebp` using `-exact`; replacement requires identical decoded RGBA pixels and checked fields.
- GIF optimization with Gifsicle; replacement requires identical decoded frames, timing/loop behavior, and checked fields.
- Output validation before replacement, including decoded pixels/frames, dimensions, selected exposed metadata fields, orientation/density, animation timing, loop behavior, and APNG frame controls where applicable.
- Originals are replaced only when a validated result is smaller.
- Platform-specific packages for macOS arm64/x64, Linux arm64/x64, and Windows x64.
