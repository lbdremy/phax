// Cross-compiles phax for all release targets and writes SHA-256 checksums.
// Imported by phase-03 npm wrapper and phase-05 release workflow for the platform mapping.
//
// WHY TWO STEPS (bundle then compile):
// deno compile does not tree-shake — pointed at the raw src it embeds the *files*
// of every reachable module (~274 MB of node_modules for ~1.5 MB of used code).
// Bundling with esbuild first collapses the embedded set to the reachable,
// tree-shaken modules (~1.5 MB); deno compile --include then adds back the three
// data files the CLI reads at runtime. Result: ~74 MB instead of ~360 MB.
//
// WHY BUNDLE PATH IS THREE DIRECTORIES DEEP (dist/release/bundle/phax.mjs):
// usage.ts and completions.ts resolve package.json / phax.usage.kdl / .claude/skills
// via import.meta.url joined with "../../../". At three levels deep the prefix
// resolves to the VFS root, which is exactly where deno compile --include drops the
// included files. Flattening the bundle would break --version / --usage / skills
// inside the binary.
import { join } from "node:path";

export const RELEASE_TARGETS = [
  { platform: "darwin", arch: "arm64", triple: "aarch64-apple-darwin", name: "phax-darwin-arm64" },
  { platform: "darwin", arch: "x64", triple: "x86_64-apple-darwin", name: "phax-darwin-x64" },
  { platform: "linux", arch: "x64", triple: "x86_64-unknown-linux-gnu", name: "phax-linux-x64" },
  {
    platform: "linux",
    arch: "arm64",
    triple: "aarch64-unknown-linux-gnu",
    name: "phax-linux-arm64",
  },
] as const;

const COMPILE_FLAGS = [
  "--no-check",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-sys",
  "--allow-run",
  "--include",
  "package.json",
  "--include",
  "phax.usage.kdl",
  "--include",
  ".claude/skills",
] as const;

// Three levels deep so import.meta.url + "../../../" resolves to the VFS root.
const BUNDLE_PATH = "dist/release/bundle/phax.mjs";
const OUTPUT_DIR = "dist/release";
// ESM banner: CommonJS deps (commander) call require("node:events"); an ESM bundle
// has no require — this shim restores it.
const CJS_BANNER = `import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);`;

async function sha256hex(path: string): Promise<string> {
  const data = await Deno.readFile(path);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function bundle(): Promise<void> {
  console.log("Bundling with esbuild...");
  await Deno.mkdir("dist/release/bundle", { recursive: true });

  const cmd = new Deno.Command("node_modules/.bin/esbuild", {
    args: [
      "src/cli/main.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node20",
      `--outfile=${BUNDLE_PATH}`,
      `--banner:js=${CJS_BANNER}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const { success } = await cmd.output();
  if (!success) throw new Error("esbuild bundle failed");
  console.log(`  Bundle written to ${BUNDLE_PATH}`);
}

async function compileTarget(triple: string, name: string): Promise<void> {
  const outputPath = join(OUTPUT_DIR, name);
  console.log(`Building ${name} (${triple})...`);

  const cmd = new Deno.Command("deno", {
    args: ["compile", ...COMPILE_FLAGS, "--target", triple, "--output", outputPath, BUNDLE_PATH],
    stdout: "inherit",
    stderr: "inherit",
  });

  const { success } = await cmd.output();
  if (!success) throw new Error(`Failed to compile ${name}`);

  const hex = await sha256hex(outputPath);
  // sha256sum-compatible format: <hex>  <name>
  await Deno.writeTextFile(join(OUTPUT_DIR, `${name}.sha256`), `${hex}  ${name}\n`);
  console.log(`  SHA-256: ${hex.slice(0, 16)}...`);
}

async function compileHost(): Promise<void> {
  console.log("Building host binary...");
  await Deno.mkdir("dist/bin", { recursive: true });

  const cmd = new Deno.Command("deno", {
    args: ["compile", ...COMPILE_FLAGS, "--output", "dist/bin/phax", BUNDLE_PATH],
    stdout: "inherit",
    stderr: "inherit",
  });

  const { success } = await cmd.output();
  if (!success) throw new Error("Failed to compile host binary");
  console.log("  Host binary written to dist/bin/phax");
}

if (import.meta.main) {
  const isHost = Deno.args.includes("--host");

  await bundle();

  if (isHost) {
    await compileHost();
    console.log("\nHost binary written to dist/bin/phax");
  } else {
    await Deno.mkdir(OUTPUT_DIR, { recursive: true });
    for (const target of RELEASE_TARGETS) {
      await compileTarget(target.triple, target.name);
    }
    console.log(`\nAll binaries written to ${OUTPUT_DIR}/`);
  }
}
