// Cross-compiles phax for all release targets and writes SHA-256 checksums.
// Imported by phase-03 npm wrapper and phase-05 release workflow for the platform mapping.
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
  "--sloppy-imports",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-sys",
  "--allow-run=git,claude,codex,vibe,node,npm,pnpm,bun,deno,mise,rm,sh,bash,zsh,zed,code,vim,nano",
] as const;

const ENTRYPOINT = "src/cli/main.ts";
const OUTPUT_DIR = "dist/release";

async function sha256hex(path: string): Promise<string> {
  const data = await Deno.readFile(path);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildTarget(triple: string, name: string): Promise<void> {
  const outputPath = join(OUTPUT_DIR, name);
  console.log(`Building ${name} (${triple})...`);

  const cmd = new Deno.Command("deno", {
    args: ["compile", ...COMPILE_FLAGS, "--target", triple, "--output", outputPath, ENTRYPOINT],
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

if (import.meta.main) {
  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  for (const target of RELEASE_TARGETS) {
    await buildTarget(target.triple, target.name);
  }
  console.log(`\nAll binaries written to ${OUTPUT_DIR}/`);
}
