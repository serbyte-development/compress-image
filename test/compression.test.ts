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
  resizeImage,
  snapshotImage,
  snapshotsMatch,
  UnsupportedImageError,
} from "../src/compression.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const tools = getBundledToolPaths(repoRoot);
const TWO_FRAME_AVIF_BASE64 =
  "AAAALGZ0eXBhdmlzAAAAAGF2aXNhdmlmbXNmMWlzbzhtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAA/YAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAALJbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAaHRraGQBAAADAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAf/////////8AAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAQAAAAEAAAPoAAAAAAABAAAAAAHBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAAL2hkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAABQaWN0dXJlSGFuZGxlcgAAAAFqbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABKnN0YmwAAACcc3RzZAAAAAAAAAABAAAAjGF2MDEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAAAAEWTGF2YzYzLjEuMTAxIGxpYnN2dGF2MQAAAAAAAAAAAAAY//8AAAAMYXYxQ4EADAAAAAAKZmllbAEAAAAAEHBhc3AAAAABAAAAAQAAABBjY3N0AAAAAHwAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAA5zZHRwAAAAACAYAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAAAJAAAABIAAAAUc3RjbwAAAAAAAAABAAAD9gAAAD5tZGF0CgoCAAAFTP/Gr5AEMhYQAJaAEECCAAAQAFwTLQCEb5vESdKoMhAwAgAAAAA7GAAAAgAAAHsY";
// Generated once from 16-bit source pixels and embedded so tests do not
// depend on local heif-enc/ffmpeg availability.
const HIGH_BIT_AVIF_BASE64 = {
  10: "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABDgABAAAAAAAAAIMAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAamlwcnAAAABLaXBjbwAAAAxhdjFDgSBCAAAAABNjb2xybmNseAABAA0AAIAAAAAUaXNwZQAAAAAAAAAEAAAAAgAAABBwaXhpAAAAAAMKCgoAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAAIttZGF0EgAKBzgEOxgIaAEydhAAAIyBp////v8J4iXir/vQr29I4OqYkl3xp1CuaQGx1CFQKGx8sE////8rvrS2ctvXiOFyAN+L7HGjpoFRfloPoJuFsx8RkYW1POPX//////kyjfiGfyjy1Hy1HV3/+fpNGf0fVeTfLUdeVPSAaNpo3nSAb2A=",
  12: "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAOptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABDgABAAAAAAAAAJ0AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAamlwcnAAAABLaXBjbwAAAAxhdjFDgUBiAAAAABNjb2xybmNseAABAA0AAIAAAAAUaXNwZQAAAAAAAAAEAAAAAgAAABBwaXhpAAAAAAMMDAwAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAAKVtZGF0EgAKCFgEOxoCGgBAMo4BEAAAjIGn///+/k/fP9odTu1hv3dTOE6YIvSSImVDUjD793UjDGElC5/C59mElDYxz////yu+tLZy26mTz2SLPGUqll+XOjFW+kt289wZbSG741Zu3Zu1u+NW+CD1//////5MHWfKrxa+lUd71R3vO1falqonSx0xULTvE1VHe87xPMVDDAbUwG2MVDDCGA==",
} as const;
const MULTI_IMAGE_AVIF_BASE64 =
  "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAARhtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAADRpbG9jAAAAAERAAAIAAQAAAAABPAABAAAAAAAAAIMAAgAAAAABvwABAAAAAAAAACEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABhdjAxAAAAABVpbmZlAgAAAAACAABhdjAxAAAAAA5waXRtAAAAAAABAAAAcWlwcnAAAABLaXBjbwAAAAxhdjFDgSBCAAAAABNjb2xybmNseAABAA0AAIAAAAAUaXNwZQAAAAAAAAAEAAAAAgAAABBwaXhpAAAAAAMKCgoAAAAeaXBtYQAAAAAAAAACAAEEgQIDBAACBIECAwQAAACsbWRhdBIACgc4BDsYCGgBMnYQAACMgaf///7/CeIl4q/70K9vSODqmJJd8adQrmkBsdQhUChsfLBP////K760tnLb14jhcgDfi+xxo6aBUX5aD6CbhbMfEZGFtTzj1//////5Mo34hn8o8tR8tR1d//n6TRn9H1Xk3y1HXlT0gG9gEgAKBzgEOxgIaAEyFBAAAAAP+j4OkqzHqNbBiEp7LwL3";

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

