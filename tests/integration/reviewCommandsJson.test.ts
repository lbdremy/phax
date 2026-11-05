import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReviewHandoffCommand } from "../../src/cli/definitions/review.js";
import {
  makeReviewCodeCommand,
  makeReviewComplianceCommand,
} from "../../src/cli/definitions/review.js";
import { makePublishPrCommand } from "../../src/cli/definitions/publishPr.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaxPlanJson } from "../helpers/costHistory.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { reconciliationResult } from "../helpers/reconciliationFixture.js";
import { runnerCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// review-handoff, review-compliance, review-code and publish-pr through the command runner, over
// their definition factories with the fake backend, git, GitHub and session, in a temporary
// repository with its own identity and a temporary PHAX home. No real agent, `gh` or terminal.
//   ac-json-every-command, ac-written, ac-error-sentence and ac-no-person.

const SHORT_NAME = "cmd-test-run";
const RUN_ID = "cmd-test-run-1234";
const NOW = "2024-01-01T00:00:00.000Z";
const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PR_URL = "https://github.com/owner/repo/pull/7";

interface WrittenFile {
  readonly path: string;
  readonly format: string | null;
  readonly digest: string;
}

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const messageKinds = (lines: ReadonlyArray<string>): string[] =>
  lines.map((line) => (JSON.parse(line) as { kind: string }).kind);

describe("review and publication commands", () => {
  let repoRoot: string;
  let stateRoot: string;
  let runPath: string;
  let worktreePath: string;
  let origCwd: string;
  let home: ReturnType<typeof isolatePhaxHome>;
  let restoreGit: () => void;

  beforeEach(() => {
    home = isolatePhaxHome();
    restoreGit = isolateGit();
    repoRoot = mkdtempSync(join(tmpdir(), "phax-review-json-"));
    stateRoot = join(repoRoot, ".phax-state");
    runPath = join(stateRoot, "runs", `test.${SHORT_NAME}`);
    worktreePath = join(stateRoot, "worktrees", SHORT_NAME, "phase-01");
    execSync("git init -q", { cwd: repoRoot });
    execSync('git config user.name "Review Test"', { cwd: repoRoot });
    execSync("git config user.email review-test@example.com", { cwd: repoRoot });
    writeFileSync(
      join(repoRoot, "phax.json"),
      JSON.stringify({
        version: 1,
        name: "test",
        state: { root: stateRoot },
        review: { compliance: { enabled: true } },
        gateProfiles: {
          fast: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "log" }],
        },
      }),
    );
    origCwd = process.cwd();
    process.chdir(repoRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    removeTempDir(repoRoot);
    restoreGit();
    home.restore();
  });

  /** A run on disk in `state`, with the artifacts the three review commands read. */
  function seedRun(state: string): void {
    const phaseDir = join(runPath, "phase-01");
    mkdirSync(phaseDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        namespace: "test",
        shortName: SHORT_NAME,
        runId: RUN_ID,
        state,
        createdAt: NOW,
        updatedAt: NOW,
        phasesCount: 1,
        gateProfileId: "fast",
      }),
    );
    writeFileSync(
      join(phaseDir, "status.json"),
      JSON.stringify(
        phaseStatusFile({
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "committed",
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `feature/${SHORT_NAME}--phase-01`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: NOW,
          updatedAt: NOW,
          worktreePath,
          claudeSessionId: "sess-abc",
        }),
      ),
    );
    writeFileSync(
      join(phaseDir, "file-reconciliation.json"),
      JSON.stringify(
        encodePhaseFileReconciliation({ phaseId: "phase-01", ...reconciliationResult() }),
      ),
    );
    writeFileSync(join(phaseDir, "file-reconciliation.md"), "## PHAX File Reconciliation\n");
    writeFileSync(
      join(phaseDir, "phase-handoff.md"),
      [
        "## What was delivered",
        "Done.",
        "## Key decisions and why",
        "N/A",
        "## Exact locations (file paths and exported names)",
        "N/A",
        "## What the next phase needs to know",
        "Nothing.",
      ].join("\n"),
    );
    writeFileSync(join(runPath, "global-file-reconciliation.md"), "# Reconciliation\n");
    writeFileSync(join(runPath, "plan.md"), "# Plan\n");
    writeFileSync(join(runPath, "phax-plan.json"), phaxPlanJson([{ id: "phase-01" }]));
  }

  const complianceAnswer = JSON.stringify({
    $schema: schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]),
    verdict: "conformant",
    summary: "All as planned.",
    perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [] }],
    unplannedChanges: [],
    unmetPromises: [],
    attentionPoints: [],
    pointers: [],
  });

  const codeAnswer = JSON.stringify({
    $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]),
    findings: [
      {
        severity: "bug",
        file: "src/a.ts",
        line: 12,
        message: "The flag is ignored.",
        lens: "surface",
        escape: "wrong-oracle",
        criterion: "ac-1",
        suggestion: "Read the flag.",
      },
    ],
  });

  function fakes() {
    const backend = makeFakeBackend();
    const git = makeFakeGit();
    const github = makeFakeGitHub();
    const session = makeFakeSession();
    github.impl.createdPrUrl = PR_URL;
    return { backend, git, github, session };
  }

  describe("review-handoff", () => {
    it("answers one indented JSON value whose written files are read back from the disk", async () => {
      seedRun("review_open");

      const result = await runnerCall(
        [makeReviewHandoffCommand()],
        ["review-handoff", SHORT_NAME, "--json"],
      );

      expect(result.code).toBe(0);
      const value = JSON.parse(result.out) as {
        qualifiedName: string;
        crossProject: boolean;
        reviewHandoff: string;
        written: WrittenFile[];
      };
      expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(value.qualifiedName).toBe(`test.${SHORT_NAME}`);
      expect(value.crossProject).toBe(false);
      expect(value.reviewHandoff).toBe(`${runPath}/review-handoff.md`);
      const paths = value.written.map((file) => file.path);
      expect(paths).toContain(join(runPath, "review-handoff.md"));
      expect(paths).toContain(join(runPath, "global-file-reconciliation.md"));
      expect(paths).toContain(join(runPath, "global-file-reconciliation.json"));
      for (const file of value.written) {
        expect(file.path.startsWith("/")).toBe(true);
        expect(file.digest).toMatch(DIGEST);
        expect(file.digest).toBe(sha256(readFileSync(file.path)));
      }
      for (const kind of messageKinds(result.errLines)) expect(MESSAGE_KINDS).toContain(kind);
    });

    it("prints today's text without --json", async () => {
      seedRun("review_open");

      const result = await runnerCall([makeReviewHandoffCommand()], ["review-handoff", SHORT_NAME]);

      expect(result.code).toBe(0);
      expect(result.out).toBe(
        `Review handoff regenerated for run "test.${SHORT_NAME}". See ${runPath}/review-handoff.md\n`,
      );
      expect(result.err).toBe("");
    });
  });

  describe("review-compliance", () => {
    it("answers one value, with only message lines on stderr", async () => {
      seedRun("review_open");
      const t = fakes();
      t.backend.impl.addRunResponse({
        sessionId: "session-c" as ClaudeSessionId,
        outputPath: join(runPath, "compliance-review.session.jsonl"),
        finalText: complianceAnswer,
      });

      const result = await runnerCall(
        [
          makeReviewComplianceCommand({
            backendLayer: t.backend.layer,
            gitLayer: t.git.layer,
            githubLayer: t.github.layer,
          }),
        ],
        ["review-compliance", SHORT_NAME, "--json"],
      );

      expect(result.code).toBe(0);
      const value = JSON.parse(result.out) as {
        verdict: string;
        review: string;
        notice: string | null;
        warnings: string[];
        written: WrittenFile[];
      };
      expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(value.verdict).toBe("conformant");
      expect(value.review).toBe(join(runPath, "compliance-review.md"));
      expect(value.written.map((file) => file.path)).toEqual([
        join(runPath, "compliance-review.md"),
        join(runPath, "compliance-review.json"),
      ]);
      for (const file of value.written) expect(file.digest).toBe(sha256(readFileSync(file.path)));
      for (const kind of messageKinds(result.errLines)) expect(MESSAGE_KINDS).toContain(kind);
    });
  });

  describe("review-code", () => {
    it("--headless answers one value and lists the files it wrote", async () => {
      seedRun("review_open");
      const t = fakes();
      t.backend.impl.addRunResponse({
        sessionId: "session-r" as ClaudeSessionId,
        outputPath: join(runPath, "code-review.session.jsonl"),
        finalText: codeAnswer,
      });

      const result = await runnerCall(
        [
          makeReviewCodeCommand({
            backendLayer: t.backend.layer,
            gitLayer: t.git.layer,
            githubLayer: t.github.layer,
            sessionLayer: t.session.layer,
          }),
        ],
        ["review-code", SHORT_NAME, "--headless", "--json"],
      );

      expect(result.code).toBe(0);
      const value = JSON.parse(result.out) as {
        kind: string;
        findings: { count: number; summary: string };
        findingsPath: string;
        written: WrittenFile[];
      };
      expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(value.kind).toBe("headless");
      expect(value.findings.count).toBe(1);
      expect(value.findingsPath).toBe(join(runPath, "code-review.json"));
      expect(value.written.map((file) => file.path)).toEqual([
        join(runPath, "code-review.json"),
        join(runPath, "code-review-session.json"),
      ]);
      for (const file of value.written) expect(file.digest).toBe(sha256(readFileSync(file.path)));
      for (const kind of messageKinds(result.errLines)) expect(MESSAGE_KINDS).toContain(kind);
      expect(t.session.impl.invocations).toEqual([]);
    });

    it("--json without --headless is refused with 64 before any session starts", async () => {
      seedRun("review_open");
      const t = fakes();

      const result = await runnerCall(
        [
          makeReviewCodeCommand({
            backendLayer: t.backend.layer,
            gitLayer: t.git.layer,
            githubLayer: t.github.layer,
            sessionLayer: t.session.layer,
          }),
        ],
        ["review-code", SHORT_NAME, "--json"],
      );

      expect(result.code).toBe(64);
      expect(result.out).toBe("");
      expect(result.errLines).toHaveLength(1);
      const refused = JSON.parse(result.errLines[0]!) as { kind: string; text: string };
      expect(refused.kind).toBe("refused");
      expect(refused.text).toContain("--headless");
      expect(t.session.impl.invocations).toEqual([]);
      expect(t.backend.impl.runCalls).toEqual([]);
    });

    it("hands the terminal to the session and exits with its code, without --json", async () => {
      seedRun("review_open");
      writeFileSync(
        join(runPath, "phase-01", "agent-binding.json"),
        JSON.stringify({
          version: 1,
          shortName: SHORT_NAME,
          runId: RUN_ID,
          phaseId: "phase-01",
          phaseIndex: 0,
          phaseName: "Test Phase",
          provider: "claude-code",
          adapter: "claude",
          model: "claude-sonnet-4-6",
          effort: "medium",
          sessionId: "existing-session-111",
          sessionHandle: null,
          worktreePath,
          cwd: worktreePath,
          launchedAt: NOW,
          status: "completed",
        }),
      );
      const t = fakes();
      t.session.impl.exitCode = 3;

      const result = await runnerCall(
        [makeReviewCodeCommand({ sessionLayer: t.session.layer })],
        ["review-code", SHORT_NAME],
      );

      expect(result.code).toBe(3);
      expect(result.outLines).toEqual([`Starting code review session in ${worktreePath}`]);
      expect(t.session.impl.invocations).toHaveLength(1);
    });
  });

  describe("publish-pr", () => {
    it("answers the pull request the fake GitHub created", async () => {
      seedRun("review_open");
      writeFileSync(join(runPath, "review-handoff.md"), "# Run Review Handoff\n");
      const t = fakes();
      t.git.impl.addExistingBranch("phax/thing--phase-01");
      t.git.impl.addExistingRemote("origin");

      const result = await runnerCall(
        [makePublishPrCommand({ gitLayer: t.git.layer, githubLayer: t.github.layer })],
        ["publish-pr", SHORT_NAME, "--json"],
      );

      expect(
        result.errLines.filter((line) => !MESSAGE_KINDS.includes(JSON.parse(line).kind)),
      ).toEqual([]);
      expect(result.code).toBe(0);
      const value = JSON.parse(result.out) as { qualifiedName: string; pullRequest: string | null };
      expect(value).toEqual({
        qualifiedName: `test.${SHORT_NAME}`,
        crossProject: false,
        pullRequest: PR_URL,
      });
      expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
    });
  });

  describe("a run that is not in review_open", () => {
    const commands = () => {
      const t = fakes();
      return [
        makeReviewHandoffCommand(),
        makeReviewComplianceCommand({
          backendLayer: t.backend.layer,
          gitLayer: t.git.layer,
          githubLayer: t.github.layer,
        }),
        makeReviewCodeCommand({
          backendLayer: t.backend.layer,
          gitLayer: t.git.layer,
          githubLayer: t.github.layer,
          sessionLayer: t.session.layer,
        }),
        makePublishPrCommand({ gitLayer: t.git.layer, githubLayer: t.github.layer }),
      ];
    };

    it.each([
      [
        "review-handoff",
        [],
        `Run "test.${SHORT_NAME}" is in state "running", not "review_open". The review-handoff command only operates on runs in review_open state.`,
      ],
      [
        "review-compliance",
        [],
        `Run "${SHORT_NAME}" is in state "running", not "review_open". The review-compliance command only operates on runs in review_open state.`,
      ],
      [
        "review-code",
        ["--headless"],
        `Run "${SHORT_NAME}" is in state "running", not "review_open". The review-code command only operates on runs in review_open state.`,
      ],
      [
        "publish-pr",
        [],
        `Run "test.${SHORT_NAME}" is in state "running", not "review_open". The publish-pr command only operates on runs in review_open state.`,
      ],
    ])(
      "%s keeps today's sentence and exit 1, and is one error line under --json",
      async (name, extra, sentence) => {
        seedRun("running");

        const text = await runnerCall(commands(), [name, SHORT_NAME, ...extra]);
        expect(text.code).toBe(1);
        expect(text.out).toBe("");
        expect(text.err).toBe(`${sentence}\n`);

        const json = await runnerCall(commands(), [name, SHORT_NAME, ...extra, "--json"]);
        expect(json.code).toBe(1);
        expect(json.out).toBe("");
        expect(json.errLines).toHaveLength(1);
        const line = JSON.parse(json.errLines[0]!) as {
          kind: string;
          exit: number;
          fields: { message: string };
        };
        expect(line.kind).toBe("error");
        expect(line.exit).toBe(1);
        expect(line.fields.message).toBe(sentence);
      },
    );
  });
});
