import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DecideArtifactInput, decideArtifact } from "../../src/app/decideArtifact.js";
import { exitCodeForAuthoringError } from "../../src/cli/commands/runLayers.js";
import { parseHandAuthoredQuestions } from "../../src/domain/artifact/questions.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Real-git acceptance for decide on a hand-authored artifact (spec
// artifact-decide §8 'Hand-authored artifact decided in place', §5.5, §5.6,
// §5.28): the decisions are written in place and the file alone is
// committed. Approval refusing Q2 afterwards is the approval lock's, a later
// phase's. Every spec, plan and operator is made up.

const OPERATOR = "Grace Hopper";
const NOW = "2026-10-16T10:30:00.000Z";
const SPEC = "docs/specs/2610161030-log-retention.md";
const BOLD_SPEC = "docs/specs/2610161031-log-format.md";
const PLAN = "docs/plans/2610161032-log-retention-plan.md";

const SKILL = "- `S1` Adopt the recommendation.\n- `C4` Prefer the reversible option.\n";
const PLAN_SKILL = "- `P1` Split by shippable surface.\n";

const SECURITY: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const HAND_SPEC = [
  "---",
  "status: Draft",
  "date: 2026-10-16",
  "audience: maintainers",
  "scope: logs",
  "---",
  "# Log retention",
  "",
  "## 1. Context",
  "",
  "Every run writes one log.",
  "",
  "## 5. Requirements",
  "",
  "- 5.1 WHEN a run ends THE system SHALL keep its log.",
  "",
  "## 9. Open questions",
  "",
  "### Q1 — Logs: kept per run, or rotated daily?",
  "",
  "- per-run — Kept per run — abandons: a bounded log directory",
  "- daily — Rotated daily — abandons: one log per run",
  "",
  "Recommendation: per-run — a report names its run",
  "",
  "### Q2 — Retention: a week or a month?",
  "",
  "- keep-7 — A week — abandons: a release cycle of logs",
  "- keep-30 — A month — abandons: disk space",
  "",
  "Recommendation: keep-30 — a month covers a release",
  "",
  "## 10. Implementation-planning note",
  "",
  "Settled: none.",
  "",
].join("\n");

const BOLD = [
  "---",
  "status: Draft",
  "date: 2026-10-16",
  "audience: maintainers",
  "scope: logs",
  "---",
  "# Log format",
  "",
  "## 9. Open questions",
  "",
  "**Q1 — Text or JSON lines?**",
  "",
  "Recommendation: text.",
  "",
].join("\n");

const HAND_PLAN = [
  "---",
  "status: Draft",
  "source-spec: null",
  "---",
  "# Rotate logs",
  "",
  "Rotate the logs of every run.",
  "",
  "## Required commands",
  "",
  "- (none)",
  "",
  "## Open questions",
  "",
  "### q-scope — Rotate per project or globally?",
  "",
  "- local — Per project — abandons: one shared setting",
  "- global — Globally — abandons: per-project limits",
  "",
  "Recommendation: local — projects differ",
  "",
  "---",
  "",
  "## phase-01 — Rotate {#phase-01-rotate}",
  "",
  "Rotate the logs.",
  "",
  "---",
  "",
  "## phase-02 — Document {#phase-02-docs}",
  "",
  "Document the rotation.",
  "",
].join("\n");

let repoDir: string;
let configDir: string;
let stateRoot: string;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoDir, stdio: "pipe" }).toString();
}

