# Compress Image — Agent Guide

This file is the developer and coding-agent source of truth for the repository. Read it before making implementation changes.

## What this extension is

Compress Image is a small VS Code/Cursor extension for local image optimization from the Explorer context menu.

The user can right-click a supported image and choose:

- **Compress Image ▸ Compress**
- **Compress Image ▸ Resize ▸ 256 px / 512 px / 1080 px**

The extension modifies the selected file in place. It does not upload images, convert formats, expose quality controls, or require configuration.

Supported v1 formats are PNG/APNG, JPEG, static WebP, GIF, and normal static 8/10/12-bit AVIF. Animated WebP and AVIF sequence/multi-image containers are rejected. HEIC is intentionally unsupported.

## Product principles

### Prefer simple over theoretically perfect

Keep the implementation small, understandable, and dependable.

Do not add bespoke parsers, metadata repair systems, precision machinery, or complicated format-specific infrastructure unless the user-visible benefit clearly justifies it.

When a tiny invisible or near-invisible degradation substantially reduces implementation complexity or produces meaningfully better compression, that tradeoff is acceptable.

### Best-effort lossless

The product goal is **best-effort lossless**, not mathematical losslessness at any cost.

Prefer truly lossless optimization when it is straightforward. Existing exact paths such as PNG, JPEG coefficient optimization, WebP, and GIF should remain strict where that strictness is cheap and reliable.

Do not build large amounts of complexity solely to protect obscure representation details that do not materially affect the visible image.

AVIF is the clearest example: normal static 8/10/12-bit AVIF is supported through Sharp. The encoder is asked to preserve source bit depth when practical, but validation intentionally uses the decoded visible image rather than custom full-precision high-bit hashing. Minor invisible normalization is acceptable.

### Compression should produce a real win

The normal **Compress** action replaces the original only when the candidate is smaller and passes the format's validation contract.

Never replace a file with a larger compression result.

### Keep destructive operations safe

Optimization and resize work in temporary files first. Validate before replacement. Keep the existing backup/restore behavior around in-place replacement.

Do not trade atomic replacement safety for implementation simplicity.

## How it works

The main flow is:

```text
VS Code command
    ↓
identify format / reject unsupported input
    ↓
snapshot relevant image semantics
    ↓
format-specific optimizer
    ↓
validate candidate
    ↓
choose smaller valid result
    ↓
atomic in-place replacement
```

Resize adds one step before optimization:

```text
decode / normalize visible orientation
    ↓
resize to requested width
    ↓
validate resize semantics
    ↓
run normal format optimizer
    ↓
atomic replacement
```

Primary implementation files:

- `src/extension.ts` — VS Code commands, menu interaction, user feedback.
- `src/compression.ts` — format detection, snapshots, resize, optimizers, validation, safe replacement.
- `test/compression.test.ts` — behavioral and regression tests.
- `package.json` — commands, menus, extension metadata, supported Explorer extensions.

## Format strategy

Use the strongest practical existing tool without introducing unnecessary infrastructure.

- **PNG / APNG:** OxiPNG `-o 1`. For interlaced PNG, also try deinterlacing and let decoded pixels/frame controls decide whether it is safe. Do not reintroduce slower OxiPNG levels or Zopfli without benchmark evidence.
- **JPEG:** MozJPEG `jpegtran` progressive `-fastcrush`. Coefficient-level optimization avoids image-sample re-encoding for normal Compress while skipping expensive progressive scan optimization.
- **Static WebP:** Sharp lossless WebP effort 6 with `exact: true`.
- **GIF:** Sharp GIF effort 7 with duplicate-frame preservation and frame/timing/loop validation.
- **Static AVIF:** Sharp AVIF lossless effort 4. Use source 8/10/12-bit depth when Sharp reports it. Visible decoded equivalence is sufficient; do not reintroduce custom high-bit precision hashing.

Sharp is the common encoder for WebP/GIF/AVIF, image decoder/metadata layer, and resize implementation. OxiPNG and MozJPEG are the only separate native optimization tools retained because benchmarks showed they still justify their complexity.

## Resize contract

Resize presets are always **target width**, never longest edge.

Required behavior:

- preserve aspect ratio
- derive height automatically
- no crop
- no padding
- no stretching
- no format conversion
- no upscaling
- use high-quality Lanczos3 resampling
- run the resized result through the normal optimizer afterward

If the image is already at or below the requested width, do not enlarge it.

Animated GIF resize is supported while preserving frame count, timing, and loop behavior. APNG resize is intentionally rejected rather than risking flattening. Animated WebP is unsupported. AVIF sequence/multi-image input is unsupported.

## Metadata policy

Metadata is secondary to a simple and reliable image pipeline.

