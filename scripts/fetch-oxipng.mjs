import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "10.2.0";
const RELEASE_BASE = `https://github.com/oxipng/oxipng/releases/download/v${VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/shssoichiro/oxipng/v${VERSION}/LICENSE`;
const LICENSE_SHA256 =
  "1bc9688d785fa50345f803824ddde000bdabedda9d1803dc41a1fedd81f784fc";

const assets = {
  "darwin-arm64": [
    `oxipng-${VERSION}-aarch64-apple-darwin.tar.gz`,
    "9aad3927d095b6ade2aacb92b89ebaca442483c1f7cde5d7a2486b283c2ed5f9",
  ],
  "darwin-x64": [
    `oxipng-${VERSION}-x86_64-apple-darwin.tar.gz`,
    "c45acf40a70cc02539c55555ac240bf5ef24544b7ea9959d22da19f606cec205",
  ],
  "linux-arm64": [
    `oxipng-${VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
    "97d168c6c0d1dbcb36e7438eb489804748a2ba40d94fe21aa7dab7372e9efe9b",
  ],
  "linux-x64": [
    `oxipng-${VERSION}-x86_64-unknown-linux-gnu.tar.gz`,
    "b33f84c73d42cb592bea5d84c431030b1e97784817693380dfcec7d9575f871e",
  ],
  "win32-x64": [
    `oxipng-${VERSION}-x86_64-pc-windows-msvc.zip`,
    "a5ad52c9c288dc99c2eae90dcad73dee64e39bf3f5aa5303c0fb55ac9c5f069b",
  ],
};

const key = `${process.platform}-${process.arch}`;
const asset = assets[key];
if (!asset) {
  throw new Error(`OxiPNG ${VERSION} is not bundled for ${key}`);
}

const [assetName, expectedSha256] = asset;
const repoRoot = path.resolve(import.meta.dirname, "..");
const vendorDir = path.join(repoRoot, "vendor", "oxipng");
const binaryName = process.platform === "win32" ? "oxipng.exe" : "oxipng";
const binaryPath = path.join(vendorDir, binaryName);

try {
  await access(binaryPath);
  await access(path.join(vendorDir, "LICENSE"));
  const version = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
  if (`${version.stdout}${version.stderr}`.includes(VERSION)) {
    process.exit(0);
  }
} catch {
  // Fetch below.
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "compress-image-oxipng-"));

try {
  const archivePath = path.join(tempDir, assetName);
  const response = await fetch(`${RELEASE_BASE}/${assetName}`, {
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to download OxiPNG: HTTP ${response.status}`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`OxiPNG checksum mismatch for ${assetName}`);
  }

  await writeFile(archivePath, archive);
  const extractDir = path.join(tempDir, "extract");
  await mkdir(extractDir);

  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], {
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    throw new Error(
      `Failed to extract OxiPNG: ${extracted.stderr || extracted.stdout}`,
    );
  }

  async function findBinary(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findBinary(entryPath);
        if (nested) return nested;
      } else if (entry.name === binaryName) {
        return entryPath;
      }
    }
    return undefined;
  }

  const extractedBinary = await findBinary(extractDir);
  if (!extractedBinary) {
    throw new Error(`Could not find ${binaryName} in ${assetName}`);
  }

  await mkdir(vendorDir, { recursive: true });
  await copyFile(extractedBinary, binaryPath);
  if (process.platform !== "win32") {
    await chmod(binaryPath, 0o755);
  }

  const installed = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
  if (
    installed.status !== 0 ||
    !`${installed.stdout}${installed.stderr}`.includes(VERSION)
  ) {
    throw new Error(
      `Installed OxiPNG binary failed version check: ${installed.stderr || installed.stdout}`,
    );
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const licenseResponse = await fetch(LICENSE_URL, { redirect: "follow" });
if (!licenseResponse.ok) {
  throw new Error(
    `Failed to download OxiPNG license: HTTP ${licenseResponse.status}`,
  );
}
const license = Buffer.from(await licenseResponse.arrayBuffer());
const licenseSha256 = createHash("sha256").update(license).digest("hex");
if (licenseSha256 !== LICENSE_SHA256) {
  throw new Error(
    `OxiPNG license checksum mismatch: expected ${LICENSE_SHA256}, got ${licenseSha256}`,
  );
}
await writeFile(path.join(vendorDir, "LICENSE"), license);
