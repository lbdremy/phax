import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { artifactFingerprint } from "../../src/app/approvalRecordStore.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { decodeArtifactStatusFile } from "../../src/schemas/artifactStatusDocument.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { decodeSpecDocumentFile } from "../../src/schemas/specDocument.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Acceptance test of spec command-contracts (ac-artifact-status), frozen until
// the phase that moves `phax artifact status` onto the command runner: every
// test carries `.fails`, because the command is still a Commander command with
// no `--json`. Each spawns `tsx src/cli/main.ts` in a temporary repository with
// a temporary HOME and git configuration, so no real ~/.phax, ~/.claude,
// ~/.codex, ~/.vibe or global git config is read.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const DRAFT_SPEC = "docs/specs/2611011200-garden-sync.md";
const DRAFT_SIDECAR = "docs/specs/2611011200-garden-sync.json";
const APPROVED_SPEC = "docs/specs/2611011201-orchard-care.md";
const APPROVED_RECORD = "docs/specs/approvals/2611011201-orchard-care.json";
const BASELINE = "0123456789abcdef0123456789abcdef01234567";

let base: string;
let repo: string;
let restoreGit: () => void;

function git(args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], { cwd: repo, encoding: "utf8", env: phaxHomeEnv() });
}

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}

/** The current sidecar of a headless spec with one open question, `q-cadence`. */
function draftSidecar(): string {
  const document = withSchemaUrl("spec-document", {
    kind: "spec",
    title: "Garden Sync",
    ground: [{ path: "docs/ideas/garden-sync.md", note: "the idea" }],
    context: "The garden syncs by hand today.",
    problem: "Nobody remembers to sync it.",
    productGoal: {
      statement: "Sync the garden on a schedule.",
      guidingRule: "A sync never loses a row.",
    },
    terminology: [{ term: "sync", definition: "copying the garden's rows to the store" }],
    requirements: [
      {
        id: "5.1",
        title: "Scheduled sync",
        pattern: "event",
        statement: "WHEN the schedule fires THE system SHALL sync the garden.",
      },
    ],
    surface: [
      {
        surface: "cli: `phax garden sync`",
        summary: "An operator can sync the garden from the command line.",
        binding: "normative",
        before: null,
        after: "phax garden sync",
      },
    ],
    nonGoals: ["syncing two gardens at once"],
    acceptanceCriteria: [
      {
        id: "ac-sync",
        name: "The garden syncs",
        given: "a garden with rows",
        when: "`phax garden sync` runs",
        // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
        then: "the store holds the rows",
        refs: ["5.1"],
      },
    ],
    openQuestions: [
      {
        id: "q-cadence",
        question: "How often does the garden sync?",
        options: [
          { id: "hourly", label: "Every hour", abandons: "A calmer store." },
          { id: "daily", label: "Once a day", abandons: "Fresh rows within the hour." },
        ],
        recommendation: "daily",
        rationale: "The rows change once a day.",
      },
    ],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}

function draftSpecMd(sidecar: string): string {
  const decoded = decodeSpecDocumentFile(JSON.parse(sidecar));
  if (Either.isLeft(decoded)) throw new Error("the fixture's sidecar must decode");
  return `---
status: Draft
date: 2026-11-01
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
${renderSpecBody(decoded.right)}`;
}

const APPROVED_MD = `---
status: Approved
date: 2026-11-01
audience: test
scope: test
approved:
  date: 2026-11-02
  baseline: "0123456"
---
# Orchard care

## Overview

Body text.
`;

beforeAll(() => {
  restoreGit = isolateGit();
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-artifact-status-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repo);
  write(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      state: { root: join(base, "state") },
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  const sidecar = draftSidecar();
  write(DRAFT_SIDECAR, sidecar);
  write(DRAFT_SPEC, draftSpecMd(sidecar));
  // An approved spec: its record holds the fingerprint of the text approved,
  // and the text is edited afterwards.
  write(
    APPROVED_RECORD,
    `${JSON.stringify(
      withSchemaUrl("spec-approval-record", {
        artifact: APPROVED_SPEC,
        specFingerprint: artifactFingerprint(APPROVED_MD),
        approvedAt: "2026-11-02T10:00:00.000Z",
        baseline: BASELINE,
        approvedBy: { kind: "operator", name: "Ada Example" },
      }),
      null,
      2,
    )}\n`,
  );
  write(APPROVED_SPEC, APPROVED_MD.replace("Body text.", "Body text, edited after the approval."));
});

afterAll(() => {
  restoreGit();
  removeTempDir(base);
});

function answer(path: string): Record<string, unknown> {
  const result = runCli(["artifact", "status", path, "--json"]);
  expect(result.status, result.stderr).toBe(0);
  const parsed: unknown = JSON.parse(result.stdout);
  const decoded = decodeArtifactStatusFile(parsed);
  expect(Either.isRight(decoded), JSON.stringify(parsed)).toBe(true);
  return parsed as Record<string, unknown>;
}

describe("phax artifact status --json", () => {
  it("answers a Draft headless spec's open question and its sidecar in sync", () => {
    const document = answer(DRAFT_SPEC);

    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document["$schema"]).toBe(schemaUrl("artifact-status", "0.34.0"));
    expect(document).toMatchObject({
      path: DRAFT_SPEC,
      kind: "spec",
      status: "Draft",
      legalTransitions: ["Approved", "Abandoned"],
      approval: { kind: "none" },
      authoring: { kind: "headless", sidecar: DRAFT_SIDECAR, agreement: "in-sync" },
      questions: { kind: "parsed", open: ["q-cadence"], arbitrated: [], lifted: [] },
    });
  });

  it("answers an Approved spec edited since its approval with the approval's facts", () => {
    const document = answer(APPROVED_SPEC);

    expect(document).toMatchObject({
      path: APPROVED_SPEC,
      kind: "spec",
      status: "Approved",
      approval: {
        kind: "recorded",
        date: "2026-11-02",
        baseline: "0123456",
        approver: { kind: "operator", name: "Ada Example" },
        editedSinceApproval: true,
      },
      authoring: { kind: "interactive" },
    });
  });

  it("prints its own contract with --json-schema, naming artifact status", () => {
    const result = runCli(["artifact", "status", "--json-schema"]);

    expect(result.status, result.stderr).toBe(0);
    const entry = JSON.parse(result.stdout) as { name: string[]; output: unknown };
    expect(entry.name).toEqual(["artifact", "status"]);
    expect(entry.output).toEqual({ $ref: schemaUrl("artifact-status", "0.34.0") });
  });
});
