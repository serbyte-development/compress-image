import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = "1.96";
const SOURCE_URL = `https://www.lcdf.org/gifsicle/gifsicle-${VERSION}.tar.gz`;
const SOURCE_SHA256 =
  "fd23d279681a6dfe3c15264e33f344045b3ba473da4d19f49e67a50994b077fb";

const repoRoot = path.resolve(import.meta.dirname, "..");
const destination = path.join(
  repoRoot,
  "third_party",
  "gifsicle",
  `gifsicle-${VERSION}.tar.gz`,
);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

try {
  const existing = await readFile(destination);
  if (sha256(existing) === SOURCE_SHA256) process.exit(0);
} catch {
  // Download below.
}

const response = await fetch(SOURCE_URL, { redirect: "follow" });
if (!response.ok) {
  throw new Error(
    `Failed to download Gifsicle ${VERSION} source: HTTP ${response.status}`,
  );
}

const source = Buffer.from(await response.arrayBuffer());
const actualSha256 = sha256(source);
if (actualSha256 !== SOURCE_SHA256) {
  throw new Error(
    `Gifsicle source checksum mismatch: expected ${SOURCE_SHA256}, got ${actualSha256}`,
  );
}

await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, source);
