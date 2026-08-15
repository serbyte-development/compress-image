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
import os from "node:os";
import path from "node:path";

const VERSION = "1.6.0";
const RELEASE_BASE =
  "https://storage.googleapis.com/downloads.webmproject.org/releases/webp";
const LICENSE_URL = `https://raw.githubusercontent.com/webmproject/libwebp/v${VERSION}/COPYING`;
const LICENSE_SHA256 =
  "5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf";

const assets = {
  "darwin-arm64": [
    `libwebp-${VERSION}-mac-arm64.tar.gz`,
    "bc6bf84cc70f3f8574fba797d1e4a7dea4feebe9fa4be919f202413ea2b3b8f2",
  ],
  "darwin-x64": [
    `libwebp-${VERSION}-mac-x86-64.tar.gz`,
    "f112dd83b420ab2a4b27d46610d9827ddf4200216023281de378647ecca31c2a",
  ],
  "linux-arm64": [
    `libwebp-${VERSION}-linux-aarch64.tar.gz`,
    "69f5eebe203e0f3942fe37986209a1725741be19c152950a4283b376c95ec798",
  ],
  "linux-x64": [
    `libwebp-${VERSION}-linux-x86-64.tar.gz`,
    "1c5ffab71efecefa0e3c23516c3a3a1dccb45cc310ae1095c6f14ae268e38067",
  ],
  "win32-x64": [
    `libwebp-${VERSION}-windows-x64.zip`,
    "48886f506b21f62e4661f0f4cbfca19800897c385128e8902542d29a950c93f1",
  ],
};

const key = `${process.platform}-${process.arch}`;
const asset = assets[key];
if (!asset) {
  throw new Error(`libwebp ${VERSION} is not bundled for ${key}`);
}

const [assetName, expectedSha256] = asset;
const repoRoot = path.resolve(import.meta.dirname, "..");
const vendorDir = path.join(repoRoot, "vendor", "libwebp");
const binaryName = process.platform === "win32" ? "cwebp.exe" : "cwebp";
const binaryPath = path.join(vendorDir, binaryName);

function versionOutput(binary) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return `${result.stdout}${result.stderr}`;
}

try {
  await access(binaryPath);
  await access(path.join(vendorDir, "COPYING"));
  if (versionOutput(binaryPath).includes(VERSION)) {
    process.exit(0);
  }
} catch {
  // Fetch below.
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

const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "compress-image-libwebp-"),
);

try {
  const archivePath = path.join(tempDir, assetName);
  const response = await fetch(`${RELEASE_BASE}/${assetName}`, {
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download libwebp ${VERSION}: HTTP ${response.status}`,
    );
  }

  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`libwebp checksum mismatch for ${assetName}`);
  }
  await writeFile(archivePath, archive);

  const extractDir = path.join(tempDir, "extract");
  await mkdir(extractDir);
  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], {
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    throw new Error(
      `Failed to extract libwebp: ${extracted.stderr || extracted.stdout}`,
    );
  }

  const extractedBinary = await findFile(extractDir, new Set([binaryName]));
  if (!extractedBinary) {
    throw new Error(`Could not find ${binaryName} in ${assetName}`);
  }

  await mkdir(vendorDir, { recursive: true });
  await copyFile(extractedBinary, binaryPath);
  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }

  const copying = await findFile(extractDir, new Set(["COPYING"]));
  if (copying) {
    await copyFile(copying, path.join(vendorDir, "COPYING"));
  }

  const installedVersion = versionOutput(binaryPath);
  if (!installedVersion.includes(VERSION)) {
    throw new Error(
      `Installed cwebp failed version check: ${installedVersion.trim()}`,
    );
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const licenseResponse = await fetch(LICENSE_URL, { redirect: "follow" });
if (!licenseResponse.ok) {
  throw new Error(
    `Failed to download libwebp license: HTTP ${licenseResponse.status}`,
  );
}
const license = Buffer.from(await licenseResponse.arrayBuffer());
const licenseSha256 = createHash("sha256").update(license).digest("hex");
if (licenseSha256 !== LICENSE_SHA256) {
  throw new Error(
    `libwebp license checksum mismatch: expected ${LICENSE_SHA256}, got ${licenseSha256}`,
  );
}
await writeFile(path.join(vendorDir, "COPYING"), license);
