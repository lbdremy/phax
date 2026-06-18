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

// ── Pure domain purity (routing + reconciliation) ────────────────────────────
// src/domain/routing/ and src/domain/reconciliation/ must stay pure:
// no Effect, no @opentelemetry, no FileSystem port, no infra/ imports.

const PURE_DOMAIN_FORBIDDEN = [
  /\bfrom\s+["']effect[/"']/,
  /\bfrom\s+["']@opentelemetry\//,
  /\bfrom\s+["'].*ports\/fs/,
  /\bfrom\s+["'].*\/infra\//,
];

const PURE_DOMAIN_DIRS = [
  "domain/routing",
  "domain/reconciliation",
  "domain/security",
  "domain/publish",
];

describe("architectural guard: routing domain purity", () => {
  const routingDomainRoot = join(srcRoot, "domain", "routing");

  it("src/domain/routing/ imports no Effect, @opentelemetry, FileSystem port, or infra modules", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(routingDomainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const pattern of PURE_DOMAIN_FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${rel}: matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("architectural guard: reconciliation domain purity", () => {
  const reconciliationDomainRoot = join(srcRoot, "domain", "reconciliation");

  it("src/domain/reconciliation/ imports no Effect, @opentelemetry, FileSystem port, or infra modules", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(reconciliationDomainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const pattern of PURE_DOMAIN_FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${rel}: matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("architectural guard: security domain purity", () => {
  const securityDomainRoot = join(srcRoot, "domain", "security");

  it("src/domain/security/ imports no Effect, @opentelemetry, FileSystem port, or infra modules", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(securityDomainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const pattern of PURE_DOMAIN_FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${rel}: matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("architectural guard: publish domain purity", () => {
  const publishDomainRoot = join(srcRoot, "domain", "publish");

  it("src/domain/publish/ imports no Effect, @opentelemetry, FileSystem port, or infra modules", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(publishDomainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const pattern of PURE_DOMAIN_FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${rel}: matches ${pattern}`);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// Keep PURE_DOMAIN_DIRS in scope so it can be extended in future phases.
void PURE_DOMAIN_DIRS;

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

// ── Infra → app import direction ─────────────────────────────────────────────
// src/infra/**/*.ts must not import from src/app/ — that inverts the
// dependency arrow (app → ports ← infra).

// Known violation introduced in the agent-binding run (plan 11). Remove this
// entry once plan 15 phase-02 moves the import out of sessionWriter.
const INFRA_APP_ALLOWLIST: ReadonlySet<string> = new Set(["src/infra/providers/sessionWriter.ts"]);

const INFRA_APP_IMPORT = /from\s+["'][^"']*\/app\//;

describe("architectural guard: infra must not import from app", () => {
  const infraRoot = join(srcRoot, "infra");

  it("src/infra/**/*.ts does not import from src/app/ (except documented allowlist)", () => {
    const violations: string[] = [];

    for (const absPath of listTsFiles(infraRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (INFRA_APP_ALLOWLIST.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");
      if (INFRA_APP_IMPORT.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  it("infra→app allowlist entries are kept honest by still actually importing from app/", () => {
    for (const rel of INFRA_APP_ALLOWLIST) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      expect(
        INFRA_APP_IMPORT.test(content),
        `${rel} no longer imports from app/ — remove it from INFRA_APP_ALLOWLIST`,
      ).toBe(true);
    }
  });
});

// ── CLI → infra import direction ──────────────────────────────────────────────
// src/cli/**/*.ts may only import layer-composition symbols from src/infra/
// (identifiers containing "Layer", e.g. NodeFileSystemLayer) or type-only
// imports. Importing infra behaviour (getSessionAdapter, spawnInteractive, …)
// bypasses the port abstraction and is forbidden.

// Known violations introduced in the agent-binding run (plan 11). Remove each
// entry once plan 15 phase-01 moves the dispatch logic into src/domain/session/.
const CLI_INFRA_LOGIC_ALLOWLIST: ReadonlySet<string> = new Set([
  "src/cli/commands/enter.ts",
  "src/cli/commands/enterPhase.ts",
  "src/cli/commands/sessionInfo.ts",
]);

// Matches a complete import statement that pulls from an infra path.
// Group 1: optional "type " keyword (type-only whole import)
// Group 2: the brace-enclosed binding list
// Group 3: the module specifier
const CLI_INFRA_IMPORT_RE =
  /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']*\/infra\/[^"']*)["']/g;

function hasNonLayerBinding(bindingList: string): boolean {
  return bindingList
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
    .some((binding) => {
      // inline type keyword: `import { type Foo }` — always fine
      if (binding.startsWith("type ")) return false;
      // binding alias: `Foo as bar` — check the exported name (Foo)
      const exported = binding.split(/\s+as\s+/)[0].trim();
      return !exported.includes("Layer");
    });
}

describe("architectural guard: cli may import only layer composition from infra", () => {
  const cliRoot = join(srcRoot, "cli");

  it(
    "src/cli/**/*.ts imports from src/infra/ only layer symbols or type imports " +
      "(except documented allowlist)",
    () => {
      const violations: string[] = [];

      for (const absPath of listTsFiles(cliRoot)) {
        const rel = relative(repoRoot, absPath).split("\\").join("/");
        if (CLI_INFRA_LOGIC_ALLOWLIST.has(rel)) continue;

        const content = readFileSync(absPath, "utf8");
        CLI_INFRA_IMPORT_RE.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = CLI_INFRA_IMPORT_RE.exec(content)) !== null) {
          const isTypeOnlyImport = Boolean(match[1]);
          if (isTypeOnlyImport) continue;

          const bindingList = match[2];
          if (hasNonLayerBinding(bindingList)) {
            violations.push(`${rel}: ${match[0].trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it(
    "cli→infra logic allowlist entries are kept honest by still importing from " +
      "src/infra/sessionAdapters/",
    () => {
      for (const rel of CLI_INFRA_LOGIC_ALLOWLIST) {
        const content = readFileSync(join(repoRoot, rel), "utf8");
        expect(
          /from\s+["'][^"']*\/infra\/sessionAdapters\//.test(content),
          `${rel} no longer imports from infra/sessionAdapters/ — remove it from CLI_INFRA_LOGIC_ALLOWLIST`,
        ).toBe(true);
      }
    },
  );
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
