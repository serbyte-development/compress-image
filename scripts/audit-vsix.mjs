import { readFile } from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";

const [vsixArgument, expectedTarget] = process.argv.slice(2);
if (!vsixArgument || !expectedTarget) {
  throw new Error("Usage: node scripts/audit-vsix.mjs <vsix-path> <target>");
}

const vsixPath = path.resolve(vsixArgument);
const archive = await new Promise((resolve, reject) => {
  yauzl.open(vsixPath, { lazyEntries: true }, (error, zipfile) => {
    if (error) reject(error);
    else resolve(zipfile);
  });
});

const entries = new Set();
const captured = new Map();
const captureNames = new Set([
  "extension.vsixmanifest",
  "extension/package.json",
]);

await new Promise((resolve, reject) => {
  archive.on("error", reject);
  archive.on("end", resolve);
  archive.on("entry", (entry) => {
    entries.add(entry.fileName);
    if (!captureNames.has(entry.fileName)) {
      archive.readEntry();
      return;
    }

    archive.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        captured.set(entry.fileName, Buffer.concat(chunks));
        archive.readEntry();
      });
    });
  });
  archive.readEntry();
});

const executableSuffix = expectedTarget.startsWith("win32-") ? ".exe" : "";
const required = [
  "extension/LICENSE.txt",
  "extension/SUPPORT.md",
  "extension/THIRD_PARTY_NOTICES.md",
  "extension/changelog.md",
  "extension/dist/extension.js",
  "extension/images/icon.png",
  "extension/images/result.png",
  "extension/package.json",
  "extension/readme.md",
  `extension/vendor/oxipng/oxipng${executableSuffix}`,
  "extension/vendor/oxipng/LICENSE",
  `extension/vendor/mozjpeg/jpegtran${executableSuffix}`,
  "extension/vendor/mozjpeg/LICENSE.md",
  `extension/vendor/libwebp/cwebp${executableSuffix}`,
  "extension/vendor/libwebp/COPYING",
  `extension/vendor/gifsicle/gifsicle${executableSuffix}`,
  "extension/vendor/gifsicle/COPYING",
  "extension/vendor/gifsicle/source/gifsicle-1.96.tar.gz",
  "extension/vendor/licenses/sharp-LICENSE",
  "extension/vendor/licenses/upng-LICENSE",
];

for (const requiredPath of required) {
  if (!entries.has(requiredPath)) {
    throw new Error(`VSIX is missing required file: ${requiredPath}`);
  }
}

const forbidden = [
  /^extension\/(?:\.env|\.secrets\/|\.git\/)/,
  /^extension\/(?:buildplan\.md|tsconfig\.json|package-lock\.json|\.DS_Store)$/,
  /^extension\/(?:src|test|scripts)\//,
];

for (const entry of entries) {
  if (forbidden.some((pattern) => pattern.test(entry))) {
    throw new Error(`VSIX contains forbidden release file: ${entry}`);
  }
}

const manifest = captured.get("extension.vsixmanifest")?.toString("utf8") ?? "";
if (!manifest.includes(`TargetPlatform="${expectedTarget}"`)) {
  throw new Error(`VSIX target mismatch: expected ${expectedTarget}`);
}

const manifestPackage = JSON.parse(
  captured.get("extension/package.json").toString("utf8"),
);
const sourcePackage = JSON.parse(
  await readFile(path.resolve("package.json"), "utf8"),
);
for (const key of ["name", "version", "publisher"]) {
  if (manifestPackage[key] !== sourcePackage[key]) {
    throw new Error(`VSIX package ${key} does not match source package.json`);
  }
}

const explorerMenu = manifestPackage.contributes?.menus?.["explorer/context"];
const expectedWhen =
  "isFileSystemResource && resourceScheme == file && resourceExtname =~ /\\.(png|apng|jpe?g|webp|gif|avif)$/i";
if (
  !Array.isArray(explorerMenu) ||
  explorerMenu.length !== 1 ||
  explorerMenu[0]?.submenu !== "compressImage.menu" ||
  explorerMenu[0]?.when !== expectedWhen
) {
  throw new Error("VSIX Explorer context-menu format scope is unexpected");
}

const submenus = manifestPackage.contributes?.submenus ?? [];
const submenuLabels = new Map(
  submenus.map((submenu) => [submenu.id, submenu.label]),
);
if (
  submenuLabels.get("compressImage.menu") !== "Compress Image" ||
  submenuLabels.get("compressImage.resizeMenu") !== "Resize"
) {
  throw new Error("VSIX Compress Image submenu contributions are unexpected");
}

const rootMenu = manifestPackage.contributes?.menus?.["compressImage.menu"];
if (
  !Array.isArray(rootMenu) ||
  rootMenu.length !== 2 ||
  rootMenu[0]?.command !== "compressImage.compressImage" ||
  rootMenu[1]?.submenu !== "compressImage.resizeMenu"
) {
  throw new Error("VSIX Compress Image submenu contents are unexpected");
}

const resizeMenu =
  manifestPackage.contributes?.menus?.["compressImage.resizeMenu"];
const expectedResizeCommands = [
  "compressImage.resize256",
  "compressImage.resize512",
  "compressImage.resize1080",
];
if (
  !Array.isArray(resizeMenu) ||
  resizeMenu.length !== expectedResizeCommands.length ||
  resizeMenu.some(
    (item, index) => item?.command !== expectedResizeCommands[index],
  )
) {
  throw new Error("VSIX resize submenu contents are unexpected");
}

const sharpTarget = expectedTarget.replace("win32-", "win32-");
if (
  ![...entries].some((entry) => entry.includes(`/@img/sharp-${sharpTarget}/`))
) {
  throw new Error(
    `VSIX does not contain Sharp native package for ${expectedTarget}`,
  );
}

console.log(
  `VSIX audit passed: ${path.basename(vsixPath)} (${entries.size} files, ${expectedTarget})`,
);
