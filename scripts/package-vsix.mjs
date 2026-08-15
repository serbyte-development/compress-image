import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const targetByPlatform = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux-x64",
  "win32-x64": "win32-x64",
};

const key = `${process.platform}-${process.arch}`;
const target = targetByPlatform[key];
if (!target) {
  throw new Error(`VSIX packaging is not configured for ${key}`);
}

const vsce = path.resolve("node_modules", "@vscode", "vsce", "vsce");
const result = spawnSync(
  process.execPath,
  [vsce, "package", "--target", target],
  {
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const packageJson = JSON.parse(
  readFileSync(path.resolve("package.json"), "utf8"),
);
const vsixPath = path.resolve(
  `${packageJson.name}-${target}-${packageJson.version}.vsix`,
);
const audit = spawnSync(
  process.execPath,
  [path.resolve("scripts", "audit-vsix.mjs"), vsixPath, target],
  { stdio: "inherit" },
);

if (audit.status !== 0) {
  process.exit(audit.status ?? 1);
}
