import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { renderPlanBodyV0_38_0 } from "../../src/domain/authoring/renderPlanV0_38_0.js";
import {
  currentSchemaUrl,
  readDocumentSidecar,
  readPlanDocumentFile,
  type PlanDocumentV0_38_0Value,
} from "../../src/schemas/persisted.js";
import { decodePlanDocumentV0_38_0 } from "../../src/schemas/history/plan-document/0.38.0.js";
import type { PlanDocument } from "../../src/schemas/planDocument.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { validDocuments, withKey, withoutGateProfile } from "../unit/schemasPackage/documents.js";

// `phax artifact migrate-documents --gate-profile <id>` (q-older-sidecar,
// migrate-flag) in a real repository: a plan sidecar stamped 0.38.0 declares no
// gate profile, is refused without the flag, naming it, and with it is rewritten
// at the current stamp, its body gaining the `## Gate profile` section; an id
// phax.json does not define is refused with exit 2 before anything is written.
// Every plan and operator here is made up.

const PLAN = "docs/plans/2611250900-widget-export-plan.md";
const SIDECAR = "docs/plans/2611250900-widget-export-plan.json";
const FRONTMATTER = "---\nstatus: Draft\nsource-spec: null\n---\n";
const SECTION = "## Gate profile\n\n`standard`\n\n## Required commands";

let repoDir: string;
let configDir: string;
let originalCwd: string;

function git(args: readonly string[]): string {
  return boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd: repoDir });
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(rel: string): string {
  return readFileSync(join(repoDir, rel), "utf8");
}

function commitAll(message = "seed"): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

/** The plan document as phax 0.38.0 to 0.42.x wrote it: no gate profile. */
function plan0_38_0(): PlanDocumentV0_38_0Value {
  const decoded = decodePlanDocumentV0_38_0(
    withKey(
      withoutGateProfile(validDocuments["plan-document"]),
      "$schema",
      schemaUrl("plan-document", "0.38.0"),
    ),
  );
  if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
  const { $schema: _schema, ...document } = decoded.success;
  return document;
}

/** A Draft headless plan stamped 0.38.0, its body the 0.38.0 rendering. */
function writePlan0_38_0(): { readonly md: string; readonly sidecar: string } {
  const document = plan0_38_0();
  const md = FRONTMATTER + renderPlanBodyV0_38_0(document);
  const sidecar = `${JSON.stringify({ $schema: schemaUrl("plan-document", "0.38.0"), ...document }, null, 2)}\n`;
  writeRepoFile(PLAN, md);
  writeRepoFile(SIDECAR, sidecar);
  commitAll("a plan stamped 0.38.0");
  return { md, sidecar };
}

async function migrate(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  process.chdir(repoDir);
  try {
    const { code, out, err } = await phaxCall(["artifact", "migrate-documents", ...args]);
    return { code, out, err };
  } finally {
    process.chdir(originalCwd);
  }
}

beforeEach(() => {
  originalCwd = process.cwd();
  configDir = mkdtempSync(join(tmpdir(), "phax-migrate-gate-profile-config-"));
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("HOME", configDir);
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-migrate-gate-profile-")));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", "Ada Lovelace"]);
  git(["config", "--local", "user.email", "ada@example.test"]);
  writeRepoFile(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "test",
      gateProfiles: { standard: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  commitAll("init");
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("phax artifact migrate-documents --gate-profile", { timeout: 30_000 }, () => {
  it("reads a sidecar stamped 0.38.0 with a missing-gate-profile lift", () => {
    const { sidecar } = writePlan0_38_0();
    const read = readDocumentSidecar("plan", SIDECAR, JSON.parse(sidecar));
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("0.38.0");
    expect(read.success.shape !== "current" && read.success.lift.kind).toBe("missing-gate-profile");
  });

  it("refuses the 0.38.0 plan without the flag, naming it, and writes nothing", async () => {
    const { md, sidecar } = writePlan0_38_0();
    const head = headSha();

    const refused = await migrate();

    expect(refused.code).toBe(12);
    expect(refused.err).toContain(
      `migrate refused: ${PLAN} declares no gate profile (run.gateProfile)\n` +
        "  Rerun with --gate-profile <id>, naming one of phax.json's gate profiles; an Approved plan then needs approving again.",
    );
    expect(readRepoFile(PLAN)).toBe(md);
    expect(readRepoFile(SIDECAR)).toBe(sidecar);
    expect(headSha()).toBe(head);
  });

  it("rewrites it with --gate-profile standard at the current stamp, rendering the section into the body", async () => {
    const { md } = writePlan0_38_0();

    const done = await migrate("--gate-profile", "standard");

    expect(done.code).toBe(0);
    const written: unknown = JSON.parse(readRepoFile(SIDECAR));
    expect(written).toMatchObject({
      $schema: currentSchemaUrl("plan-document"),
      run: { ...plan0_38_0().run, gateProfile: "standard" },
    });
    const read = readPlanDocumentFile(SIDECAR, written);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    const document: PlanDocument = read.success;
    expect(document.run.gateProfile).toBe("standard");
    const body = readRepoFile(PLAN);
    expect(body).toBe(FRONTMATTER + renderPlanBody(document));
    expect(body).toBe(md.replace("## Required commands", SECTION));
    expect(git(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").toSorted()).toEqual(
      [PLAN, SIDECAR].toSorted(),
    );
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });

  it("refuses an id phax.json does not define with exit 2, writing nothing", async () => {
    const { md, sidecar } = writePlan0_38_0();
    const head = headSha();

    const refused = await migrate("--gate-profile", "light");

    expect(refused.code).toBe(2);
    expect(refused.err).toContain(
      'gate profile "light" is not defined in phax.json (defined: standard)',
    );
    expect(readRepoFile(PLAN)).toBe(md);
    expect(readRepoFile(SIDECAR)).toBe(sidecar);
    expect(headSha()).toBe(head);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
  });
});
