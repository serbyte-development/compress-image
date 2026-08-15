import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";

const tools = [
  {
    name: "gifsicle",
    source: path.join(
      repoRoot,
      "node_modules",
      "@343dev",
      "gifsicle",
      "vendor",
      process.platform,
      `gifsicle_${process.arch}${executableSuffix}`,
    ),
    destination: path.join(
      repoRoot,
      "vendor",
      "gifsicle",
      `gifsicle${executableSuffix}`,
    ),
  },
];

for (const tool of tools) {
  try {
    await access(tool.source);
  } catch {
    throw new Error(
      `${tool.name} build binary not available for ${process.platform}-${process.arch}`,
    );
  }

  await mkdir(path.dirname(tool.destination), { recursive: true });
  await copyFile(tool.source, tool.destination);
  if (process.platform !== "win32") {
    await chmod(tool.destination, 0o755);
  }
}

await copyFile(
  path.join(repoRoot, "node_modules", "@343dev", "gifsicle", "LICENSE"),
  path.join(repoRoot, "vendor", "gifsicle", "COPYING"),
);
