import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const srcRoot = join(repoRoot, "src");

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

function listSnapshotFiles(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true }) as Array<{
    parentPath?: string;
    path?: string;
    name: string;
    isFile: () => boolean;
  }>;
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".snap")) continue;
    const parent = entry.parentPath ?? entry.path ?? root;
    out.push(join(parent, entry.name));
  }
  return out;
}

// Match actual import statements, not string literals in comments or messages.
const OTEL_IMPORT_STMT = /from\s+['"]@opentelemetry\//;
const INFRA_TELEMETRY_IMPORT_STMT = /from\s+['"][^'"]*\/infra\/telemetry\//;
const INFRA_TELEMETRY_OTEL_IMPORT_STMT =
  /from\s+['"][^'"]*\/infra\/telemetry\/openTelemetry(\.js)?['"]/;
const SYSTEM_TELEMETRY_PORT_IMPORT_STMT = /from\s+['"][^'"]*\/ports\/systemTelemetry(\.js)?['"]/;

describe("PHAX_TELEMETRY_001 — domain isolation", () => {
  it("no file under src/domain/ imports SystemTelemetry port, infra/telemetry, or @opentelemetry/*", () => {
    const domainRoot = join(srcRoot, "domain");
    const violations: string[] = [];

    for (const absPath of listTsFiles(domainRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      if (OTEL_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports @opentelemetry/* (PHAX_TELEMETRY_001) — see .claude/skills/observability/SKILL.md`,
        );
      }
      if (INFRA_TELEMETRY_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports infra/telemetry (PHAX_TELEMETRY_001) — see .claude/skills/observability/SKILL.md`,
        );
      }
      if (SYSTEM_TELEMETRY_PORT_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports SystemTelemetry port (PHAX_TELEMETRY_001) — see .claude/skills/observability/SKILL.md`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("PHAX_TELEMETRY_002 — OTel confinement", () => {
  // Only these two files are permitted to import @opentelemetry/*:
  // - the single OTel adapter: src/infra/telemetry/openTelemetry.ts
  // - its unit test: tests/unit/telemetry/openTelemetry.test.ts
  const OTEL_ALLOWLIST: ReadonlySet<string> = new Set([
    "src/infra/telemetry/openTelemetry.ts",
    "tests/unit/telemetry/openTelemetry.test.ts",
  ]);

  it("only src/infra/telemetry/openTelemetry.ts and its unit test may import @opentelemetry/*", () => {
    const testsRoot = join(repoRoot, "tests");
    const violations: string[] = [];

    const allFiles = [...listTsFiles(srcRoot), ...listTsFiles(testsRoot)];
    for (const absPath of allFiles) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      if (OTEL_ALLOWLIST.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");
      if (OTEL_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports @opentelemetry/* but is not in the allowlist (PHAX_TELEMETRY_002) — see .claude/skills/observability/SKILL.md`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("the allowed files actually still import @opentelemetry/* (allowlist stays honest)", () => {
    for (const rel of OTEL_ALLOWLIST) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      expect(
        OTEL_IMPORT_STMT.test(content),
        `${rel} no longer imports @opentelemetry/* — remove it from OTEL_ALLOWLIST`,
      ).toBe(true);
    }
  });
});

describe("PHAX_TELEMETRY_003 — application layer port-only access", () => {
  // src/app/ must not import any infra/telemetry/* module.
  // src/cli/ must not import the OTel adapter directly (infra/telemetry/openTelemetry.ts);
  // importing the factory (infra/telemetry/layer.ts) is permitted at the composition root.
  it("src/app/ must not import @opentelemetry/* or any infra/telemetry/* directly", () => {
    const appRoot = join(srcRoot, "app");
    const violations: string[] = [];

    for (const absPath of listTsFiles(appRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      if (OTEL_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports @opentelemetry/* (PHAX_TELEMETRY_003) — use SystemTelemetry port — see .claude/skills/observability/SKILL.md`,
        );
      }
      if (INFRA_TELEMETRY_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports infra/telemetry directly (PHAX_TELEMETRY_003) — use SystemTelemetry port — see .claude/skills/observability/SKILL.md`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("src/cli/ must not import @opentelemetry/* or the OTel adapter directly", () => {
    const cliRoot = join(srcRoot, "cli");
    const violations: string[] = [];

    for (const absPath of listTsFiles(cliRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      if (OTEL_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports @opentelemetry/* (PHAX_TELEMETRY_003) — CLI must not bypass the telemetry factory — see .claude/skills/observability/SKILL.md`,
        );
      }
      if (INFRA_TELEMETRY_OTEL_IMPORT_STMT.test(content)) {
        violations.push(
          `${rel}: imports infra/telemetry/openTelemetry directly (PHAX_TELEMETRY_003) — always go through makeSystemTelemetryLayer — see .claude/skills/observability/SKILL.md`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("PHAX_TELEMETRY_004 — snapshot projection purity", () => {
  const UNSTABLE_FIELDS = ["traceId", "spanId", "durationMs"];
  const UNIX_TIMESTAMP_RE = /\b\d{13,}\b/;

  it("no snapshot file contains OTel transport fields or raw Unix timestamps", () => {
    const testsRoot = join(repoRoot, "tests");
    const violations: string[] = [];

    for (const absPath of listSnapshotFiles(testsRoot)) {
      const rel = relative(repoRoot, absPath).split("\\").join("/");
      const content = readFileSync(absPath, "utf8");

      for (const field of UNSTABLE_FIELDS) {
        if (content.includes(field)) {
          violations.push(
            `${rel}: snapshot contains unstable field "${field}" (PHAX_TELEMETRY_004) — snapshots must project only semantic fields — see .claude/skills/observability/SKILL.md`,
          );
        }
      }

      if (UNIX_TIMESTAMP_RE.test(content)) {
        violations.push(
          `${rel}: snapshot contains a 13+ digit number (likely a Unix ms timestamp) (PHAX_TELEMETRY_004) — snapshots must project only semantic fields — see .claude/skills/observability/SKILL.md`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