async function makeSingleFrameAnimatedWebp(
  output: string,
  dir: string,
): Promise<void> {
  const gif = path.join(dir, "animated-source.gif");
  const twoFrameWebp = path.join(dir, "animated-two-frame.webp");
  await makeAnimatedGif(gif, dir);
  await sharp(gif, { animated: true })
    .webp({ lossless: true })
    .toFile(twoFrameWebp);

  const source = await readFile(twoFrameWebp);
  assert.equal(source.toString("ascii", 0, 4), "RIFF");
  assert.equal(source.toString("ascii", 8, 12), "WEBP");

  const keptChunks: Buffer[] = [];
  let offset = 12;
  let keptFrame = false;
  while (offset + 8 <= source.length) {
    const type = source.toString("ascii", offset, offset + 4);
    const size = source.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + size + (size % 2);
    assert.ok(chunkEnd <= source.length);

    if (type !== "ANMF" || !keptFrame) {
      keptChunks.push(source.subarray(offset, chunkEnd));
      if (type === "ANMF") keptFrame = true;
    }
    offset = chunkEnd;
  }
  assert.equal(keptFrame, true);

  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...keptChunks]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  await writeFile(output, Buffer.concat([riff, body]));
}

async function makeAnimatedAvif(output: string): Promise<void> {
  await writeFile(output, Buffer.from(TWO_FRAME_AVIF_BASE64, "base64"));
}

async function makeHighBitAvif(
  output: string,
  bitdepth: 10 | 12,
): Promise<void> {
  await writeFile(
    output,
    Buffer.from(HIGH_BIT_AVIF_BASE64[bitdepth], "base64"),
  );
}

async function makeMultiImageAvif(output: string): Promise<void> {
  await writeFile(output, Buffer.from(MULTI_IMAGE_AVIF_BASE64, "base64"));
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

async function makeSingleFrameApng(output: string): Promise<void> {
  const width = 16;
  const height = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(1, 0);
  actl.writeUInt32BE(0, 4);

  const frameControl = Buffer.alloc(26);
  frameControl.writeUInt32BE(0, 0);
  frameControl.writeUInt32BE(width, 4);
  frameControl.writeUInt32BE(height, 8);
  frameControl.writeUInt32BE(0, 12);
  frameControl.writeUInt32BE(0, 16);
  frameControl.writeUInt16BE(1, 20);
  frameControl.writeUInt16BE(10, 22);
  frameControl[24] = 0;
  frameControl[25] = 0;

  await writeFile(
    output,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("acTL", actl),
      pngChunk("fcTL", frameControl),
      pngChunk("IDAT", apngFrame(width, height, [255, 0, 0, 255])),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
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
  assert.equal(getImageFormat("photo.AVIF"), "avif");
  assert.equal(getImageFormat("photo.heic"), undefined);
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

test("allows PNG optimization to remove an unused fully opaque alpha channel", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "opaque-rgba.png");
    const pixels = Buffer.alloc(128 * 128 * 4);
    for (let pixel = 0; pixel < 128 * 128; pixel += 1) {
      pixels[pixel * 4] = pixel & 0xff;
      pixels[pixel * 4 + 1] = (pixel >> 2) & 0xff;
      pixels[pixel * 4 + 2] = 180;
      pixels[pixel * 4 + 3] = 255;
    }

    await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
      .png({ compressionLevel: 0 })
      .toFile(file);

    const beforeMetadata = await sharp(file).metadata();
    const before = await snapshotImage(file, "png");
    const beforeBytes = (await stat(file)).size;
    assert.equal(beforeMetadata.hasAlpha, true);

    const result = await compressImage(file, tools);
    const afterMetadata = await sharp(file).metadata();
    const after = await snapshotImage(file, "png");

    assert.equal(result.status, "compressed");
    assert.ok((await stat(file)).size < beforeBytes);
    assert.equal(afterMetadata.hasAlpha, false);
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

test("re-encodes static AVIF only when smaller and visually snapshot-valid", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.avif");
    const pixels = Buffer.alloc(128 * 128 * 4);
    for (let pixel = 0; pixel < 128 * 128; pixel += 1) {
      pixels[pixel * 4] = (pixel * 37) & 0xff;
      pixels[pixel * 4 + 1] = (pixel * 53) & 0xff;
      pixels[pixel * 4 + 2] = (pixel * 97) & 0xff;
      pixels[pixel * 4 + 3] = 255;
    }
    await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
      .withExif({ IFD0: { Artist: "AVIF compression regression" } })
      .withIccProfile("srgb")
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">compress-image-avif-compress</x:xmpmeta>',
      )
      .avif({ lossless: true, effort: 0 })
      .toFile(file);

    const before = await snapshotImage(file, "avif");
    const beforeBytes = (await stat(file)).size;
    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "avif");

    assert.equal(result.status, "compressed");
    assert.ok((await stat(file)).size < beforeBytes);
    assert.ok(snapshotsMatch(before, after));
  });
});

