import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const srcRoot = join(repoRoot, "src");

// The dispatcher and the effect runner are the single writers for run-status
// and phase status JSON. They are the only modules that may encode status
// values destined for disk.
const SINGLE_WRITER_ALLOWLIST: ReadonlySet<string> = new Set([
  "src/app/dispatcher.ts",
  "src/app/effectRunner.ts",
]);

// Documented exceptions: each of these files writes a single non-state
// metadata field (gateProfileId, worktreePath, claudeSessionId) and is a
// candidate for future migration through the dispatcher. They are listed
// here so the guard fails the build for any new violation but tolerates the
// known set captured at the end of the phase-07 cleanup.
const DOCUMENTED_METADATA_WRITERS: ReadonlySet<string> = new Set([
  "src/app/gates.ts",
  "src/app/phaseStatusUpdates.ts",
  "src/infra/providers/sessionWriter.ts",
]);

const ENCODER_IMPORT = /\b(encodePhaseStatus|encodeRunStatus)\b/;

function listTsFiles(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true }) as Array<{
    parentPath?: string;
    path?: string;
    name: string;
    isFile: () => boolean;
  }>;
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    const parent = entry.parentPath ?? entry.path ?? root;
    out.push(join(parent, entry.name));
  }
  return out;
}

// ── Routing domain purity ─────────────────────────────────────────────────────
// src/domain/routing/ must stay pure: no Effect, no @opentelemetry, no FileSystem
// port, no infra/ imports. resolveModel is a total pure function over its inputs.

const ROUTING_DOMAIN_FORBIDDEN = [
  /\bfrom\s+["']effect[/"']/,
  /\bfrom\s+["']@opentelemetry\//,
  /\bfrom\s+["'].*ports\/fs/,
  /\bfrom\s+["'].*\/infra\//,
];

describe("architectural guard: routing domain purity", () => {
  const routingDomainRoot = join(srcRoot, "domain", "routing");

  it("src/domain/routing/ imports no Effect, @opentelemetry, FileSystem port, or infra modules", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(routingDomainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const pattern of ROUTING_DOMAIN_FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${rel}: matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ── Provider spawn boundary ────────────────────────────────────────────────────
// Only src/infra/providers/ may spawn provider binaries (claude, vibe, codex).
// This prevents app/ or domain/ layers from accidentally shelling out directly.

const SPAWN_PATTERN = /\bspawn\s*\(\s*["'`](claude|vibe|codex)/;
const PROVIDERS_DIR = join(srcRoot, "infra", "providers");

describe("architectural guard: provider spawn boundary", () => {
  it("only src/infra/providers/ may spawn provider binaries (claude, vibe, codex)", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(srcRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");

      const isInProvidersDir = absPath.startsWith(PROVIDERS_DIR);
      if (isInProvidersDir) continue;

      const content = readFileSync(absPath, "utf8");
      if (SPAWN_PATTERN.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("architectural guard: single status writer", () => {
  it("only the dispatcher, runner, and documented metadata writers encode status JSON", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(srcRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (rel === "src/schemas/status.ts") continue;
      if (SINGLE_WRITER_ALLOWLIST.has(rel)) continue;
      if (DOCUMENTED_METADATA_WRITERS.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");
      if (ENCODER_IMPORT.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  it("documented metadata writers are kept honest by still actually importing the encoders", () => {
    for (const rel of DOCUMENTED_METADATA_WRITERS) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      expect(
        ENCODER_IMPORT.test(content),
        `${rel} no longer imports a status encoder — remove it from DOCUMENTED_METADATA_WRITERS`,
      ).toBe(true);
    }
  });
});
