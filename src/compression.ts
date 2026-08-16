import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import UPNG from "@upng/upng-js";

// This extension intentionally replaces image files in place. Disable libvips'
// operation cache so later reads of the same path cannot observe stale pixels
// or dimensions from before an atomic replacement.
sharp.cache(false);

const execFileAsync = promisify(execFile);
const PNG_ZOPFLI_MAX_BYTES = 384 * 1024;

export const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".apng",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
]);

export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "avif";

export interface ToolPaths {
  oxipng: string;
  jpegtran: string;
  cwebp: string;
  gifsicle: string;
}

export type CompressionResult =
  | {
      status: "compressed";
      format: ImageFormat;
      originalBytes: number;
      optimizedBytes: number;
    }
  | {
      status: "unchanged";
      format: ImageFormat;
      originalBytes: number;
    };

export type ResizeResult =
  | {
      status: "resized";
      format: ImageFormat;
      originalBytes: number;
      resizedBytes: number;
      originalWidth: number;
      originalHeight: number;
      resizedWidth: number;
      resizedHeight: number;
    }
  | {
      status: "unchanged";
      format: ImageFormat;
      originalBytes: number;
      originalWidth: number;
      originalHeight: number;
      targetWidth: number;
      reason: "at-or-below-target";
    };

interface ImageSnapshot {
  format: string;
  width: number;
  height: number;
  isApng: boolean;
  pages: number;
  pageHeight: number | null;
  loop: number | null;
  delay: readonly number[];
  orientation: number | null;
  density: number | null;
  hasAlpha: boolean;
  pixelHash: string;
  metadataHashes: Record<string, string | null>;
}

export class UnsupportedImageError extends Error {}
export class UnsafeOptimizationError extends Error {}

function orientationSwapsDimensions(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8;
}

function displayDimensions(snapshot: ImageSnapshot): {
  width: number;
  height: number;
} {
  const frameHeight =
    snapshot.pages > 1 && snapshot.pageHeight
      ? snapshot.pageHeight
      : snapshot.height;

  return orientationSwapsDimensions(snapshot.orientation)
    ? { width: frameHeight, height: snapshot.width }
    : { width: snapshot.width, height: frameHeight };
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function metadataBufferHash(value: Buffer | undefined): string | null {
  return value ? sha256(value) : null;
}

function avifBitdepth(metadata: Metadata): 8 | 10 | 12 {
  return metadata.bitsPerSample === 10 || metadata.bitsPerSample === 12
    ? metadata.bitsPerSample
    : 8;
}

function webpHasAnimationContainer(source: Buffer): boolean {
  if (
    source.length < 12 ||
    source.toString("ascii", 0, 4) !== "RIFF" ||
    source.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= source.length) {
    const type = source.toString("ascii", offset, offset + 4);
    const size = source.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > source.length) {
      throw new UnsafeOptimizationError("Malformed WebP container");
    }

    if (type === "ANIM" || type === "ANMF") return true;
    if (
      type === "VP8X" &&
      size >= 1 &&
      (source.readUInt8(dataStart) & 0x02) !== 0
    ) {
      return true;
    }

    offset = dataEnd + (size % 2);
  }

  return false;
}

function formatForExtension(extension: string): ImageFormat | undefined {
  switch (extension.toLowerCase()) {
    case ".png":
    case ".apng":
      return "png";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".webp":
      return "webp";
    case ".gif":
      return "gif";
    case ".avif":
      return "avif";
    default:
      return undefined;
  }
}

export function getImageFormat(filePath: string): ImageFormat | undefined {
  return formatForExtension(path.extname(filePath));
}

function metadataIdentity(
  metadata: Metadata,
): Omit<ImageSnapshot, "pixelHash"> {
  return {
    format: metadata.format ?? "unknown",
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    isApng: false,
    pages: metadata.pages ?? 1,
    pageHeight: metadata.pageHeight ?? null,
    loop: metadata.loop ?? null,
    delay: metadata.delay ?? [],
    orientation: metadata.orientation ?? null,
    density: metadata.density ?? null,
    hasAlpha: metadata.hasAlpha ?? false,
    metadataHashes: {
      icc: metadataBufferHash(metadata.icc),
      exif: metadataBufferHash(metadata.exif),
      iptc: metadataBufferHash(metadata.iptc),
      xmp: metadataBufferHash(metadata.xmp),
    },
  };
}

