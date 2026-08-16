import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import sharp, { type Metadata, type Sharp } from "sharp";
import {
  getBundledToolPaths,
  getImageFormat,
  snapshotImage,
  snapshotsMatch,
  UnsupportedImageError,
  type ImageFormat,
  type ToolPaths,
} from "../src/compression.js";

const execFileAsync = promisify(execFile);
const BENCHMARK_FIXTURE_ROOT = path.resolve("benchmark/fixtures");
const REGRESSION_FIXTURE_ROOT = path.resolve("test/fixtures");
const DEFAULT_RUNS = 1;
const PNG_ZOPFLI_MAX_BYTES = 384 * 1024;

type Corpus = "benchmark" | "regression";
type Provider = "native" | "sharp";

interface Options {
  runs: number;
  corpus: Corpus;
  format?: ImageFormat;
  fixture?: string;
}

interface Strategy {
  provider: Provider;
  name: string;
  run: (input: string, output: string, tools: ToolPaths) => Promise<void>;
}

interface Result {
  format: ImageFormat;
  fixture: string;
  provider: Provider;
  strategy: string;
  inputBytes: number;
  outputBytes?: number;
  milliseconds?: number;
  valid: boolean;
  smaller: boolean;
  error?: string;
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = { runs: DEFAULT_RUNS, corpus: "benchmark" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runs") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--runs must be a positive integer");
      }
      options.runs = value;
      index += 1;
      continue;
    }
    if (arg === "--corpus") {
      const value = argv[index + 1];
      if (value !== "benchmark" && value !== "regression") {
        throw new Error("--corpus must be benchmark or regression");
      }
      options.corpus = value;
      index += 1;
      continue;
    }
    if (arg === "--format") {
      const value = argv[index + 1] as ImageFormat | undefined;
      if (!value || !["png", "jpeg", "webp", "gif", "avif"].includes(value)) {
        throw new Error("--format must be png, jpeg, webp, gif, or avif");
      }
      options.format = value;
      index += 1;
      continue;
    }
    if (arg === "--fixture") {
      const value = argv[index + 1];
      if (!value) throw new Error("--fixture requires a path fragment");
      options.fixture = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: npm run benchmark:compression -- [options]\n\nOptions:\n  --runs N          Run each encoder strategy N times (default: 1)\n  --corpus NAME     benchmark (default) or regression\n  --format FORMAT   Benchmark only png, jpeg, webp, gif, or avif\n  --fixture TEXT    Benchmark only fixture paths containing TEXT\n  -h, --help        Show this help\n`,
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function fixtureRoot(corpus: Corpus): string {
  return corpus === "benchmark"
    ? BENCHMARK_FIXTURE_ROOT
    : REGRESSION_FIXTURE_ROOT;
}

async function listFixtures(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFixtures(fullPath);
      if (entry.isFile() && entry.name !== "README.md") return [fullPath];
      return [];
    }),
  );
  return nested.flat().sort();
}

async function runTool(
  executable: string,
  args: readonly string[],
): Promise<void> {
  await execFileAsync(executable, [...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function avifBitdepth(metadata: Metadata): 8 | 10 | 12 {
  return metadata.bitsPerSample === 10 || metadata.bitsPerSample === 12
    ? metadata.bitsPerSample
    : 8;
}

async function metadataPreservingSharp(
  input: string,
  animated = false,
): Promise<{ metadata: Metadata; pipeline: Sharp }> {
  const metadata = await sharp(input, { animated }).metadata();
  let pipeline = sharp(input, { animated });
  if (metadata.icc) pipeline = pipeline.keepIccProfile();
  if (metadata.exif) pipeline = pipeline.keepExif();
  if (metadata.xmp) pipeline = pipeline.keepXmp();
  return {
    metadata,
    pipeline,
  };
}

async function runAvif(
  input: string,
  output: string,
  effort: number,
): Promise<void> {
  const metadata = await sharp(input).metadata();
  let pipeline: Sharp = sharp(input);
  if (metadata.icc) pipeline = pipeline.keepIccProfile();
  if (metadata.exif) pipeline = pipeline.keepExif();
  if (metadata.xmp) pipeline = pipeline.keepXmp();
  await pipeline
    .avif({ lossless: true, effort, bitdepth: avifBitdepth(metadata) })
    .toFile(output);
}

async function runSharpPng(
  input: string,
  output: string,
  compressionLevel: number,
  adaptiveFiltering: boolean,
): Promise<void> {
  const { pipeline } = await metadataPreservingSharp(input, true);
  await pipeline
    .png({ compressionLevel, adaptiveFiltering, palette: false })
    .toFile(output);
}

async function runSharpJpeg(
  input: string,
  output: string,
  mozjpeg: boolean,
): Promise<void> {
  const { pipeline } = await metadataPreservingSharp(input);
  await pipeline
    .jpeg({
      quality: 100,
      chromaSubsampling: "4:4:4",
      progressive: true,
      optimiseCoding: true,
      mozjpeg,
    })
    .toFile(output);
}

async function runSharpWebp(
  input: string,
  output: string,
  effort: number,
): Promise<void> {
  const { pipeline } = await metadataPreservingSharp(input);
  await pipeline.webp({ lossless: true, effort, exact: true }).toFile(output);
}

async function runSharpGif(
  input: string,
  output: string,
  effort: number,
): Promise<void> {
  const { metadata, pipeline } = await metadataPreservingSharp(input, true);
  await pipeline
    .gif({
      effort,
      reuse: true,
      dither: 1,
      interFrameMaxError: 0,
      interPaletteMaxError: 0,
      keepDuplicateFrames: true,
      loop: metadata.loop,
      delay: metadata.delay,
    })
    .toFile(output);
}

async function pngIsInterlaced(input: string): Promise<boolean> {
  const source = await readFile(input);
  return (
    source.length > 28 &&
    source
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    source.subarray(12, 16).toString("ascii") === "IHDR" &&
    source[28] === 1
  );
}

async function strategiesFor(
  format: ImageFormat,
  input: string,
): Promise<Strategy[]> {
  switch (format) {
    case "png": {
      const interlaceMode = (await pngIsInterlaced(input)) ? "off" : "keep";
      const inputBytes = (await stat(input)).size;
      const strategies: Strategy[] = [
        {
          provider: "native",
          name: "oxipng-o1",
          run: (source, output, tools) =>
            runTool(tools.oxipng, [
              "-o",
              "1",
              "-i",
              interlaceMode,
              "--out",
              output,
              source,
            ]),
        },
        {
          provider: "native",
          name: "oxipng-o4",
          run: (source, output, tools) =>
            runTool(tools.oxipng, [
              "-o",
              "4",
              "-i",
              interlaceMode,
              "--out",
              output,
              source,
            ]),
        },
        {
          provider: "native",
          name: "oxipng-o6",
          run: (source, output, tools) =>
            runTool(tools.oxipng, [
              "-o",
              "6",
              "-i",
              interlaceMode,
              "--out",
              output,
              source,
            ]),
        },
        {
          provider: "native",
          name: "oxipng-max",
          run: (source, output, tools) =>
            runTool(tools.oxipng, [
              "-o",
              "max",
              "-i",
              interlaceMode,
              "--out",
              output,
              source,
            ]),
        },
        {
          provider: "sharp",
          name: "sharp-png-z6-adaptive",
          run: (source, output) => runSharpPng(source, output, 6, true),
        },
        {
          provider: "sharp",
          name: "sharp-png-z9-adaptive",
          run: (source, output) => runSharpPng(source, output, 9, true),
        },
      ];

      if (inputBytes <= PNG_ZOPFLI_MAX_BYTES) {
        strategies.splice(3, 0, {
          provider: "native",
          name: "oxipng-max-zopfli-fast-zi8",
          run: (source, output, tools) =>
            runTool(tools.oxipng, [
              "-o",
              "max",
              "--fast",
              "-z",
              "--zi",
              "8",
              "-i",
              interlaceMode,
              "--out",
              output,
              source,
            ]),
        });
      }

      return strategies;
    }
    case "jpeg":
      return [
        {
          provider: "native",
          name: "mozjpeg-baseline",
          run: (source, output, tools) =>
            runTool(tools.jpegtran, [
              "-revert",
              "-copy",
              "all",
              "-optimize",
              "-outfile",
              output,
              source,
            ]),
        },
        {
          provider: "native",
          name: "mozjpeg-progressive",
          run: (source, output, tools) =>
            runTool(tools.jpegtran, [
              "-copy",
              "all",
              "-optimize",
              "-progressive",
              "-outfile",
              output,
              source,
            ]),
        },
        {
          provider: "native",
          name: "mozjpeg-progressive-fastcrush",
          run: (source, output, tools) =>
            runTool(tools.jpegtran, [
              "-copy",
              "all",
              "-optimize",
              "-progressive",
              "-fastcrush",
              "-outfile",
              output,
              source,
            ]),
        },
        {
          provider: "sharp",
          name: "sharp-jpeg-q100",
          run: (source, output) => runSharpJpeg(source, output, false),
        },
        {
          provider: "sharp",
          name: "sharp-jpeg-mozjpeg-q100",
          run: (source, output) => runSharpJpeg(source, output, true),
        },
      ];
    case "webp":
      return [
        {
          provider: "sharp",
          name: "sharp-webp-effort-4",
          run: (source, output) => runSharpWebp(source, output, 4),
        },
        {
          provider: "sharp",
          name: "sharp-webp-effort-6",
          run: (source, output) => runSharpWebp(source, output, 6),
        },
      ];
    case "gif":
      return [
        {
          provider: "sharp",
          name: "sharp-gif-effort-7",
          run: (source, output) => runSharpGif(source, output, 7),
        },
        {
          provider: "sharp",
          name: "sharp-gif-effort-10",
          run: (source, output) => runSharpGif(source, output, 10),
        },
      ];
    case "avif":
      return [4, 6, 9].map((effort) => ({
        provider: "sharp",
        name: `sharp-avif-effort-${effort}`,
        run: (source, output) => runAvif(source, output, effort),
      }));
  }
}

function extensionFor(format: ImageFormat): string {
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds.toFixed(1)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function formatDelta(inputBytes: number, outputBytes: number): string {
  const percent = ((inputBytes - outputBytes) / inputBytes) * 100;
  return `${percent >= 0 ? "-" : "+"}${Math.abs(percent).toFixed(2)}%`;
}

function snapshotMismatchFields(before: unknown, after: unknown): string[] {
  const beforeRecord = JSON.parse(JSON.stringify(before)) as Record<
    string,
    unknown
  >;
  const afterRecord = JSON.parse(JSON.stringify(after)) as Record<
    string,
    unknown
  >;
  delete beforeRecord.hasAlpha;
  delete afterRecord.hasAlpha;

  return [
    ...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
  ]
    .filter(
      (key) =>
        JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]),
    )
    .sort();
}

function printResults(results: readonly Result[]): void {
  const rows = results.map((result) => ({
    format: result.format,
    fixture: result.fixture,
    provider: result.provider,
    strategy: result.strategy,
    time:
      result.milliseconds === undefined
        ? "—"
        : formatDuration(result.milliseconds),
    output:
      result.outputBytes === undefined ? "—" : formatBytes(result.outputBytes),
    change:
      result.outputBytes === undefined
        ? "—"
        : formatDelta(result.inputBytes, result.outputBytes),
    valid: result.valid ? "yes" : "NO",
    smaller: result.smaller ? "yes" : "no",
    error: result.error ?? "",
  }));

  console.log("\nPer-fixture results\n");
  console.table(rows);

  const grouped = new Map<
    string,
    {
      format: ImageFormat;
      provider: Provider;
      strategy: string;
      results: Result[];
    }
  >();

  for (const result of results) {
    const key = `${result.format}:${result.provider}:${result.strategy}`;
    const group = grouped.get(key) ?? {
      format: result.format,
      provider: result.provider,
      strategy: result.strategy,
      results: [],
    };
    group.results.push(result);
    grouped.set(key, group);
  }

  const maxFixtureCountByFormat = new Map<ImageFormat, number>();
  for (const group of grouped.values()) {
    maxFixtureCountByFormat.set(
      group.format,
      Math.max(
        maxFixtureCountByFormat.get(group.format) ?? 0,
        group.results.length,
      ),
    );
  }

  const aggregate = [...grouped.values()].map((group) => {
    const validCount = group.results.filter((result) => result.valid).length;
    const smallerCount = group.results.filter(
      (result) => result.smaller,
    ).length;
    const outputResults = group.results.filter(
      (
        result,
      ): result is Result & { outputBytes: number; milliseconds: number } =>
        result.outputBytes !== undefined && result.milliseconds !== undefined,
    );
    const inputBytes = outputResults.reduce(
      (sum, result) => sum + result.inputBytes,
      0,
    );
    const outputBytes = outputResults.reduce(
      (sum, result) => sum + result.outputBytes,
      0,
    );
    const totalMilliseconds = outputResults.reduce(
      (sum, result) => sum + result.milliseconds,
      0,
    );
    const complete =
      validCount === group.results.length &&
      group.results.length === maxFixtureCountByFormat.get(group.format);

    return {
      ...group,
      validCount,
      smallerCount,
      inputBytes,
      outputBytes,
      totalMilliseconds,
      complete,
    };
  });

  const bestByFormat = new Map<
    ImageFormat,
    { outputBytes: number; totalMilliseconds: number }
  >();
  for (const group of aggregate) {
    if (!group.complete) continue;
    const current = bestByFormat.get(group.format);
    if (!current) {
      bestByFormat.set(group.format, {
        outputBytes: group.outputBytes,
        totalMilliseconds: group.totalMilliseconds,
      });
      continue;
    }
    current.outputBytes = Math.min(current.outputBytes, group.outputBytes);
    current.totalMilliseconds = Math.min(
      current.totalMilliseconds,
      group.totalMilliseconds,
    );
  }

  const summary = aggregate.map((group) => {
    const best = bestByFormat.get(group.format);
    const extraBytes = best ? group.outputBytes - best.outputBytes : 0;
    const extraPercent =
      best && best.outputBytes > 0 ? (extraBytes / best.outputBytes) * 100 : 0;
    return {
      format: group.format,
      provider: group.provider,
      strategy: group.strategy,
      fixtures: group.results.length,
      valid: `${group.validCount}/${group.results.length}`,
      smaller: `${group.smallerCount}/${group.results.length}`,
      "total time": formatDuration(group.totalMilliseconds),
      "vs fastest":
        group.complete && best
          ? `${(group.totalMilliseconds / best.totalMilliseconds).toFixed(1)}x`
          : "—",
      "total output": formatBytes(group.outputBytes),
      "total change":
        group.inputBytes > 0
          ? formatDelta(group.inputBytes, group.outputBytes)
          : "—",
      "extra vs smallest":
        group.complete && best
          ? extraBytes === 0
            ? "best"
            : `+${formatBytes(extraBytes)} (+${extraPercent.toFixed(2)}%)`
          : "—",
    };
  });

  console.log("\nDecision view\n");
  console.table(summary);
}

async function benchmarkFixture(
  input: string,
  format: ImageFormat,
  root: string,
  tools: ToolPaths,
  runs: number,
): Promise<Result[]> {
  const fixture = path.relative(root, input);
  const inputBytes = (await stat(input)).size;
  let originalSnapshot;

  try {
    originalSnapshot = await snapshotImage(input, format);
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      console.log(`skip ${fixture}: ${error.message}`);
      return [];
    }
    throw error;
  }

  const strategies = await strategiesFor(format, input);
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "compress-image-bench-"),
  );
  const results: Result[] = [];

  try {
    for (const strategy of strategies) {
      const times: number[] = [];
      let output = "";
      let errorMessage: string | undefined;

      for (let run = 0; run < runs; run += 1) {
        output = path.join(
          tempDir,
          `${strategy.name}-${run}${extensionFor(format)}`,
        );
        const started = performance.now();
        try {
          await strategy.run(input, output, tools);
          times.push(performance.now() - started);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          break;
        }
      }

      if (errorMessage) {
        results.push({
          format,
          fixture,
          provider: strategy.provider,
          strategy: strategy.name,
          inputBytes,
          valid: false,
          smaller: false,
          error: errorMessage,
        });
        continue;
      }

      const outputBytes = (await stat(output)).size;
      let valid = false;
      try {
        const candidateSnapshot = await snapshotImage(output, format);
        valid = snapshotsMatch(originalSnapshot, candidateSnapshot);
        if (!valid) {
          errorMessage = `validation mismatch: ${snapshotMismatchFields(
            originalSnapshot,
            candidateSnapshot,
          ).join(", ")}`;
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      results.push({
        format,
        fixture,
        provider: strategy.provider,
        strategy: strategy.name,
        inputBytes,
        outputBytes,
        milliseconds: median(times),
        valid,
        smaller: valid && outputBytes < inputBytes,
        error: valid ? undefined : (errorMessage ?? "validation mismatch"),
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return results;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const tools = getBundledToolPaths(process.cwd());
  const root = fixtureRoot(options.corpus);
  const fixtures = (await listFixtures(root)).filter((fixture) => {
    const format = getImageFormat(fixture);
    if (!format) return false;
    if (options.format && format !== options.format) return false;
    if (
      options.fixture &&
      !path.relative(root, fixture).includes(options.fixture)
    ) {
      return false;
    }
    return true;
  });

  if (fixtures.length === 0) {
    throw new Error("No matching fixtures found");
  }

  console.log(
    `Benchmarking ${fixtures.length} ${options.corpus} fixture(s), ${options.runs} run(s) per strategy`,
  );
  console.log(
    "Encoder time excludes validation time. Fixtures are never modified.",
  );
  console.log(
    "Invalid output is still reported because rejecting a smaller Sharp/native result is part of the comparison.",
  );

  const results: Result[] = [];
  for (const fixture of fixtures) {
    const format = getImageFormat(fixture);
    if (!format) continue;
    console.log(`\n${path.relative(root, fixture)}`);
    results.push(
      ...(await benchmarkFixture(fixture, format, root, tools, options.runs)),
    );
  }

  printResults(results);

  const invalid = results.filter((result) => !result.valid);
  if (invalid.length > 0) {
    console.log(
      `\n${invalid.length} strategy result(s) failed the extension validation contract; these are benchmark findings, not benchmark failures.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
