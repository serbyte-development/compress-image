import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const VERSION = "4.1.5";
const SOURCE_URL = `https://github.com/mozilla/mozjpeg/archive/refs/tags/v${VERSION}.tar.gz`;
const SOURCE_SHA256 =
  "9fcbb7171f6ac383f5b391175d6fb3acde5e64c4c4727274eade84ed0998fcc1";

const repoRoot = path.resolve(import.meta.dirname, "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const vendorDir = path.join(repoRoot, "vendor", "mozjpeg");
const binaryPath = path.join(vendorDir, `jpegtran${executableSuffix}`);
const require = createRequire(import.meta.url);
const cmakeRuntime = require("cmake-runtime");

await rm(path.join(repoRoot, "vendor", "jpegtran"), {
  recursive: true,
  force: true,
});

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(executable)} failed (${result.status ?? result.signal ?? "spawn"}): ${result.error?.message || result.stderr || result.stdout || "unknown error"}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function binaryIsCurrent() {
  try {
    await access(binaryPath);
    return run(binaryPath, ["-version"], { capture: true }).includes(
      `mozjpeg version ${VERSION}`,
    );
  } catch {
    return false;
  }
}

async function findFile(dir, names) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, names);
      if (nested) return nested;
    } else if (names.has(entry.name)) {
      return entryPath;
    }
  }
  return undefined;
}

if (!(await binaryIsCurrent())) {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "compress-image-mozjpeg-"),
  );

  try {
    const archivePath = path.join(tempDir, "mozjpeg.tar.gz");
    const response = await fetch(SOURCE_URL, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Failed to download MozJPEG ${VERSION}: HTTP ${response.status}`,
      );
    }

    const archive = Buffer.from(await response.arrayBuffer());
    const actualSha256 = createHash("sha256").update(archive).digest("hex");
    if (actualSha256 !== SOURCE_SHA256) {
      throw new Error(
        `MozJPEG checksum mismatch: expected ${SOURCE_SHA256}, got ${actualSha256}`,
      );
    }
    await writeFile(archivePath, archive);

    const sourceDir = path.join(tempDir, "source");
    const buildDir = path.join(tempDir, "build");
    await mkdir(sourceDir);
    await mkdir(buildDir);
    run("tar", ["-xf", archivePath, "-C", sourceDir, "--strip-components=1"]);

    const cmake = cmakeRuntime();
    if (process.platform !== "win32") {
      await chmod(cmake, 0o755);
    }
    run(cmake, [
      "-S",
      sourceDir,
      "-B",
      buildDir,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
      "-DENABLE_SHARED:BOOL=OFF",
      "-DENABLE_STATIC:BOOL=ON",
      "-DPNG_SUPPORTED:BOOL=OFF",
      "-DWITH_SIMD:BOOL=OFF",
      "-DWITH_TURBOJPEG:BOOL=OFF",
      "-DWITH_JAVA:BOOL=OFF",
    ]);
    run(cmake, [
      "--build",
      buildDir,
      "--config",
      "Release",
      "--target",
      "jpegtran-static",
      "--parallel",
    ]);

    const builtBinary = await findFile(
      buildDir,
      new Set([`jpegtran-static${executableSuffix}`]),
    );
    if (!builtBinary) {
      throw new Error(
        `MozJPEG build did not produce jpegtran-static${executableSuffix}`,
      );
    }

    await mkdir(vendorDir, { recursive: true });
    await copyFile(builtBinary, binaryPath);
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    const licenseSource = path.join(sourceDir, "LICENSE.md");
    await copyFile(licenseSource, path.join(vendorDir, "LICENSE.md"));

    const versionOutput = run(binaryPath, ["-version"], { capture: true });
    if (!versionOutput.includes(`mozjpeg version ${VERSION}`)) {
      throw new Error(
        `Built jpegtran is not MozJPEG ${VERSION}: ${versionOutput.trim()}`,
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