For **Resize**:

- apply EXIF orientation to the visible pixels before resizing
- strip EXIF and IPTC rather than maintaining complex metadata rewrite logic
- preserve ICC and XMP only because Sharp makes those paths trivial

Do not add custom EXIF parsing, normalization, offset repair, thumbnail handling, or metadata reconstruction.

For **Compress**, existing metadata preservation/validation may remain where it is already straightforward. Do not expand it into a general-purpose metadata system.

If metadata support becomes complicated, prefer stripping or narrowing the guarantee rather than adding bespoke complexity.

## Validation philosophy

Validation should protect the user from meaningful breakage without becoming a second image-processing implementation.

Different formats may have different validation strength:

- exact decoded pixels/frames where cheap and reliable
- animation controls where relevant
- dimensions and alpha semantics
- selected metadata only when already exposed simply by Sharp
- AVIF uses ordinary 8-bit decoded visible-image equivalence even for high-bit source files

Do not require container-level alpha-channel presence when decoded RGBA pixels are identical. Removing an unused fully opaque alpha channel is a valid optimization.

Do not assume every ancillary chunk, internal codec representation, or hidden precision detail must remain identical.

If a stronger guarantee requires significant custom machinery, first ask whether the difference is visible or materially useful. Prefer the simpler contract when it is not.

## Adding a format

Before adding a new format, answer these questions:

1. Can we decode and encode it reliably on all intended platforms?
2. Can we preserve the same file format after Compress and Resize?
3. Is there a maintained optimizer or encoder we can use without a large dependency burden?
4. Can we detect obviously unsafe cases such as animation/multi-image input with simple APIs?
5. Can we validate the visible result without implementing a custom parser?
6. Does the format justify any new native binaries, licenses, or packaging complexity?

Prefer rejecting unusual variants over creating complicated support paths.

## Development

Node.js 22+ is expected for the current tooling.

Common checks:

```sh
npm ci
npm run check
npm run audit:runtime
npm run package:vsix
```

`npm run check` covers TypeScript, tests, formatting, build, and bundle activation checks. `npm run package:vsix` packages and audits the current platform VSIX.

Do not run expensive full release gates for tiny documentation-only changes. Run the smallest validation appropriate to the change.

### Test fixtures

Use both synthetic unit fixtures and fixed real-world regression fixtures.

Synthetic images are appropriate for narrow edge conditions that are easiest to construct explicitly. Product-level behavior should also be exercised against checked-in files under `test/fixtures/`, especially files produced by real software or files that previously exposed a bug.

When a real image exposes a regression, prefer adding a fixed fixture when privacy/licensing permit it. Record its provenance and reason in `test/fixtures/README.md`. Tests must copy fixtures to a temporary directory before exercising in-place compression or resize.

Do not rely only on images generated at test runtime. Encoders often normalize away exactly the strange metadata/container details that regression fixtures are meant to preserve.

### Compression benchmark fixtures

Keep compression-performance tuning separate from regression testing. `benchmark/fixtures/` is a deliberately small corpus of realistic, redistributable images used to compare encoder runtime against output size. `test/fixtures/` remains the regression corpus for correctness and odd container/metadata behavior.

Run `npm run benchmark:compression` for the benchmark corpus. Use `--runs 3` when making performance decisions and `--corpus regression` only when a regression fixture is useful for a focused comparison. Benchmark candidates must still run through the normal compression snapshot validation; a smaller candidate that fails validation is evidence against that strategy, not a usable result.

Keep the benchmark corpus under 10 image files. Record source, license/provenance, and any deterministic derivation steps in `benchmark/fixtures/README.md`. Benchmark fixtures must remain excluded from the packaged VSIX.

## Native tools and packaging

The extension ships platform-specific native optimizers. Keep acquisition/versioning reproducible and keep required third-party notices/licenses in the VSIX.

Currently intended release platforms:

- macOS arm64
- macOS x64
- Linux arm64 glibc
- Linux x64 glibc
- Windows x64

Do not casually add a new native dependency. A small compression improvement is usually not worth substantially increasing packaging, licensing, or cross-platform complexity.

## Release boundary

Preparing, testing, and packaging a release is allowed.

Do **not** publish to Visual Studio Marketplace/Open VSX, create or push release tags, push a public repository, or otherwise make a public release without explicit user approval immediately before that action.

## Keep documentation aligned

When product behavior changes, update the relevant documentation in the same change:

- `AGENTS.md` for durable engineering/product principles
- `README.md` for user-facing behavior and guarantees
- `CHANGELOG.md` for release-visible changes
- `buildplan.md` for current implementation state and remaining release work

Prefer one clear source of truth over duplicating detailed implementation explanations across many files.