async function snapshotPngPixels(filePath: string): Promise<{
  pixelHash: string;
  isApng: boolean;
  pages: number;
  pageHeight: number;
  loop: number | null;
  delay: readonly number[];
  controlsHash: string | null;
}> {
  const source = await readFile(filePath);
  const arrayBuffer = source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  );
  const decoded = UPNG.decode(arrayBuffer);
  const frames = UPNG.toRGBA8(decoded);
  const pixels = Buffer.concat(frames.map((frame) => Buffer.from(frame)));
  const frameControls = decoded.frames.map((frame) => ({
    rect: frame.rect,
    delay: frame.delay,
    dispose: frame.dispose,
    blend: frame.blend,
  }));

  return {
    pixelHash: sha256(
      Buffer.concat([
        Buffer.from(`${decoded.width}x${decoded.height}x${frames.length}:`),
        pixels,
      ]),
    ),
    isApng: decoded.tabs.acTL !== undefined,
    pages: frames.length,
    pageHeight: decoded.height,
    loop: decoded.tabs.acTL?.num_plays ?? null,
    delay:
      decoded.frames.length > 0
        ? decoded.frames.map((frame) => frame.delay)
        : [],
    controlsHash:
      decoded.frames.length > 0 ? sha256(JSON.stringify(frameControls)) : null,
  };
}

