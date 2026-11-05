import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_IDS, type FormatId } from "../../src/schemas/schemaUrl.js";

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

const INFRA_APP_ALLOWLIST: ReadonlySet<string> = new Set([]);

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
// (identifiers containing "Layer", e.g. NodeFileSystemLayer, or ending in
// "Live", Effect's name for a live layer, e.g. ProviderStoreRootsLive) or
// type-only imports. Importing infra behaviour (getSessionAdapter,
// spawnInteractive, …) bypasses the port abstraction and is forbidden.

const CLI_INFRA_LOGIC_ALLOWLIST: ReadonlySet<string> = new Set([]);

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
      const exported = (binding.split(/\s+as\s+/)[0] ?? "").trim();
      return !exported.includes("Layer") && !exported.endsWith("Live");
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

          const bindingList = match[2] ?? "";
          if (hasNonLayerBinding(bindingList)) {
            violations.push(`${rel}: ${match[0].trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it("cli→infra logic allowlist is empty after phase-01 moved dispatch to domain/session", () => {
    expect(CLI_INFRA_LOGIC_ALLOWLIST.size).toBe(0);
  });
});

// ── Direct Node I/O outside ports/infra ──────────────────────────────────────
// All filesystem and process I/O must go through a port interface. Importing
// node:fs, node:fs/promises, node:child_process, or node:os directly in
// domain/ or cli/ bypasses that abstraction.
//
// src/domain/** is enforced strictly — it is already clean.
//
// src/cli/** has a documented allowlist of known violators captured at the end
// of the phase-02 run. These are candidates for future migration through the
// FileSystem port.
//
// src/app/** is deliberately excluded from this guard. Eight app/ files
// currently import node:fs directly (agentBinding, executePlan, loadConfig,
// loadPlan, resolveRunInfo, resume, finalReport, initProject). Routing all of
// those through the FileSystem port is a separate, larger refactor; adding a
// guard against the current tree would be vacuous until that refactor lands.
//
// src/infra/** and src/ports/** are unscanned — infra is where I/O is allowed,
// and ports declare it.

const DIRECT_NODE_IO = /\bfrom\s+["'](node:fs|node:fs\/promises|node:child_process|node:os)["']/;

// Known cli/ violators. Remove an entry once the file is migrated to the
// FileSystem port.
const CLI_DIRECT_IO_ALLOWLIST: ReadonlySet<string> = new Set([
  // `run` reads plan.md and the registry, and `resume` run-status.json, publication.json and
  // plan.md, directly, as their Commander commands did before they moved onto the runner.
  "src/cli/definitions/resume.ts",
  "src/cli/definitions/run.ts",
  "src/cli/commands/usage.ts",
  "src/cli/commands/usageSpec.ts",
  // `skills install` resolves the user's home directory for its install roots.
  "src/cli/definitions/skills.ts",
  // `completions` runs the `usage` CLI over phax.usage.kdl; `session-info` reads a phase's raw
  // model-resolution.json for --debug.
  "src/cli/definitions/completions.ts",
  "src/cli/definitions/sessionInfo.ts",
  // The working tree's root, read with git for the commands' path arguments.
  "src/cli/definitions/shared.ts",
  "src/cli/interruptHandler.ts",
  // The command library port's one process edge: the process as the runner reads it (its
  // stdin, its files, stdout and stderr). No other file of the port touches the process.
  "src/cli/commandLibrary/commander/processIo.ts",
]);

describe("architectural guard: no direct Node I/O outside ports/infra", () => {
  it("src/domain/**/*.ts never imports node:fs, node:fs/promises, node:child_process, or node:os", () => {
    const violations: string[] = [];
    const domainRoot = join(srcRoot, "domain");

    for (const absPath of listTsFiles(domainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");
      if (DIRECT_NODE_IO.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  it("src/cli/**/*.ts imports no direct Node I/O (except documented allowlist)", () => {
    const violations: string[] = [];
    const cliRoot = join(srcRoot, "cli");

    for (const absPath of listTsFiles(cliRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (CLI_DIRECT_IO_ALLOWLIST.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");
      if (DIRECT_NODE_IO.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  it("cli direct-I/O allowlist entries are kept honest by still actually importing a Node I/O module", () => {
    for (const rel of CLI_DIRECT_IO_ALLOWLIST) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      expect(
        DIRECT_NODE_IO.test(content),
        `${rel} no longer imports a direct Node I/O module — remove it from CLI_DIRECT_IO_ALLOWLIST`,
      ).toBe(true);
    }
  });
});

// ── Use cases write through their OutputPort ──────────────────────────────────
// A use case under src/app/ never writes to the process's streams: under `--json`
// the runner owns stdout (the answer) and stderr (message lines), so a line written
// around it breaks the contract (§5.3). Each exception is listed with its reason.

const PROCESS_WRITE = /\bprocess\.(?:stdout|stderr)\.write\(|\bconsole\.(?:log|warn|error|info)\(/;

const APP_PROCESS_WRITE_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  [
    "src/app/costLedger.ts",
    "withInvocationCost wraps every provider invocation (phases, fixes, stops, handoffs, reviews); its rare ledger-write warning has no port to reach yet",
  ],
]);

describe("architectural guard: use cases write through their OutputPort", () => {
  it("no file under src/app/ writes to process.stdout, process.stderr or the console (except the documented allowlist)", () => {
    const violations = listTsFiles(join(srcRoot, "app"))
      .map((absPath) => relative(repoRoot, absPath).split("\\").join("/"))
      .filter((rel) => !APP_PROCESS_WRITE_ALLOWLIST.has(rel))
      .filter((rel) => PROCESS_WRITE.test(readFileSync(join(repoRoot, rel), "utf8")));
    expect(violations).toEqual([]);
  });

  it("app process-write allowlist entries are kept honest by still writing to the process", () => {
    for (const rel of APP_PROCESS_WRITE_ALLOWLIST.keys()) {
      expect(
        PROCESS_WRITE.test(readFileSync(join(repoRoot, rel), "utf8")),
        `${rel} no longer writes to the process — remove it from APP_PROCESS_WRITE_ALLOWLIST`,
      ).toBe(true);
    }
  });
});

// ── The command library's contract stays pure ─────────────────────────────────
// src/cli/commandLibrary/contract/ is the library's contract package, ported: it
// imports neither the argument parser nor any Node module, so that a runner over
// another parser, or another host, takes it as it is. Commander and the process
// edge belong to src/cli/commandLibrary/commander/.

const CONTRACT_FORBIDDEN_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](commander|node:[^"']+)["']/;

describe("architectural guard: the command library's contract is pure", () => {
  it("no file under src/cli/commandLibrary/contract/ imports commander or a node: module", () => {
    const contractRoot = join(srcRoot, "cli", "commandLibrary", "contract");
    const files = listTsFiles(contractRoot);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const absPath of files) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const match = CONTRACT_FORBIDDEN_IMPORT.exec(readFileSync(absPath, "utf8"));
      if (match !== null) violations.push(`${rel}: imports ${match[1]}`);
    }
    expect(violations).toEqual([]);
  });

  it("the detector flags commander and node: imports, and not effect", () => {
    expect(CONTRACT_FORBIDDEN_IMPORT.test(`import { Command } from "commander";`)).toBe(true);
    expect(CONTRACT_FORBIDDEN_IMPORT.test(`import { readFileSync } from "node:fs";`)).toBe(true);
    expect(CONTRACT_FORBIDDEN_IMPORT.test(`const m = await import("node:crypto");`)).toBe(true);
    expect(CONTRACT_FORBIDDEN_IMPORT.test(`import * as Schema from "effect/Schema";`)).toBe(false);
  });
});

// ── Commander stays behind the runner's adapter ───────────────────────────────
// Inside the command library port, commander/commanderAdapter.ts is the only file
// that imports `commander`: the rest of the runner reads a call's words itself and
// hands the adapter plain specs, so that swapping the parser touches one file.

const COMMANDER_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']commander["']/;
const COMMANDER_ADAPTER = "src/cli/commandLibrary/commander/commanderAdapter.ts";

describe("architectural guard: only the runner's adapter imports commander", () => {
  it("under src/cli/commandLibrary/, only commander/commanderAdapter.ts imports commander", () => {
    const portRoot = join(srcRoot, "cli", "commandLibrary");
    const importers = listTsFiles(portRoot)
      .map((absPath) => relative(repoRoot, absPath).split("\\").join("/"))
      .filter((rel) => COMMANDER_IMPORT.test(readFileSync(join(repoRoot, rel), "utf8")));
    expect(importers).toEqual([COMMANDER_ADAPTER]);
  });

  it("the detector flags a static and a dynamic commander import, and not a name that holds it", () => {
    expect(COMMANDER_IMPORT.test(`import { Command } from "commander";`)).toBe(true);
    expect(COMMANDER_IMPORT.test(`const m = await import("commander");`)).toBe(true);
    expect(COMMANDER_IMPORT.test(`import { parseCall } from "./commanderAdapter.js";`)).toBe(false);
  });
});

// ── phax is free of the parser outside the runner's adapter ──────────────────
// The runner owns phax's program (ac-no-parser): src/cli/definitions/ holds phax's
// commands as data and Effects over the contract alone, main.ts hands every call to
// the runner, and nothing else in src/ reads a call through Commander.

describe("architectural guard: in src/, only the runner's adapter imports commander", () => {
  it("no file under src/ but commander/commanderAdapter.ts imports commander", () => {
    const files = listTsFiles(srcRoot);
    expect(files.length).toBeGreaterThan(0);
    const importers = files
      .map((absPath) => relative(repoRoot, absPath).split("\\").join("/"))
      .filter((rel) => COMMANDER_IMPORT.test(readFileSync(join(repoRoot, rel), "utf8")));
    expect(importers).toEqual([COMMANDER_ADAPTER]);
  });
});

// ── Repo-rooted FileSystem layer ──────────────────────────────────────────────
// The FileSystem port is rooted at config.repoRoot so phax keeps git's
// work-from-anywhere contract. A command under src/cli/commands/ or
// src/cli/definitions/ must build its
// FileSystem layer through makeRepoRootedFileSystemLayer(config) (from
// runLayers.ts) or makeRootedNodeFileSystemLayer(root) (from infra/fs) — never
// the identity NodeFileSystemLayer, which resolves relative paths against the
// process cwd and reintroduces the subdirectory bug this guard prevents.
//
// The allowlist names the files that legitimately use the identity layer:
//   - runLayers.ts: houses the rooted helper and the global-telemetry-journal
//     wiring (journal + trace paths are absolute, so the identity layer is
//     correct there).
//   - agent: no resolved config; only absolute ~/.phax and ~/.vibe paths.
//   - init: runs before/without a phax project (init creates phax.json).
//   - report: no resolved config; reads the run folders under ~/.phax.
//   - schema: writes the absolute paths it resolved from the git root.
//   - security: reads the global provider config under ~/.phax.
//   - skills: installs to absolute targets under the git root or the home.
const IDENTITY_FS_LAYER_ALLOWLIST: ReadonlySet<string> = new Set([
  "src/cli/commands/runLayers.ts",
  "src/cli/definitions/agent.ts",
  "src/cli/definitions/init.ts",
  "src/cli/definitions/report.ts",
  "src/cli/definitions/schema.ts",
  "src/cli/definitions/security.ts",
  "src/cli/definitions/skills.ts",
]);

// Matches an import statement pulling bindings from an infra/fs module.
// Group 1: the brace-enclosed binding list.
const INFRA_FS_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*\/infra\/fs(?:\.js)?["']/g;

// Whether the file imports the exact identity binding `NodeFileSystemLayer`.
// Must not be fooled by `makeRootedNodeFileSystemLayer`, the rooted factory,
// which contains "NodeFileSystemLayer" as a substring.
function importsIdentityFsLayer(content: string): boolean {
  INFRA_FS_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INFRA_FS_IMPORT_RE.exec(content)) !== null) {
    const bindings = (match[1] ?? "")
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    for (const binding of bindings) {
      const exported = binding
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (exported === "NodeFileSystemLayer") return true;
    }
  }
  return false;
}

describe("architectural guard: cli commands root the FileSystem layer", () => {
  const commandRoots = [join(srcRoot, "cli", "commands"), join(srcRoot, "cli", "definitions")];

  it("no file under src/cli/commands/ or src/cli/definitions/ imports the identity NodeFileSystemLayer (except allowlist)", () => {
    const violations: string[] = [];

    for (const absPath of commandRoots.flatMap(listTsFiles)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (IDENTITY_FS_LAYER_ALLOWLIST.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");
      if (importsIdentityFsLayer(content)) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      "These commands import the identity NodeFileSystemLayer, which resolves relative " +
        "paths against the process cwd. Build the repo-rooted layer via " +
        "makeRepoRootedFileSystemLayer(config) from ./runLayers.js instead (or " +
        "makeRootedNodeFileSystemLayer(root) from ../../infra/fs.js).",
    ).toEqual([]);
  });

  it("allowlist entries are kept honest by still actually importing the identity layer", () => {
    for (const rel of IDENTITY_FS_LAYER_ALLOWLIST) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      expect(
        importsIdentityFsLayer(content),
        `${rel} no longer imports the identity NodeFileSystemLayer — remove it from IDENTITY_FS_LAYER_ALLOWLIST`,
      ).toBe(true);
    }
  });

  it("the detector flags the identity import but not the rooted factory", () => {
    const identityImport = `import { NodeFileSystemLayer } from "../../infra/fs.js";`;
    const rootedImport = `import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";`;
    const bothImport = `import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../infra/fs.js";`;

    expect(importsIdentityFsLayer(identityImport)).toBe(true);
    expect(importsIdentityFsLayer(rootedImport)).toBe(false);
    expect(importsIdentityFsLayer(bothImport)).toBe(true);
  });
});

