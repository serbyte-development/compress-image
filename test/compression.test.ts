import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import test from "node:test";
import sharp from "sharp";
import {
  compressImage,
  getBundledToolPaths,
  getImageFormat,
  snapshotImage,
  snapshotsMatch,
  UnsupportedImageError,
} from "../src/compression.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const tools = getBundledToolPaths(repoRoot);

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "compress-image-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeAnimatedGif(output: string, dir: string): Promise<void> {
  const frame1 = path.join(dir, "frame1.gif");
  const frame2 = path.join(dir, "frame2.gif");

  await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .gif()
    .toFile(frame1);
  await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 0.5 },
    },
  })
    .gif()
    .toFile(frame2);

  const { stdout } = await execFileAsync(
    tools.gifsicle,
    ["--delay", "10", "--loopcount=0", frame1, "--delay", "20", frame2],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  await writeFile(output, stdout);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function apngFrame(
  width: number,
  height: number,
  rgba: readonly number[],
): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      row.set(rgba, 1 + x * 4);
    }
    rows.push(row);
  }
  return deflateSync(Buffer.concat(rows), { level: 0 });
}

async function makeAnimatedPng(output: string): Promise<void> {
  const width = 16;
  const height = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  actl.writeUInt32BE(0, 4);

  const frameControl = (sequence: number, delayNumerator: number): Buffer => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(width, 4);
    data.writeUInt32BE(height, 8);
    data.writeUInt32BE(0, 12);
    data.writeUInt32BE(0, 16);
    data.writeUInt16BE(delayNumerator, 20);
    data.writeUInt16BE(10, 22);
    data[24] = 0;
    data[25] = 0;
    return data;
  };

  const secondFrameData = Buffer.alloc(4);
  secondFrameData.writeUInt32BE(2, 0);

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", actl),
    pngChunk("fcTL", frameControl(0, 1)),
    pngChunk("IDAT", apngFrame(width, height, [255, 0, 0, 255])),
    pngChunk("fcTL", frameControl(1, 2)),
    pngChunk(
      "fdAT",
      Buffer.concat([
        secondFrameData,
        apngFrame(width, height, [0, 0, 255, 128]),
      ]),
    ),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  await writeFile(output, png);
}

async function pngInterlaceMethod(file: string): Promise<number> {
  const source = await readFile(file);
  assert.ok(source.length > 28);
  assert.deepEqual(
    source.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.equal(source.subarray(12, 16).toString("ascii"), "IHDR");
  return source.readUInt8(28);
}

test("bundles expected native optimizer versions", async () => {
  const oxipng = await execFileAsync(tools.oxipng, ["--version"]);
  const jpegtran = await execFileAsync(tools.jpegtran, ["-version"]);
  const cwebp = await execFileAsync(tools.cwebp, ["-version"]);
  const gifsicle = await execFileAsync(tools.gifsicle, ["--version"]);

  assert.match(`${oxipng.stdout}${oxipng.stderr}`, /oxipng 10\.2\.0/);
  assert.match(
    `${jpegtran.stdout}${jpegtran.stderr}`,
    /mozjpeg version 4\.1\.5/,
  );
  assert.match(`${cwebp.stdout}${cwebp.stderr}`, /^1\.6\.0/m);
  assert.match(`${gifsicle.stdout}${gifsicle.stderr}`, /Gifsicle 1\.96/);
});

test("recognizes supported extensions case-insensitively", () => {
  assert.equal(getImageFormat("photo.PNG"), "png");
  assert.equal(getImageFormat("photo.apng"), "png");
  assert.equal(getImageFormat("photo.JPEG"), "jpeg");
  assert.equal(getImageFormat("photo.webp"), "webp");
  assert.equal(getImageFormat("photo.gif"), "gif");
  assert.equal(getImageFormat("photo.avif"), undefined);
});

test("compresses an inefficient PNG and preserves decoded pixels and checked fields", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.png");
    await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: { r: 10, g: 80, b: 220, alpha: 0.6 },
      },
    })
      .png({ compressionLevel: 0 })
      .toFile(file);

    const before = await snapshotImage(file, "png");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "png");

    assert.equal(result.status, "compressed");
    assert.ok((await stat(file)).size < beforeBytes);
    assert.ok(snapshotsMatch(before, after));
  });
});

test("deinterlaces PNG when validation proves decoded pixels are unchanged", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "interlaced.png");
    const pixels = Buffer.alloc(64 * 64 * 4);
    for (let pixel = 0; pixel < 64 * 64; pixel += 1) {
      pixels[pixel * 4] = pixel & 0xff;
      pixels[pixel * 4 + 1] = (pixel >> 2) & 0xff;
      pixels[pixel * 4 + 2] = 200;
      pixels[pixel * 4 + 3] = pixel % 2 === 0 ? 128 : 255;
    }

    await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
      .png({ compressionLevel: 0, progressive: true })
      .toFile(file);

    assert.equal(await pngInterlaceMethod(file), 1);
    const before = await snapshotImage(file, "png");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "png");

    assert.equal(result.status, "compressed");
    assert.ok((await stat(file)).size < beforeBytes);
    assert.equal(await pngInterlaceMethod(file), 0);
    assert.ok(snapshotsMatch(before, after));
  });
});