function writeRepoFile(rel: string, content: string): void {
  const abs = join(repoDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRepoFile(rel: string): string {
  return readFileSync(join(repoDir, rel), "utf8");
}

function commitAll(): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

function decidedVerdict(chosen: string, abandoned: string[], extra: Record<string, unknown> = {}) {
  return {
    kind: "decided",
    chosen,
    abandoned,
    why: "a day's logs are what an operator reads",
    advocate: "per-run logs name their run",
    principles: ["C4"],
    reversibility: "cheap",
    by: { kind: "operator", name: "Someone Else" },
    at: "2026-01-01T00:00:00Z",
    revised: [] as string[],
    ...extra,
  };
}

function harness(answers: readonly string[]) {
  const backend = makeFakeBackend();
  for (const finalText of answers) {
    backend.impl.addResumeResponse({
      sessionId: "sess-hand" as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  const session = makeFakeSession();
  const lines: string[] = [];
  const layer = Layer.mergeAll(
    makeRootedNodeFileSystemLayer(repoDir),
    NodeGitLayer,
    backend.layer,
    session.layer,
    makeFakePrompt([true]).layer,
    makeFakeTerminal(true).layer,
    makeFakeGitHub().layer,
  );
  const run = (overrides: Partial<DecideArtifactInput> = {}) =>
    Effect.runPromise(
      Effect.either(
        decideArtifact({
          path: SPEC,
          question: null,
          doctrinePath: null,
          model: undefined,
          effort: undefined,
          bundledSkills: { spec: SKILL, plan: PLAN_SKILL },
          security: SECURITY,
          repoRoot: repoDir,
          stateRoot,
          extractPlanModel: "claude-haiku-5-5",
          extractPlanEffort: "low",
          nowIso: NOW,
          records: {
            enabled: false,
            transcript: false,
            destination: { kind: "in-repo" },
            autoPush: false,
          },
          publishRemote: "origin",
          output: { log: (l) => lines.push(l), warn: () => {} },
          ...overrides,
        }).pipe(Effect.provide(layer)),
      ),
    );
  return { backend: backend.impl, session: session.impl, lines, run };
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-decide-hand-config-"));
  stateRoot = join(realpathSync(configDir), "state");
  writeFileSync(join(configDir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(configDir, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_COMMITTER_NAME", OPERATOR);
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-decide-hand-")));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.name", OPERATOR]);
  git(["config", "--local", "user.email", "grace@example.test"]);
  writeRepoFile(".gitignore", ".phax-context/\n");
  commitAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("decide — a hand-authored artifact decided in place", { timeout: 30_000 }, () => {
  it("moves Q1 with its Decision block, applies the body edit, logs it, and commits the file alone", async () => {
    writeRepoFile(SPEC, HAND_SPEC);
    commitAll();
    const revisedMd = HAND_SPEC.replace(
      "Every run writes one log.",
      "Every run writes one log, rotated daily.",
    );
    const answer = JSON.stringify({
      $schema: currentSchemaUrl("hand-decision-answer"),
      kind: "spec",
      decisions: [
        {
          id: "Q1",
          verdict: decidedVerdict("daily", ["per-run"], { revised: ["§1 Context"] }),
        },
      ],
      markdown: revisedMd,
    });
    const h = harness([answer]);

    const result = await h.run();

    expect(Either.getOrThrow(result)).toMatchObject({
      kind: "committed",
      paths: [SPEC],
      decided: ["Q1"],
    });
    const md = readRepoFile(SPEC);
    expect(md).toContain("Every run writes one log, rotated daily.");
    const parsed = parseHandAuthoredQuestions("spec", md);
    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.open.map((q) => q.id)).toEqual(["Q2"]);
    expect(parsed.arbitrated.map((q) => [q.id, q.chosen, q.lifted])).toEqual([
      ["Q1", "daily", false],
    ]);
    const arbitratedAt = md.indexOf("## 9b. Arbitrated questions");
    expect(arbitratedAt).toBeGreaterThan(md.indexOf("## 9. Open questions"));
    expect(md.indexOf("### Q1 —")).toBeGreaterThan(arbitratedAt);
    expect(md.slice(md.indexOf("### Q1 —"))).toMatch(/Decision: daily[^\n]*Grace Hopper/);
    const log = md.slice(md.indexOf("## 12. Decision log"));
    expect(log.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    // Every line of the original is still there but Q1's moved block and the
    // edited context line.
    const kept = new Set(md.split("\n"));
    for (const line of HAND_SPEC.split("\n")) {
      if (line === "Every run writes one log.") continue;
      expect(kept.has(line), line).toBe(true);
    }

    expect(git(["show", "--name-only", "--format=", "HEAD"]).trim()).toBe(SPEC);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
    expect(h.session.invocations).toHaveLength(1);
    expect(h.backend.resumeCalls[0]?.prompt).toContain(currentSchemaUrl("hand-decision-answer"));
  });

  it("refuses a spec whose questions use bold headings, naming the line, with no session", async () => {
    writeRepoFile(BOLD_SPEC, BOLD);
    commitAll();
    const head = headSha();
    const h = harness([]);

    const result = await h.run({ path: BOLD_SPEC });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "hand-format" });
      expect(exitCodeForAuthoringError(result.left)).toBe(12);
      expect(result.left.message).toContain(`${BOLD_SPEC} line 11 departs from the §9 format`);
      expect(result.left.message).toContain("**Q1 — Text or JSON lines?**");
    }
    expect(h.session.invocations).toEqual([]);
    expect(headSha()).toBe(head);
  });

  it("decides a hand-authored plan's question with its phase, before the first phase", async () => {
    writeRepoFile(PLAN, HAND_PLAN);
    commitAll();
    const answer = JSON.stringify({
      $schema: currentSchemaUrl("hand-decision-answer"),
      kind: "plan",
      decisions: [
        {
          id: "q-scope",
          verdict: decidedVerdict("local", ["global"], { principles: ["P1"], phase: "phase-01" }),
        },
      ],
      markdown: HAND_PLAN,
    });
    const h = harness([answer]);

    const result = await h.run({ path: PLAN });

    expect(Either.getOrThrow(result)).toMatchObject({ kind: "committed", paths: [PLAN] });
    const md = readRepoFile(PLAN);
    expect(md.indexOf("## Arbitrated questions")).toBeLessThan(md.indexOf("## phase-01"));
    expect(md.indexOf("## Decision log")).toBeLessThan(md.indexOf("## phase-01"));
    expect(md).toContain("Phase: phase-01.");
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe(
      "docs(plans): decide log-retention q-scope",
    );
  });

  it("refuses an answer that edits the question sections phax writes", async () => {
    writeRepoFile(SPEC, HAND_SPEC);
    commitAll();
    const head = headSha();
    const bad = JSON.stringify({
      $schema: currentSchemaUrl("hand-decision-answer"),
      kind: "spec",
      decisions: [{ id: "Q1", verdict: decidedVerdict("daily", ["per-run"], { revised: ["§9"] }) }],
      markdown: HAND_SPEC.replace("Recommendation: keep-30", "Recommendation: keep-7"),
    });
    const h = harness([bad, bad]);

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(exitCodeForAuthoringError(result.left)).toBe(5);
      expect(result.left.message).toContain("retry: markdown: the open questions section differs");
    }
    expect(headSha()).toBe(head);
    expect(readRepoFile(SPEC)).toBe(HAND_SPEC);
  });
});