// ── Provider store roots beside every backend ────────────────────────────────
// A command that builds the bare backend reads no provider store: its
// transcript captures are all missing and its vibe usage unavailable, with
// nothing failing. Every command builds it through makeProviderBackendLayer
// (runLayers.ts), which provides ProviderStoreRootsLive beside it.

describe("architectural guard: cli commands build the backend with its store roots", () => {
  it("only runLayers.ts calls makeNodeBackendLayer under src/cli/", () => {
    const violations: string[] = [];
    for (const absPath of listTsFiles(join(srcRoot, "cli"))) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (rel === "src/cli/commands/runLayers.ts") continue;
      if (/\bmakeNodeBackendLayer\b/.test(readFileSync(absPath, "utf8"))) violations.push(rel);
    }
    expect(
      violations,
      "Build the backend through makeProviderBackendLayer from ./runLayers.js, which " +
        "provides the provider store roots beside it.",
    ).toEqual([]);
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

// ── Schemas package closure ──────────────────────────────────────────────────
// @lbdremy/phax-schemas is built by tsc from its entry alone, so everything
// the entry reaches through relative imports is published. The closure must
// stay pure schema code: no layer with side effects, no Node or Deno I/O, no
// dependency other than effect, and none of phax's config or provider-output
// schemas.

const SCHEMAS_PACKAGE_ENTRY = "packages/schemas/src/index.ts";

const CLOSURE_ALLOWED_DIRS = ["packages/schemas/src/", "src/schemas/", "src/domain/"];
// §5.6: exactly the schema modules of the exported formats, and what they
// import. A new src/ file in the closure is published, so it is named here.
const CLOSURE_SRC_ALLOWLIST = [
  "src/domain/branded.ts",
  "src/domain/plan/testLineGrammar.ts",
  "src/domain/sessionId.ts",
  "src/schemas/acceptanceLift.ts",
  "src/schemas/acceptanceRequest.ts",
  "src/schemas/answerStamp.ts",
  "src/schemas/approvalRecord.ts",
  "src/schemas/approvedBy.ts",
  "src/schemas/architecture.ts",
  "src/schemas/artifactStatusDocument.ts",
  "src/schemas/authoringRecord.ts",
  "src/schemas/brief.ts",
  "src/schemas/briefReport.ts",
  "src/schemas/codeReview.ts",
  "src/schemas/complianceReview.ts",
  "src/schemas/costLedger.ts",
  "src/schemas/decideVerdicts.ts",
  "src/schemas/decisionRecord.ts",
  "src/schemas/firstReading.ts",
  "src/schemas/formatError.ts",
  "src/schemas/gateAttribution.ts",
  "src/schemas/gateReport.ts",
  "src/schemas/gateRequest.ts",
  "src/schemas/handDecisionAnswer.ts",
  "src/schemas/history/authoring-record-manifest/0.17.0.ts",
  "src/schemas/history/authoring-record-manifest/0.23.0.ts",
  "src/schemas/history/authoring-record-manifest/pre-schema.ts",
  "src/schemas/history/brief-record/0.20.0.ts",
  "src/schemas/history/code-review/0.29.0.ts",
  "src/schemas/history/compliance-review/0.17.0.ts",
  "src/schemas/history/compliance-review/pre-schema.ts",
  "src/schemas/history/cost-ledger/0.25.0.ts",
  "src/schemas/history/cost-ledger/0.26.0.ts",
  "src/schemas/history/decision-record-manifest/0.25.0.ts",
  "src/schemas/history/decision-record-manifest/0.28.0.ts",
  "src/schemas/history/first-reading/0.26.0.ts",
  "src/schemas/history/gate-attribution/0.17.0.ts",
  "src/schemas/history/gate-attribution/0.20.0.ts",
  "src/schemas/history/gate-attribution/0.21.0.ts",
  "src/schemas/history/gate-attribution/0.26.0.ts",
  "src/schemas/history/gate-attribution/0.31.0.ts",
  "src/schemas/history/gate-attribution/pre-schema.ts",
  "src/schemas/history/hand-decision-answer/0.25.0.ts",
  "src/schemas/history/interactive-handoff/0.26.0.ts",
  "src/schemas/history/interactive-session/0.26.0.ts",
  "src/schemas/history/oracle-request/0.26.0.ts",
  "src/schemas/history/phase-file-reconciliation/0.17.0.ts",
  "src/schemas/history/phase-file-reconciliation/pre-schema.ts",
  "src/schemas/history/phase-record-manifest/0.17.0.ts",
  "src/schemas/history/phase-record-manifest/0.26.0.ts",
  "src/schemas/history/phase-record-manifest/0.30.0.ts",
  "src/schemas/history/phase-record-manifest/pre-schema.ts",
  "src/schemas/history/phase-status/0.17.0.ts",
  "src/schemas/history/phase-status/0.20.0.ts",
  "src/schemas/history/phase-status/0.26.0.ts",
  "src/schemas/history/phase-status/pre-schema.ts",
  "src/schemas/history/phax-plan-extraction/0.32.0.ts",
  "src/schemas/history/phax-plan/0.17.0.ts",
  "src/schemas/history/phax-plan/0.26.0.ts",
  "src/schemas/history/phax-plan/0.28.0.ts",
  "src/schemas/history/phax-plan/0.32.0.ts",
  "src/schemas/history/phax-plan/pre-schema.ts",
  "src/schemas/history/plan-approval-record/0.19.0.ts",
  "src/schemas/history/plan-approvals/pre-schema.ts",
  "src/schemas/history/plan-document/0.17.0.ts",
  "src/schemas/history/plan-document/0.20.0.ts",
  "src/schemas/history/plan-document/0.25.0.ts",
  "src/schemas/history/plan-document/0.26.0.ts",
  "src/schemas/history/plan-document/0.28.0.ts",
  "src/schemas/history/plan-document/0.32.0.ts",
  "src/schemas/history/plan-document/pre-schema.ts",
  "src/schemas/history/registry/0.17.0.ts",
  "src/schemas/history/registry/pre-schema.ts",
  "src/schemas/history/review-stop/0.26.0.ts",
  "src/schemas/history/run-list/0.26.0.ts",
  "src/schemas/history/run-list/0.30.0.ts",
  "src/schemas/history/run-status/0.17.0.ts",
  "src/schemas/history/run-status/0.26.0.ts",
  "src/schemas/history/run-status/pre-schema.ts",
  "src/schemas/history/spec-approval-record/0.19.0.ts",
  "src/schemas/history/spec-approvals/pre-schema.ts",
  "src/schemas/history/spec-document/0.17.0.ts",
  "src/schemas/history/spec-document/0.25.0.ts",
  "src/schemas/history/spec-document/0.27.0.ts",
  "src/schemas/history/spec-document/pre-schema.ts",
  "src/schemas/interactiveHandoff.ts",
  "src/schemas/interactiveSession.ts",
  "src/schemas/phaxPlan.ts",
  "src/schemas/planDocument.ts",
  "src/schemas/planExtraction.ts",
  "src/schemas/planLint.ts",
  "src/schemas/planOverview.ts",
  "src/schemas/providerId.ts",
  "src/schemas/questions.ts",
  "src/schemas/reconciliation.ts",
  "src/schemas/registry.ts",
  "src/schemas/release.ts",
  "src/schemas/report.ts",
  "src/schemas/reviewRecord.ts",
  "src/schemas/reviewStop.ts",
  "src/schemas/runList.ts",
  "src/schemas/runRecord.ts",
  "src/schemas/schemaUrl.ts",
  "src/schemas/sessionId.ts",
  "src/schemas/specApprovalRecord.ts",
  "src/schemas/specDocument.ts",
  "src/schemas/status.ts",
  "src/schemas/strictString.ts",
  "src/schemas/surface.ts",
  "src/schemas/testLine.ts",
];
const CLOSURE_FORBIDDEN_DIRS = ["src/app/", "src/ports/", "src/infra/", "src/cli/"];
// The bridge reads phax's own files; it is phax's, never published.
const CLOSURE_FORBIDDEN_FILES = [
  "src/schemas/vibeOutput.ts",
  "src/schemas/phaxConfig.ts",
  "src/schemas/persisted.ts",
];
const CLOSURE_FORBIDDEN_SPECIFIER =
  /^(node:.*|fs|fs\/.*|child_process|net|os|path|path\/.*|@effect\/platform.*)$/;
const CLOSURE_ALLOWED_BARE = /^effect(\/.*)?$/;

// Every module specifier in `import … from`, `export … from`, side-effect
// `import "…"` and dynamic `import("…")`.
const MODULE_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function moduleSpecifiers(content: string): string[] {
  return [...content.matchAll(MODULE_SPECIFIER)].map((match) => match[1] ?? "");
}

function schemasPackageClosure(): { files: string[]; bare: Map<string, string[]> } {
  const seen = new Set<string>();
  const bare = new Map<string, string[]>();
  const queue = [SCHEMAS_PACKAGE_ENTRY];
  while (queue.length > 0) {
    const rel = queue.shift() ?? "";
    if (seen.has(rel)) continue;
    seen.add(rel);
    const content = readFileSync(join(repoRoot, rel), "utf8");
    for (const specifier of moduleSpecifiers(content)) {
      if (specifier.startsWith(".")) {
        const target = resolve(repoRoot, dirname(rel), specifier.replace(/\.js$/, ".ts"));
        queue.push(relative(repoRoot, target).split("\\").join("/"));
      } else {
        bare.set(rel, [...(bare.get(rel) ?? []), specifier]);
      }
    }
  }
  return { files: [...seen].toSorted(), bare };
}

describe("architectural guard: schemas package closure", () => {
  const { files, bare } = schemasPackageClosure();

  it("reaches the entry and the phase record manifest's schema", () => {
    expect(files).toContain(SCHEMAS_PACKAGE_ENTRY);
    expect(files).toContain("src/schemas/runRecord.ts");
  });

  it("reaches only packages/schemas/src/, src/schemas/ and src/domain/", () => {
    const outside = files.filter(
      (rel) =>
        !CLOSURE_ALLOWED_DIRS.some((dir) => rel.startsWith(dir)) ||
        CLOSURE_FORBIDDEN_DIRS.some((dir) => rel.startsWith(dir)),
    );
    expect(outside).toEqual([]);
  });

  it("reaches exactly the allowlisted src/ modules", () => {
    expect(files.filter((rel) => rel.startsWith("src/"))).toEqual(CLOSURE_SRC_ALLOWLIST);
  });

  it("imports no Node or @effect/platform module and references no Deno global", () => {
    const violations: string[] = [];
    for (const rel of files) {
      for (const specifier of bare.get(rel) ?? []) {
        if (CLOSURE_FORBIDDEN_SPECIFIER.test(specifier))
          violations.push(`${rel}: imports ${specifier}`);
      }
      if (/\bDeno\b/.test(readFileSync(join(repoRoot, rel), "utf8"))) {
        violations.push(`${rel}: references Deno`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports no bare specifier other than effect and effect/*", () => {
    const violations = [...bare].flatMap(([rel, specifiers]) =>
      specifiers.filter((s) => !CLOSURE_ALLOWED_BARE.test(s)).map((s) => `${rel}: imports ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it("never reaches vibeOutput.ts, phaxConfig.ts or the persisted-file bridge", () => {
    expect(files.filter((rel) => CLOSURE_FORBIDDEN_FILES.includes(rel))).toEqual([]);
  });

  it("the specifier scanner sees static, re-export, side-effect and dynamic imports", () => {
    const source = [
      `import { a } from "./a.js";`,
      `import type {\n  B,\n} from "../b.js";`,
      `export { c } from "effect/Schema";`,
      `import "node:fs";`,
      `const d = await import("path");`,
    ].join("\n");
    expect(moduleSpecifiers(source)).toEqual([
      "./a.js",
      "../b.js",
      "effect/Schema",
      "node:fs",
      "path",
    ]);
  });
});

// §5.16: the dependency runs one way. The frozen modules live in phax under
// src/schemas/history/ and the schemas package re-exports them; phax never
// imports the package. Inside phax, only the persisted-file bridge reads a
// frozen module, and a frozen module reads nothing but effect, so it never
// follows a later edit to phax's shared schemas.
const HISTORY_DIR = "src/schemas/history/";
const PACKAGES_DIR = "packages/";
const PERSISTED_BRIDGE = "src/schemas/persisted.ts";
const SCHEMAS_PACKAGE_NAME = "@lbdremy/phax-schemas";

function srcModules(): Array<{ readonly rel: string; readonly content: string }> {
  return listTsFiles(srcRoot).map((file) => ({
    rel: relative(repoRoot, file).split("\\").join("/"),
    content: readFileSync(file, "utf8"),
  }));
}

/** The module specifiers in `content` (the module at `rel`) that resolve under `dir`. */
function importsUnder(dir: string, rel: string, content: string): string[] {
  return moduleSpecifiers(content).filter((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = relative(repoRoot, resolve(repoRoot, dirname(rel), specifier));
    return `${target.split("\\").join("/")}/`.startsWith(dir);
  });
}

/** Specifiers that reach `packages/`: a relative path under it, or the package by name. */
function packageImports(rel: string, content: string): string[] {
  const byName = moduleSpecifiers(content).filter(
    (specifier) =>
      specifier === SCHEMAS_PACKAGE_NAME || specifier.startsWith(`${SCHEMAS_PACKAGE_NAME}/`),
  );
  return [...importsUnder(PACKAGES_DIR, rel, content), ...byName];
}

describe("architectural guard: only the bridge imports a frozen module", () => {
  it(`no src/ module other than ${PERSISTED_BRIDGE} imports anything under ${HISTORY_DIR}`, () => {
    const violations = srcModules()
      .filter(({ rel }) => rel !== PERSISTED_BRIDGE)
      .flatMap(({ rel, content }) =>
        importsUnder(HISTORY_DIR, rel, content).map((s) => `${rel}: imports ${s}`),
      );
    expect(violations).toEqual([]);
  });

  it("the history scanner sees a relative import of a frozen module, and nothing else", () => {
    expect(
      importsUnder(
        HISTORY_DIR,
        "src/app/readRecords.ts",
        `import { decodeRegistryPreSchema } from "../schemas/history/registry/pre-schema.js";`,
      ),
    ).toHaveLength(1);
    expect(
      importsUnder(
        HISTORY_DIR,
        "src/schemas/registry.ts",
        `import { x } from "./history/phase-record-manifest/pre-schema.js";`,
      ),
    ).toHaveLength(1);
    expect(
      importsUnder(
        HISTORY_DIR,
        "src/app/readRecords.ts",
        `import { x } from "../schemas/runRecord.js";`,
      ),
    ).toEqual([]);
  });
});

describe("architectural guard: phax never imports packages/", () => {
  it("no src/ module has a module specifier that resolves under packages/", () => {
    const violations = srcModules().flatMap(({ rel, content }) =>
      packageImports(rel, content).map((s) => `${rel}: imports ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it("the packages scanner sees a relative import and the package name, and nothing else", () => {
    expect(
      packageImports(
        "src/app/readRecords.ts",
        `import { parseDocument } from "../../packages/schemas/src/index.js";`,
      ),
    ).toHaveLength(1);
    expect(
      packageImports(
        "src/app/readRecords.ts",
        `import { parseDocument } from "@lbdremy/phax-schemas";`,
      ),
    ).toHaveLength(1);
    expect(packageImports("src/app/readRecords.ts", `import { Schema } from "effect";`)).toEqual(
      [],
    );
    expect(
      packageImports("src/app/readRecords.ts", `import { x } from "../schemas/runRecord.js";`),
    ).toEqual([]);
  });
});

// Every persisted file phax reads goes through the bridge. Each format's file
// decoder may be named only by the bridge and by the src/schemas module that
// declares it; any other src/ module reads the file through a bridge reader.
const BRIDGE_ONLY_DECODERS: { readonly [F in FormatId]: ReadonlyArray<string> } = {
  registry: ["decodeRegistryFile"],
  "run-status": ["decodeRunStatusFile"],
  "phase-status": ["decodePhaseStatusFile"],
  "phax-plan": ["decodePhaxPlanFile"],
  "compliance-review": ["decodeComplianceReviewFile"],
  "plan-approvals": ["decodeApprovalRecordFile"],
  "spec-approvals": ["decodeSpecApprovalRecordFile"],
  "phase-record-manifest": ["decodeRunRecordManifestFile", "decodeRecordManifestFile"],
  "authoring-record-manifest": ["decodeAuthoringRecordManifestFile", "decodeRecordManifestFile"],
  "gate-attribution": ["decodeGateAttributionFile"],
  "phase-file-reconciliation": ["decodePhaseFileReconciliationFile"],
  "spec-document": ["decodeSpecDocumentFile"],
  "plan-document": ["decodePlanDocumentFile"],
  "plan-approval-record": ["decodePlanRecordFile"],
  "spec-approval-record": ["decodeSpecRecordFile"],
  "gate-request": ["decodeGateRequestFile"],
  "brief-request": ["decodeBriefRequestFile"],
  "brief-record": ["decodeBriefRecordFile"],
  "gate-report": ["decodeGateReportFile"],
  "brief-report": ["decodeBriefReportFile"],
  // Retired: its one shape is the frozen 0.25.0 module, which phax decodes nowhere.
  "hand-decision-answer": ["decodeHandDecisionAnswerV0_25_0"],
  "spec-hand-decision-answer": ["decodeSpecHandDecisionAnswerFile"],
  "plan-hand-decision-answer": ["decodePlanHandDecisionAnswerFile"],
  "decision-record-manifest": ["decodeDecisionRecordManifestFile", "decodeRecordManifestFile"],
  "review-record-manifest": ["decodeReviewRecordManifestFile", "decodeRecordManifestFile"],
  "cost-ledger": ["decodeCostLedgerFile"],
  "code-review": ["decodeCodeReviewFile"],
  "architecture-request": ["decodeArchitectureRequestFile"],
  // Retired: its one shape is the frozen 0.26.0 module, which phax decodes nowhere.
  "oracle-request": ["decodeOracleRequestV0_26_0"],
  "acceptance-request": ["decodeAcceptanceRequestFile"],
  "artifact-status": ["decodeArtifactStatusFile"],
  "plan-overview": ["decodePlanOverviewFile"],
  "plan-lint": ["decodePlanLintFile"],
  "first-reading": ["decodeFirstReadingFile"],
  "interactive-handoff": ["decodeInteractiveHandoffFile"],
  "interactive-session": ["decodeInteractiveSessionFile"],
  "review-stop": ["decodeReviewStopFile"],
  "run-list": ["decodeRunListFile"],
  "decide-verdicts": ["decodeDecideVerdictsFile"],
  "architecture-report": ["decodeArchitectureReportFile"],
  "phax-plan-extraction": ["decodePlanExtractionAnswer"],
};

/** Whether `content` names `name` as a whole word. */
function namesWord(content: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(content);
}

/** Whether `content` declares `name` as an exported binding. */
function declares(content: string, name: string): boolean {
  return new RegExp(`\\bexport\\s+const\\s+${name}(?![\\w$])`).test(content);
}

describe("architectural guard: only the bridge names a file decoder", () => {
  const decoders = [...new Set(Object.values(BRIDGE_ONLY_DECODERS).flat())];

  it("names at least one file decoder for every format", () => {
    for (const formatId of FORMAT_IDS) {
      expect(BRIDGE_ONLY_DECODERS[formatId].length, formatId).toBeGreaterThan(0);
    }
  });

  it("every file decoder is declared by exactly one src/schemas module, or a retired format's frozen one", () => {
    const modules = srcModules();
    for (const name of decoders) {
      const declaring = modules.filter(
        ({ rel, content }) =>
          /^src\/schemas\/(history\/[^/]+\/)?[^/]+\.ts$/.test(rel) && declares(content, name),
      );
      expect(
        declaring.map(({ rel }) => rel),
        name,
      ).toHaveLength(1);
    }
  });

  it(`no src/ module other than ${PERSISTED_BRIDGE} and the declaring module names one`, () => {
    const violations = srcModules()
      .filter(({ rel }) => rel !== PERSISTED_BRIDGE)
      .flatMap(({ rel, content }) =>
        decoders
          .filter((name) => namesWord(content, name) && !declares(content, name))
          .map((name) => `${rel}: names ${name}`),
      );
    expect(violations).toEqual([]);
  });

  it("the detector sees a whole-word reference and its declaration, and nothing else", () => {
    const use = `const decoded = decodeRegistryFile(raw);`;
    const declaration = `export const decodeRegistryFile = Schema.decodeUnknownEither(RegistryFileSchema);`;
    expect(namesWord(use, "decodeRegistryFile")).toBe(true);
    expect(declares(use, "decodeRegistryFile")).toBe(false);
    expect(namesWord(declaration, "decodeRegistryFile")).toBe(true);
    expect(declares(declaration, "decodeRegistryFile")).toBe(true);
    expect(namesWord(`decodeRunRecordManifestFile(x)`, "decodeRecordManifestFile")).toBe(false);
    expect(namesWord(`decodeRegistryFileX(x)`, "decodeRegistryFile")).toBe(false);
    expect(namesWord(`readRegistryFile(path, raw)`, "decodeRegistryFile")).toBe(false);
  });
});

describe("architectural guard: a frozen module imports only effect", () => {
  const frozen = srcModules().filter(({ rel }) => rel.startsWith(HISTORY_DIR));

  it("finds the frozen modules", () => {
    expect(frozen.length).toBeGreaterThan(0);
  });

  it("every module under src/schemas/history/ imports only effect or effect/*", () => {
    const violations = frozen.flatMap(({ rel, content }) =>
      moduleSpecifiers(content)
        .filter((specifier) => !CLOSURE_ALLOWED_BARE.test(specifier))
        .map((specifier) => `${rel}: imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