test("compresses JPEG while preserving decoded pixels and checked metadata/orientation", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "photo.jpg");
    await sharp({
      create: {
        width: 96,
        height: 64,
        channels: 3,
        background: { r: 200, g: 120, b: 30 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92, optimizeCoding: false })
      .toFile(file);

    const before = await snapshotImage(file, "jpeg");
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "jpeg");

    assert.ok(result.status === "compressed" || result.status === "unchanged");
    assert.ok(snapshotsMatch(before, after));
    assert.equal(after.orientation, 6);
  });
});

test("optimizes APNG without changing frames, timing, transparency, or loop", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "animation.apng");
    await makeAnimatedPng(file);

    const before = await snapshotImage(file, "png");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "png");

    assert.ok(result.status === "compressed" || result.status === "unchanged");
    assert.ok((await stat(file)).size <= beforeBytes);
    assert.ok(snapshotsMatch(before, after));
    assert.equal(after.pages, 2);
    assert.deepEqual(after.delay, [100, 200]);
    assert.equal(after.loop, 0);
  });
});

test("re-encodes static WebP only when smaller and validation-identical", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.webp");
    await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: { r: 50, g: 180, b: 90, alpha: 0.4 },
      },
    })
      .withMetadata({ orientation: 6 })
      .webp({ lossless: true, effort: 0 })
      .toFile(file);

    const before = await snapshotImage(file, "webp");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "webp");

    assert.ok(result.status === "compressed" || result.status === "unchanged");
    assert.ok((await stat(file)).size <= beforeBytes);
    assert.ok(snapshotsMatch(before, after));
    assert.equal(after.orientation, 6);
  });
});

test("WebP optimization preserves hidden RGB in fully transparent pixels", async () => {
  await withTempDir(async (dir) => {
    const png = path.join(dir, "hidden.png");
    const file = path.join(dir, "hidden.webp");
    const pixels = Buffer.from([
      255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 10, 20, 30, 255,
    ]);

    await sharp(pixels, { raw: { width: 4, height: 1, channels: 4 } })
      .png({ compressionLevel: 0 })
      .toFile(png);
    await execFileAsync(tools.cwebp, [
      "-quiet",
      "-lossless",
      "-exact",
      "-q",
      "0",
      png,
      "-o",
      file,
    ]);

    const beforePixels = await sharp(file).ensureAlpha().raw().toBuffer();
    const before = await snapshotImage(file, "webp");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const afterPixels = await sharp(file).ensureAlpha().raw().toBuffer();
    const after = await snapshotImage(file, "webp");

    assert.equal(result.status, "compressed");
    assert.ok((await stat(file)).size < beforeBytes);
    assert.deepEqual(beforePixels, pixels);
    assert.deepEqual(afterPixels, pixels);
    assert.ok(snapshotsMatch(before, after));
  });
});

test("optimizes animated GIF without changing frames, timing, transparency, or loop", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "animation.gif");
    await makeAnimatedGif(file, dir);

    const before = await snapshotImage(file, "gif");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "gif");

    assert.ok(result.status === "compressed" || result.status === "unchanged");
    assert.ok((await stat(file)).size <= beforeBytes);
    assert.ok(snapshotsMatch(before, after));
    assert.equal(after.pages, 2);
    assert.deepEqual(after.delay, [100, 200]);
    assert.equal(after.loop, 0);
  });
});

test("second compression pass is idempotent", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.png");
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 100, g: 40, b: 10, alpha: 1 },
      },
    })
      .png({ compressionLevel: 0 })
      .toFile(file);

    await compressImage(file, tools);
    const once = await readFile(file);
    const second = await compressImage(file, tools);
    const twice = await readFile(file);

    assert.equal(second.status, "unchanged");
    assert.deepEqual(twice, once);
  });
});

test("rejects animated WebP without modifying it", async () => {
  await withTempDir(async (dir) => {
    const gif = path.join(dir, "source.gif");
    const webp = path.join(dir, "animation.webp");
    await makeAnimatedGif(gif, dir);
    await sharp(gif, { animated: true }).webp({ lossless: true }).toFile(webp);
    const before = await readFile(webp);

    await assert.rejects(
      () => compressImage(webp, tools),
      UnsupportedImageError,
    );
    assert.deepEqual(await readFile(webp), before);
  });
});

test("rejects extension/content mismatches without modifying the file", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "fake.png");
    await writeFile(file, "not an image");
    const before = await readFile(file);

    await assert.rejects(() => compressImage(file, tools));
    assert.deepEqual(await readFile(file), before);
  });
});

test("optimizer failure leaves the original file untouched", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.png");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png({ compressionLevel: 0 })
      .toFile(file);

    const before = await readFile(file);
    const brokenTools = { ...tools, oxipng: path.join(dir, "missing-oxipng") };

    await assert.rejects(() => compressImage(file, brokenTools));
    assert.deepEqual(await readFile(file), before);
  });
});
