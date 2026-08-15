import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function downloadVerified(url, expectedSha256, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(data);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${path.basename(destination)}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }

  await writeFile(destination, data);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(
      `${path.basename(command)} failed${output ? `: ${output}` : ""}`,
    );
  }

  return result;
}

export async function extractArchive(archivePath, destination) {
  await mkdir(destination, { recursive: true });
  run("tar", ["-xf", archivePath, "-C", destination]);
}

export async function findNamedFile(root, names) {
  const wanted = new Set(Array.isArray(names) ? names : [names]);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await visit(entryPath);
        if (nested) return nested;
      } else if (wanted.has(entry.name)) {
        return entryPath;
      }
    }
    return undefined;
  }

  return visit(root);
}

export async function installExecutable(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  if (process.platform !== "win32") {
    await chmod(destination, 0o755);
  }
}

export async function fileContains(filePath, text) {
  try {
    return (await readFile(filePath, "utf8")).includes(text);
  } catch {
    return false;
  }
}
