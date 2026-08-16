# Compress Image

[![CI](https://img.shields.io/github/actions/workflow/status/Serbyte-Development/compress-image/ci.yml?label=CI)](https://github.com/Serbyte-Development/compress-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<!--
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/serbytedevelopment.compress-image)](https://marketplace.visualstudio.com/items?itemName=serbytedevelopment.compress-image)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/serbytedevelopment.compress-image)](https://marketplace.visualstudio.com/items?itemName=serbytedevelopment.compress-image)
[![Open VSX Version](https://img.shields.io/open-vsx/v/serbytedevelopment/compress-image)](https://open-vsx.org/extension/serbytedevelopment/compress-image)
-->

Compress and resize images directly from the VS Code Explorer.

![Compress Image Explorer menu](images/compress-image-menu-item.png)

## How it works

Right-click an image in the VS Code Explorer and open **Compress Image**. From there you can compress the image or resize it to 256px, 512px, or 1080px wide.

Resize keeps the original aspect ratio, never crops or stretches the image, and never makes a small image larger. After resizing, the image is compressed automatically.

Compression only replaces the original when the result is smaller and passes validation. If it cannot make the image smaller safely, the original is left alone.

Everything runs locally. Your images never leave your machine.

![Compress Image result notification](images/compress-image-snackbar-item.png)

## Supported formats

| Format | Compress | Resize |
| --- | --- | --- |
| PNG | Yes | Yes |
| APNG | Yes | No |
| JPEG / JPG | Yes | Yes |
| WebP | Static images | Static images |
| GIF | Yes | Yes, including animation |
| AVIF | Static images | Static images |

Animated WebP, APNG resizing, AVIF image sequences, and multi-image AVIF files are not supported. HEIC, TIFF, BMP, SVG, and other formats are also currently unsupported.

## Platforms

Compress Image supports macOS on Apple Silicon and Intel, Linux on arm64 and x64 using glibc, and Windows on x64. VS Code 1.96.0 or newer is required.

Remote SSH, WSL, and dev containers work when the matching platform version of the extension is installed in the remote environment.

## Support

Found a bug or an image that does not behave as expected? Open an issue in the GitHub repository. See [SUPPORT.md](SUPPORT.md) for details that can help reproduce image problems.

## License

Compress Image is MIT licensed. Bundled image tools and libraries retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Developed and maintained by [Serbyte Development](https://www.serbyte.net/).**
