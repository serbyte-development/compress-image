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

const execFileAsync = promisify(execFile);
const PNG_ZOPFLI_MAX_BYTES = 384 * 1024;

export const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".apng",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export type ImageFormat = "png" | "jpeg" | "webp" | "gif";

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

interface ImageSnapshot {
  format: string;
  width: number;
  height: number;
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

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function metadataBufferHash(value: Buffer | undefined): string | null {
  return value ? sha256(value) : null;
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

  const metadata = await sharp(filePath, {
    animated: format === "gif" || format === "png",
  }).metadata();

  if (metadata.format !== format) {
    throw new UnsupportedImageError(
      `File extension does not match image data (${path.extname(filePath)} contains ${metadata.format ?? "unknown"})`,
    );
  }

  if (format === "webp" && (metadata.pages ?? 1) > 1) {
    throw new UnsupportedImageError("Animated WebP is not supported yet");
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
  return JSON.stringify(before) === JSON.stringify(after);
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
  }
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