for (const bitdepth of [10, 12] as const) {
  test(`supports ${bitdepth}-bit AVIF compression with visible-image validation`, async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, `depth-${bitdepth}.avif`);
      await makeHighBitAvif(file, bitdepth);
      const before = await snapshotImage(file, "avif");
      const beforeBytes = (await stat(file)).size;

      const result = await compressImage(file, tools);
      const after = await snapshotImage(file, "avif");
      const metadata = await sharp(file).metadata();

      assert.ok(
        result.status === "compressed" || result.status === "unchanged",
      );
      assert.ok((await stat(file)).size <= beforeBytes);
      assert.ok(snapshotsMatch(before, after));
      assert.equal(metadata.bitsPerSample, bitdepth);
    });
  });

  test(`resizes ${bitdepth}-bit AVIF without rejecting high bit depth`, async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, `depth-${bitdepth}.avif`);
      await makeHighBitAvif(file, bitdepth);

      const result = await resizeImage(file, 2, tools);
      const metadata = await sharp(file).metadata();

      assert.equal(result.status, "resized");
      assert.equal(result.resizedWidth, 2);
      assert.equal(result.resizedHeight, 1);
      assert.equal(metadata.mediaType, "image/avif");
      assert.equal(metadata.bitsPerSample, bitdepth);
    });
  });
}

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

test("resizes PNG by width only, preserves aspect ratio, and leaves optimized output", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "portrait.png");
    await sharp({
      create: {
        width: 300,
        height: 900,
        channels: 4,
        background: { r: 20, g: 100, b: 220, alpha: 0.7 },
      },
    })
      .png({ compressionLevel: 0 })
      .toFile(file);

    const result = await resizeImage(file, 256, tools);
    const metadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 768);
    assert.equal((await compressImage(file, tools)).status, "unchanged");
  });
});

test("resize never upscales and leaves original bytes untouched", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "small.png");
    await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toFile(file);
    const before = await readFile(file);

    const result = await resizeImage(file, 256, tools);

    assert.equal(result.status, "unchanged");
    assert.equal(result.reason, "at-or-below-target");
    assert.deepEqual(await readFile(file), before);
  });
});

test("resize targets displayed JPEG width and normalizes EXIF orientation into pixels", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "oriented.jpg");
    await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 180, g: 90, b: 30 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 90 })
      .toFile(file);

    const result = await resizeImage(file, 100, tools);
    const metadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(result.originalWidth, 200);
    assert.equal(result.originalHeight, 300);
    assert.equal(result.resizedWidth, 100);
    assert.equal(result.resizedHeight, 150);
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 150);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
  });
});

test("resize intentionally strips EXIF metadata", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "metadata.jpg");
    await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 100, g: 120, b: 140 },
      },
    })
      .withExif({
        IFD0: {
          Artist: "Austin EXIF regression",
          Copyright: "Serbyte EXIF regression",
        },
        IFD2: {
          UserComment: "preserve-this-exif-value",
          DateTimeOriginal: "2026:08:15 14:00:00",
        },
      })
      .jpeg({ quality: 90 })
      .toFile(file);

    const result = await resizeImage(file, 150, tools);
    const afterMetadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(afterMetadata.width, 150);
    assert.equal(afterMetadata.height, 100);
    assert.equal(afterMetadata.exif, undefined);
  });
});

test("resizes static WebP and keeps source format", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.webp");
    await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 4,
        background: { r: 40, g: 150, b: 80, alpha: 0.5 },
      },
    })
      .webp({ lossless: true, effort: 0 })
      .toFile(file);

    const result = await resizeImage(file, 80, tools);
    const metadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 45);
  });
});

test("resizes static AVIF, strips EXIF/IPTC, preserves ICC/XMP, and keeps source format", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.avif");
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">compress-image-avif</x:xmpmeta>';
    await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 4,
        background: { r: 40, g: 150, b: 80, alpha: 0.5 },
      },
    })
      .withExif({ IFD0: { Artist: "AVIF resize regression" } })
      .withIccProfile("srgb")
      .withXmp(xmp)
      .avif({ lossless: true, effort: 0 })
      .toFile(file);

    const beforeMetadata = await sharp(file).metadata();
    assert.ok(beforeMetadata.exif);
    assert.ok(beforeMetadata.icc);
    assert.ok(beforeMetadata.xmp);

    const result = await resizeImage(file, 80, tools);
    const afterMetadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(result.resizedWidth, 80);
    assert.equal(result.resizedHeight, 45);
    assert.equal(afterMetadata.format, "heif");
    assert.equal(afterMetadata.mediaType, "image/avif");
    assert.equal(afterMetadata.compression, "av1");
    assert.equal(afterMetadata.width, 80);
    assert.equal(afterMetadata.height, 45);
    assert.equal(afterMetadata.exif, undefined);
    assert.equal(afterMetadata.iptc, undefined);
    assert.deepEqual(afterMetadata.icc, beforeMetadata.icc);
    assert.deepEqual(afterMetadata.xmp, beforeMetadata.xmp);
    assert.equal((await compressImage(file, tools)).status, "unchanged");
  });
});

