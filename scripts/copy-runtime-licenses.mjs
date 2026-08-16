import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const destination = path.join(repoRoot, "vendor", "licenses");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const licenses = [
  ["sharp", "LICENSE", "sharp-LICENSE"],
  ["@upng/upng-js", "LICENSE", "upng-LICENSE"],
];

for (const [packageName, sourceName, destinationName] of licenses) {
  await copyFile(
    path.join(repoRoot, "node_modules", packageName, sourceName),
    path.join(destination, destinationName),
  );
}
