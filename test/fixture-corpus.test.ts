import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  compressImage,
  getBundledToolPaths,
  resizeImage,
  snapshotImage,
  snapshotsMatch,
} from "../src/compression.js";

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, "test", "fixtures");
const tools = getBundledToolPaths(repoRoot);

async function withFixtureCopy(
  relativePath: string,
  run: (file: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "compress-image-fixture-"));
  const source = path.join(fixtureRoot, relativePath);
  const file = path.join(dir, path.basename(relativePath));
  try {
    await copyFile(source, file);
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("real macOS screenshot sheds redundant opaque alpha and compresses dramatically", async () => {
  await withFixtureCopy(
    "png/macos-screenshot-opaque-alpha.png",
    async (file) => {
      const beforeBytes = (await stat(file)).size;
      const beforeMetadata = await sharp(file).metadata();
      const before = await snapshotImage(file, "png");

      assert.equal(beforeMetadata.width, 512);
      assert.equal(beforeMetadata.height, 302);
      assert.equal(beforeMetadata.hasAlpha, true);

      const result = await compressImage(file, tools);
      const afterBytes = (await stat(file)).size;
      const afterMetadata = await sharp(file).metadata();
      const after = await snapshotImage(file, "png");

      assert.equal(result.status, "compressed");
      assert.ok(afterBytes < beforeBytes * 0.1);
      assert.equal(afterMetadata.hasAlpha, false);
      assert.ok(snapshotsMatch(before, after));
    },
  );
});

test("real transparent extension icon keeps decoded transparency semantics", async () => {
  await withFixtureCopy("png/extension-icon-transparent.png", async (file) => {
    const beforeBytes = (await stat(file)).size;
    const before = await snapshotImage(file, "png");
    const alphaStats = await sharp(file).extractChannel(3).stats();
    assert.ok(alphaStats.channels[0]!.min < 255);

    const result = await compressImage(file, tools);
    const after = await snapshotImage(file, "png");

    assert.ok(result.status === "compressed" || result.status === "unchanged");
    assert.ok((await stat(file)).size <= beforeBytes);
    assert.ok(snapshotsMatch(before, after));
  });
});

test("already optimized real PNG remains byte-for-byte untouched", async () => {
  await withFixtureCopy("png/already-optimized.png", async (file) => {
    const before = await readFile(file);
    const result = await compressImage(file, tools);

    assert.equal(result.status, "unchanged");
    assert.deepEqual(await readFile(file), before);
  });
});

test("fixed oriented JPEG resizes displayed width and strips EXIF", async () => {
  await withFixtureCopy("jpeg/oriented-exif.jpg", async (file) => {
    const beforeMetadata = await sharp(file).metadata();
    assert.equal(beforeMetadata.orientation, 6);
    assert.ok(beforeMetadata.exif);

    const result = await resizeImage(file, 256, tools);
    const afterMetadata = await sharp(file).metadata();

    assert.equal(result.status, "resized");
    assert.equal(result.originalWidth, 450);
    assert.equal(result.originalHeight, 800);
    assert.equal(result.resizedWidth, 256);
    assert.equal(result.resizedHeight, 455);
    assert.equal(afterMetadata.width, 256);
    assert.equal(afterMetadata.height, 455);
    assert.equal(afterMetadata.orientation, undefined);
    assert.equal(afterMetadata.exif, undefined);
  });
});

test("fixed transparent WebP survives compression and resize pipeline", async () => {
  await withFixtureCopy("webp/static-transparent.webp", async (file) => {
    const before = await snapshotImage(file, "webp");
    const beforeBytes = (await stat(file)).size;
    const compressed = await compressImage(file, tools);
    const afterCompress = await snapshotImage(file, "webp");

    assert.ok(
      compressed.status === "compressed" || compressed.status === "unchanged",
    );
    assert.ok((await stat(file)).size <= beforeBytes);
    assert.ok(snapshotsMatch(before, afterCompress));

    const resized = await resizeImage(file, 256, tools);
    const metadata = await sharp(file).metadata();
    assert.equal(resized.status, "resized");
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.equal(metadata.format, "webp");
  });
});

test("fixed animated GIF preserves animation through compress and resize", async () => {
  await withFixtureCopy("gif/animated.gif", async (file) => {
    const before = await snapshotImage(file, "gif");
    const compressed = await compressImage(file, tools);
    const afterCompress = await snapshotImage(file, "gif");

    assert.ok(
      compressed.status === "compressed" || compressed.status === "unchanged",
    );
    assert.ok(snapshotsMatch(before, afterCompress));

    const resized = await resizeImage(file, 24, tools);
    const afterResize = await snapshotImage(file, "gif");
    assert.equal(resized.status, "resized");
    assert.equal(afterResize.pages, 2);
    assert.deepEqual(afterResize.delay, before.delay);
    assert.equal(afterResize.loop, before.loop);
  });
});

for (const bitdepth of [8, 10, 12] as const) {
  test(`fixed ${bitdepth}-bit AVIF runs through best-effort compress/resize`, async () => {
    await withFixtureCopy(`avif/static-${bitdepth}.avif`, async (file) => {
      const beforeBytes = (await stat(file)).size;
      const compressed = await compressImage(file, tools);
      const afterCompressMetadata = await sharp(file).metadata();

      assert.ok(
        compressed.status === "compressed" || compressed.status === "unchanged",
      );
      assert.ok((await stat(file)).size <= beforeBytes);
      assert.equal(afterCompressMetadata.bitsPerSample, bitdepth);

      const targetWidth = bitdepth === 8 ? 64 : 2;
      const resized = await resizeImage(file, targetWidth, tools);
      const afterResizeMetadata = await sharp(file).metadata();
      assert.equal(resized.status, "resized");
      assert.equal(afterResizeMetadata.width, targetWidth);
      assert.equal(afterResizeMetadata.bitsPerSample, bitdepth);
    });
  });
}

test("fixed APNG compresses but resize rejects without modifying fixture copy", async () => {
  await withFixtureCopy("apng/animated.apng", async (file) => {
    const compressed = await compressImage(file, tools);
    assert.ok(
      compressed.status === "compressed" || compressed.status === "unchanged",
    );
    const beforeResize = await readFile(file);
    await assert.rejects(() => resizeImage(file, 8, tools), /APNG resize/);
    assert.deepEqual(await readFile(file), beforeResize);
  });
});

test("fixed animated WebP rejects both operations without modification", async () => {
  await withFixtureCopy("webp/animated.webp", async (file) => {
    const before = await readFile(file);
    await assert.rejects(() => compressImage(file, tools), /Animated WebP/);
    await assert.rejects(() => resizeImage(file, 24, tools), /Animated WebP/);
    assert.deepEqual(await readFile(file), before);
  });
});

for (const fixture of ["sequence.avif", "multi-image.avif"] as const) {
  test(`fixed unsupported AVIF ${fixture} rejects without modification`, async () => {
    await withFixtureCopy(`avif/${fixture}`, async (file) => {
      const before = await readFile(file);
      await assert.rejects(() => compressImage(file, tools));
      await assert.rejects(() => resizeImage(file, 2, tools));
      assert.deepEqual(await readFile(file), before);
    });
  });
}