test("rejects APNG resize without flattening or modifying the animation", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "animation.apng");
    await makeAnimatedPng(file);
    const before = await readFile(file);

    await assert.rejects(
      () => resizeImage(file, 8, tools),
      /APNG resize is not supported yet/,
    );
    assert.deepEqual(await readFile(file), before);
  });
});

test("rejects single-frame APNG before no-upscale handling", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "single-frame.apng");
    await makeSingleFrameApng(file);
    const before = await readFile(file);
    const snapshot = await snapshotImage(file, "png");

    assert.equal(snapshot.isApng, true);
    assert.equal(snapshot.pages, 1);
    await assert.rejects(
      () => resizeImage(file, 32, tools),
      /APNG resize is not supported yet/,
    );
    assert.deepEqual(await readFile(file), before);
  });
});

test("resizes animated GIF without flattening frames or changing timing and loop", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "animation.gif");
    await makeAnimatedGif(file, dir);

    const result = await resizeImage(file, 24, tools);
    const after = await snapshotImage(file, "gif");

    assert.equal(result.status, "resized");
    assert.equal(result.resizedWidth, 24);
    assert.equal(result.resizedHeight, 24);
    assert.equal(after.pages, 2);
    assert.deepEqual(after.delay, [100, 200]);
    assert.equal(after.loop, 0);
  });
});

test("resize optimizer failure leaves the original file untouched", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "image.png");
    await sharp({
      create: {
        width: 512,
        height: 256,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png({ compressionLevel: 0 })
      .toFile(file);

    const before = await readFile(file);
    const brokenTools = { ...tools, oxipng: path.join(dir, "missing-oxipng") };

    await assert.rejects(() => resizeImage(file, 256, brokenTools));
    assert.deepEqual(await readFile(file), before);
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

test("rejects animated WebP resize without modifying it", async () => {
  await withTempDir(async (dir) => {
    const gif = path.join(dir, "source.gif");
    const webp = path.join(dir, "animation.webp");
    await makeAnimatedGif(gif, dir);
    await sharp(gif, { animated: true }).webp({ lossless: true }).toFile(webp);
    const before = await readFile(webp);

    await assert.rejects(
      () => resizeImage(webp, 24, tools),
      UnsupportedImageError,
    );
    assert.deepEqual(await readFile(webp), before);
  });
});

test("rejects single-frame animated WebP containers", async () => {
  await withTempDir(async (dir) => {
    const webp = path.join(dir, "single-frame-animation.webp");
    await makeSingleFrameAnimatedWebp(webp, dir);
    const before = await readFile(webp);
    const metadata = await sharp(webp, { animated: true }).metadata();

    assert.equal(metadata.pages, 1);
    await assert.rejects(
      () => resizeImage(webp, 24, tools),
      UnsupportedImageError,
    );
    assert.deepEqual(await readFile(webp), before);
  });
});

test("rejects multi-frame AVIF sequences without modifying them", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "animation.avif");
    await makeAnimatedAvif(file);
    const before = await readFile(file);

    await assert.rejects(
      () => compressImage(file, tools),
      /AVIF image sequences or unsupported AVIF containers are not supported/,
    );
    await assert.rejects(
      () => resizeImage(file, 8, tools),
      /AVIF image sequences or unsupported AVIF containers are not supported/,
    );
    assert.deepEqual(await readFile(file), before);
  });
});

test("rejects non-sequence multi-image AVIF without modifying it", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "multi-image.avif");
    await makeMultiImageAvif(file);
    const before = await readFile(file);
    const metadata = await sharp(file).metadata();

    assert.equal(metadata.pages, 2);
    await assert.rejects(
      () => compressImage(file, tools),
      /Multi-image AVIF is not supported/,
    );
    await assert.rejects(
      () => resizeImage(file, 2, tools),
      /Multi-image AVIF is not supported/,
    );
    assert.deepEqual(await readFile(file), before);
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
