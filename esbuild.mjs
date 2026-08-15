import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  mainFields: ["module", "main"],
  sourcemap: false,
  minify: !watch,
  external: ["vscode", "sharp"],
  logLevel: "info",
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching extension sources...");
} else {
  await esbuild.build(options);
}