async function renderHash(
  filePath: string,
  format: ImageFormat,
): Promise<string> {
  const { data, info } = await sharp(filePath, {
    animated: format === "gif" || format === "png",
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sha256(
    Buffer.concat([
      Buffer.from(`${info.width}x${info.height}x${info.channels}:`),
      data,
    ]),
  );
}

export async function snapshotImage(
  filePath: string,
  expectedFormat?: ImageFormat,
): Promise<ImageSnapshot> {
  const format = expectedFormat ?? getImageFormat(filePath);
  if (!format) {
    throw new UnsupportedImageError(
      `Unsupported image format: ${path.extname(filePath) || "unknown"}`,
    );
  }

  if (
    format === "webp" &&
    webpHasAnimationContainer(await readFile(filePath))
  ) {
    throw new UnsupportedImageError("Animated WebP is not supported yet");
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(filePath, {
      animated: format === "gif" || format === "png",
    }).metadata();
  } catch (error) {
    if (format === "avif") {
      throw new UnsupportedImageError(
        "AVIF image sequences or unsupported AVIF containers are not supported",
      );
    }
    throw error;
  }

  const formatMatches =
    format === "avif"
      ? metadata.format === "heif" &&
        metadata.mediaType === "image/avif" &&
        metadata.compression === "av1"
      : metadata.format === format;
  if (!formatMatches) {
    throw new UnsupportedImageError(
      `File extension does not match image data (${path.extname(filePath)} contains ${metadata.format ?? "unknown"})`,
    );
  }

  if (format === "webp" && (metadata.pages ?? 1) > 1) {
    throw new UnsupportedImageError("Animated WebP is not supported yet");
  }
  if (format === "avif" && (metadata.pages ?? 1) > 1) {
    throw new UnsupportedImageError("Multi-image AVIF is not supported");
  }
  const identity = metadataIdentity(metadata);
  if (!identity.width || !identity.height) {
    throw new UnsafeOptimizationError("Could not determine image dimensions");
  }

  const pngSnapshot =
    format === "png" ? await snapshotPngPixels(filePath) : undefined;
  const pixelHash =
    pngSnapshot?.pixelHash ?? (await renderHash(filePath, format));

  return {
    ...identity,
    isApng: pngSnapshot?.isApng ?? false,
    pages: pngSnapshot?.pages ?? identity.pages,
    pageHeight: pngSnapshot?.pageHeight ?? identity.pageHeight,
    loop: pngSnapshot?.loop ?? identity.loop,
    delay: pngSnapshot?.delay ?? identity.delay,
    metadataHashes: {
      ...identity.metadataHashes,
      apngControls: pngSnapshot?.controlsHash ?? null,
    },
    pixelHash,
  };
}

export function snapshotsMatch(
  before: ImageSnapshot,
  after: ImageSnapshot,
): boolean {
  // Decoded RGBA comparison already protects real transparency. Do not reject
  // a smaller candidate just because an optimizer removes an unused, fully
  // opaque alpha channel from the container.
  const { hasAlpha: _beforeHasAlpha, ...beforeComparable } = before;
  const { hasAlpha: _afterHasAlpha, ...afterComparable } = after;
  return JSON.stringify(beforeComparable) === JSON.stringify(afterComparable);
}

async function runTool(
  executable: string,
  args: readonly string[],
): Promise<void> {
  await access(executable);
  try {
    await execFileAsync(executable, [...args], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path.basename(executable)} failed: ${message}`);
  }
}

async function candidateExists(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).size > 0;
  } catch {
    return false;
  }
}

async function optimizePng(
  input: string,
  tempDir: string,
  oxipng: string,
): Promise<string[]> {
  const source = await readFile(input);
  const isInterlaced =
    source.length > 28 &&
    source
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    source.subarray(12, 16).toString("ascii") === "IHDR" &&
    source[28] === 1;
  const candidates: Array<{ output: string; args: string[] }> = [
    {
      output: path.join(tempDir, "png-max-keep.png"),
      args: ["-o", "max", "-i", "keep", "--out"],
    },
  ];

  if (isInterlaced) {
    candidates.push({
      output: path.join(tempDir, "png-max-deinterlace.png"),
      args: ["-o", "max", "-i", "off", "--out"],
    });
  }

  if (source.length <= PNG_ZOPFLI_MAX_BYTES) {
    candidates.push(
      isInterlaced
        ? {
            output: path.join(tempDir, "png-zopfli-deinterlace.png"),
            args: [
              "-o",
              "max",
              "--fast",
              "-z",
              "--zi",
              "8",
              "-i",
              "off",
              "--out",
            ],
          }
        : {
            output: path.join(tempDir, "png-zopfli-keep.png"),
            args: [
              "-o",
              "max",
              "--fast",
              "-z",
              "--zi",
              "8",
              "-i",
              "keep",
              "--out",
            ],
          },
    );
  }

  const outputs: string[] = [];
  for (const candidate of candidates) {
    await runTool(oxipng, [...candidate.args, candidate.output, input]);
    if (await candidateExists(candidate.output)) outputs.push(candidate.output);
  }
  return outputs;
}

async function optimizeJpeg(
  input: string,
  tempDir: string,
  jpegtran: string,
): Promise<string[]> {
  const candidates = [
    {
      output: path.join(tempDir, "jpeg-mozjpeg-progressive.jpg"),
      args: ["-copy", "all", "-optimize", "-progressive"],
    },
    {
      output: path.join(tempDir, "jpeg-mozjpeg-baseline.jpg"),
      args: ["-revert", "-copy", "all", "-optimize"],
    },
  ];

  const outputs: string[] = [];
  for (const candidate of candidates) {
    await runTool(jpegtran, [
      ...candidate.args,
      "-outfile",
      candidate.output,
      input,
    ]);
    if (await candidateExists(candidate.output)) outputs.push(candidate.output);
  }
  return outputs;
}

async function optimizeWebp(
  input: string,
  tempDir: string,
  cwebp: string,
): Promise<string[]> {
  const output = path.join(tempDir, "webp-lossless.webp");
  await runTool(cwebp, [
    "-quiet",
    "-z",
    "9",
    "-exact",
    "-metadata",
    "all",
    "-mt",
    input,
    "-o",
    output,
  ]);
  return [output];
}

async function optimizeGif(
  input: string,
  tempDir: string,
  gifsicle: string,
): Promise<string[]> {
  const output = path.join(tempDir, "gif-o3.gif");
  await runTool(gifsicle, ["-O3", "--no-warnings", input, "-o", output]);
  return [output];
}

async function optimizeAvif(input: string, tempDir: string): Promise<string[]> {
  const output = path.join(tempDir, "avif-lossless.avif");
  const metadata = await sharp(input).metadata();
  let pipeline = sharp(input);

  if (metadata.icc) pipeline = pipeline.keepIccProfile();
  if (metadata.exif) pipeline = pipeline.keepExif();
  if (metadata.xmp) pipeline = pipeline.keepXmp();

  await pipeline
    .avif({ lossless: true, effort: 9, bitdepth: avifBitdepth(metadata) })
    .toFile(output);
  return [output];
}

async function buildCandidates(
  input: string,
  format: ImageFormat,
  tempDir: string,
  tools: ToolPaths,
): Promise<string[]> {
  switch (format) {
    case "png":
      return optimizePng(input, tempDir, tools.oxipng);
    case "jpeg":
      return optimizeJpeg(input, tempDir, tools.jpegtran);
    case "webp":
      return optimizeWebp(input, tempDir, tools.cwebp);
    case "gif":
      return optimizeGif(input, tempDir, tools.gifsicle);
    case "avif":
      return optimizeAvif(input, tempDir);
  }
}

function metadataHashFailuresForResize(
  before: ImageSnapshot,
  after: ImageSnapshot,
): string[] {
  const failures: string[] = [];
  for (const key of ["icc", "xmp"] as const) {
    if (before.metadataHashes[key] !== after.metadataHashes[key]) {
      failures.push(`${key} metadata`);
    }
  }
  return failures;
}

function resizeValidationFailures(
  before: ImageSnapshot,
  after: ImageSnapshot,
  targetWidth: number,
): string[] {
  const beforeDimensions = displayDimensions(before);
  const afterDimensions = displayDimensions(after);
  const expectedHeight = Math.max(
    1,
    Math.round(
      (beforeDimensions.height * targetWidth) / beforeDimensions.width,
    ),
  );
  const failures: string[] = [];

  if (before.format !== after.format) failures.push("format");
  if (afterDimensions.width !== targetWidth) failures.push("width");
  if (afterDimensions.height !== expectedHeight) failures.push("aspect ratio");
  if (before.pages !== after.pages) failures.push("frame count");
  if (before.loop !== after.loop) failures.push("loop");
  if (JSON.stringify(before.delay) !== JSON.stringify(after.delay)) {
    failures.push("frame timing");
  }
  if (before.hasAlpha !== after.hasAlpha) failures.push("alpha");
  failures.push(...metadataHashFailuresForResize(before, after));
  return failures;
}

async function createResizedImage(
  input: string,
  output: string,
  format: ImageFormat,
  originalSnapshot: ImageSnapshot,
  targetWidth: number,
): Promise<void> {
  const resizeOptions = {
    width: targetWidth,
    kernel: "lanczos3" as const,
    withoutEnlargement: true,
    fastShrinkOnLoad: false,
  };

  let pipeline = sharp(input, {
    animated: format === "gif" || format === "png",
  });

  // Resize only cares about the visible image. Bake EXIF orientation into the
  // pixels for static formats, then omit EXIF from the resized output.
  if (format !== "gif") {
    pipeline = pipeline.autoOrient();
  }

  pipeline = pipeline.resize(resizeOptions);

  if (originalSnapshot.metadataHashes.icc !== null) {
    pipeline = pipeline.keepIccProfile();
  }
  if (originalSnapshot.metadataHashes.xmp !== null) {
    pipeline = pipeline.keepXmp();
  }

  switch (format) {
    case "png":
      pipeline = pipeline.png({ compressionLevel: 0, palette: false });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({
        quality: 95,
        chromaSubsampling: "4:4:4",
        progressive: false,
        optimiseCoding: false,
      });
      break;
    case "webp":
      pipeline = pipeline.webp({
        lossless: true,
        effort: 6,
        exact: true,
      });
      break;
    case "gif":
      pipeline = pipeline.gif({
        effort: 10,
        colours: 256,
        dither: 1,
        interFrameMaxError: 0,
        keepDuplicateFrames: true,
        loop: originalSnapshot.loop ?? undefined,
        delay:
          originalSnapshot.delay.length > 0
            ? [...originalSnapshot.delay]
            : undefined,
      });
      break;
    case "avif":
      const metadata = await sharp(input).metadata();
      pipeline = pipeline.avif({
        lossless: true,
        effort: 4,
        bitdepth: avifBitdepth(metadata),
      });
      break;
  }

  await pipeline.toFile(output);
}

async function chooseSmallestValidCandidate(
  candidates: readonly string[],
  format: ImageFormat,
  originalSnapshot: ImageSnapshot,
  originalBytes: number,
): Promise<{ path: string; bytes: number } | undefined> {
  let best: { path: string; bytes: number } | undefined;

  for (const candidate of candidates) {
    const candidateStat = await stat(candidate);
    if (candidateStat.size >= originalBytes) continue;

    const candidateSnapshot = await snapshotImage(candidate, format);
    if (!snapshotsMatch(originalSnapshot, candidateSnapshot)) continue;

    if (!best || candidateStat.size < best.bytes) {
      best = { path: candidate, bytes: candidateStat.size };
    }
  }

  return best;
}

async function replaceSafely(
  input: string,
  optimized: string,
  tempDir: string,
): Promise<void> {
  const inputStat = await stat(input);
  const backup = path.join(tempDir, `original-${randomUUID()}.bak`);
  await copyFile(input, backup);

  try {
    try {
      await rename(optimized, input);
    } catch {
      const displaced = path.join(tempDir, `displaced-${randomUUID()}.bak`);
      await rename(input, displaced);
      try {
        await rename(optimized, input);
      } catch (error) {
        await rename(displaced, input);
        throw error;
      }
      await rm(displaced, { force: true });
    }

    if (process.platform !== "win32") {
      await chmod(input, inputStat.mode);
    }
  } catch (error) {
    await copyFile(backup, input);
    throw error;
  }
}

export async function compressImage(
  input: string,
  tools: ToolPaths,
): Promise<CompressionResult> {
  const format = getImageFormat(input);
  if (!format) {
    throw new UnsupportedImageError(
      `Unsupported image format: ${path.extname(input) || "unknown"}`,
    );
  }

  const originalStat = await stat(input);
  if (!originalStat.isFile()) {
    throw new UnsupportedImageError("Selected resource is not a file");
  }

  const originalSnapshot = await snapshotImage(input, format);
  const tempDir = await mkdtemp(
    path.join(path.dirname(input), ".compress-image-"),
  );

  try {
    const candidates = await buildCandidates(input, format, tempDir, tools);
    const best = await chooseSmallestValidCandidate(
      candidates,
      format,
      originalSnapshot,
      originalStat.size,
    );

    if (!best) {
      return {
        status: "unchanged",
        format,
        originalBytes: originalStat.size,
      };
    }

    await replaceSafely(input, best.path, tempDir);
    return {
      status: "compressed",
      format,
      originalBytes: originalStat.size,
      optimizedBytes: best.bytes,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function resizeImage(
  input: string,
  targetWidth: number,
  tools: ToolPaths,
): Promise<ResizeResult> {
  if (!Number.isInteger(targetWidth) || targetWidth <= 0) {
    throw new Error("Resize width must be a positive integer");
  }

  const format = getImageFormat(input);
  if (!format) {
    throw new UnsupportedImageError(
      `Unsupported image format: ${path.extname(input) || "unknown"}`,
    );
  }

  const originalStat = await stat(input);
  if (!originalStat.isFile()) {
    throw new UnsupportedImageError("Selected resource is not a file");
  }

  const originalSnapshot = await snapshotImage(input, format);

  if (format === "png" && originalSnapshot.isApng) {
    throw new UnsupportedImageError(
      "APNG resize is not supported yet; Compress remains available",
    );
  }

  const originalDimensions = displayDimensions(originalSnapshot);
  if (originalDimensions.width <= targetWidth) {
    return {
      status: "unchanged",
      format,
      originalBytes: originalStat.size,
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      targetWidth,
      reason: "at-or-below-target",
    };
  }

  const tempDir = await mkdtemp(
    path.join(path.dirname(input), ".compress-image-"),
  );

  try {
    const extension = path.extname(input).toLowerCase();
    const resized = path.join(tempDir, `resized${extension}`);
    await createResizedImage(
      input,
      resized,
      format,
      originalSnapshot,
      targetWidth,
    );

    const resizedSnapshot = await snapshotImage(resized, format);
    const validationFailures = resizeValidationFailures(
      originalSnapshot,
      resizedSnapshot,
      targetWidth,
    );
    if (validationFailures.length > 0) {
      throw new UnsafeOptimizationError(
        `Resized output failed validation: ${validationFailures.join(", ")}`,
      );
    }

    const resizedStat = await stat(resized);
    const candidates = await buildCandidates(resized, format, tempDir, tools);
    const optimized = await chooseSmallestValidCandidate(
      candidates,
      format,
      resizedSnapshot,
      resizedStat.size,
    );
    const finalPath = optimized?.path ?? resized;
    const finalBytes = optimized?.bytes ?? resizedStat.size;

    await replaceSafely(input, finalPath, tempDir);
    const resizedDimensions = displayDimensions(resizedSnapshot);
    return {
      status: "resized",
      format,
      originalBytes: originalStat.size,
      resizedBytes: finalBytes,
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      resizedWidth: resizedDimensions.width,
      resizedHeight: resizedDimensions.height,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function getBundledToolPaths(extensionRoot: string): ToolPaths {
  const executableSuffix = process.platform === "win32" ? ".exe" : "";

  return {
    oxipng: path.join(
      extensionRoot,
      "vendor",
      "oxipng",
      `oxipng${executableSuffix}`,
    ),
    jpegtran: path.join(
      extensionRoot,
      "vendor",
      "mozjpeg",
      `jpegtran${executableSuffix}`,
    ),
    cwebp: path.join(
      extensionRoot,
      "vendor",
      "libwebp",
      `cwebp${executableSuffix}`,
    ),
    gifsicle: path.join(
      extensionRoot,
      "vendor",
      "gifsicle",
      `gifsicle${executableSuffix}`,
    ),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}
