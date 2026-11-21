import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { makePublishPrCommand } from "../../../src/cli/definitions/publishPr.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import {
  complianceReviewFileText,
  type PersistedComplianceReview,
} from "../../../src/schemas/complianceReview.js";
import { phaseReconciliationFile } from "../../helpers/reconciliationFixture.js";
import { runnerCall } from "../../helpers/runnerCall.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { buildFateRunRepo, type FateRunRepo } from "./fateRunRepo.js";
import { boundedOutput, GIT_BOUND_MS } from "../../helpers/boundedSpawn.js";

// The project of the acceptance tests of a run's pull request: the run of fateRunRepo.ts plus a
// bare repository as its `origin`, the run-folder files `phax publish-pr` needs, publish
// settings, publish-pr through the fake GitHub port and a made-up `gh` on PATH that logs each
// call. Nothing outside the fixture's temporary directories is read or written. A test file that
// builds it hoists the `node:os` mock of tests/helpers/isolatePhaxHome.ts, and sets the process
// working directory to `repoDir`.

export interface PrRunRepo extends FateRunRepo {
  /** The bare repository added as `origin` of the main checkout. */
  readonly remoteDir: string;
  /** The directory of the made-up `gh` and its call log, written by `installFakeGh`. */
  readonly ghDir: string;
}

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd });
}

/**
 * Builds the run of `buildFateRunRepo()`, adds a bare repository as `origin` and pushes the run
 * branch to it, and writes into the run folder the files `phax publish-pr` reads: the review
 * handoff, the phase's reconciliation and handoff, and the global reconciliation.
 */
export function buildPrRunRepo(): PrRunRepo {
  const repo = buildFateRunRepo();
  const remoteDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-pr-remote-")));
  const ghDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-pr-gh-")));
  const cleanup = (): void => {
    removeTempDir(remoteDir);
    removeTempDir(ghDir);
    vi.unstubAllEnvs();
    repo.cleanup();
  };
  try {
    git(["init", "-q", "--bare", "-b", "main"], remoteDir);
    disableGitAutoMaintenance(remoteDir);
    git(["remote", "add", "origin", remoteDir], repo.repoDir);
    git(["push", "-q", "origin", "--", repo.runBranch], repo.repoDir);

    const phaseDir = join(repo.runFolder, "phase-01");
    writeFileSync(join(repo.runFolder, "review-handoff.md"), "# Run Review Handoff\n");
    writeFileSync(
      join(phaseDir, "file-reconciliation.json"),
      JSON.stringify(phaseReconciliationFile("phase-01")),
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
    writeFileSync(join(repo.runFolder, "global-file-reconciliation.md"), "# Reconciliation\n");
  } catch (error) {
    cleanup();
    throw error;
  }
  return { ...repo, remoteDir, ghDir, cleanup };
}

/** Rewrites phax.json's `publish` key as `{ auto }`. */
export function setPublishAuto(repo: PrRunRepo, auto: boolean): void {
  const file = join(repo.repoDir, "phax.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...config, publish: { auto } }, null, 2));
}

/** Writes the run folder's `compliance-review.json`: one `phase-01` finding C1 of `files`. */
export function writeComplianceFinding(repo: PrRunRepo, message: string): void {
  const review: PersistedComplianceReview = {
    verdict: "conformant-with-deviations",
    summary: "One deviation.",
    perPhase: [
      {
        phaseId: "phase-01",
        verdict: "conformant-with-deviations",
        findings: [{ id: "C1", dimension: "files", severity: "deviation", message }],
      },
    ],
    unplannedChanges: [],
    unmetPromises: [],
    attentionPoints: [],
    pointers: [],
  };
  writeFileSync(join(repo.runFolder, "compliance-review.json"), complianceReviewFileText(review));
}

const LOG_DIR = "log";

/**
 * Writes an executable `gh` into `repo.ghDir` and puts that directory first on PATH. The script
 * logs every call: its arguments, NUL-separated, to the next numbered file `log/<nnnn>.args`;
 * for `pr comment`, also the bare remote's `refs/heads/<runBranch>` sha at that moment (empty
 * when the ref is absent) to `log/<nnnn>.head`. In `answers` mode a `pr comment` call answers
 * `<its third argument>#issuecomment-<n>` and exits 0, a `pr view` call answers
 * `{"state":"<prState>"}` (OPEN unless given) and exits 0, and any other call exits 1. In `fails`
 * mode every call writes `gh: offline` to stderr and exits 1. `fails-first-comment` mode answers
 * as `answers` does, except that the first `pr comment` call the log holds writes
 * `gh: rate limited` to stderr and exits 1. Paths are baked into the script.
 */
export function installFakeGh(
  repo: PrRunRepo,
  mode: "answers" | "fails" | "fails-first-comment",
  prState: "OPEN" | "MERGED" | "CLOSED" = "OPEN",
): void {
  const logDir = join(repo.ghDir, LOG_DIR);
  mkdirSync(logDir, { recursive: true });
  const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  const script = [
    "#!/bin/sh",
    `LOG=${quoted(logDir)}`,
    `n=$(( $(ls "$LOG" | grep -c '\\.args$') + 1 ))`,
    `id=$(printf '%04d' "$n")`,
    `printf '%s\\000' "$@" > "$LOG/$id.args"`,
    `if [ "$1" = "pr" ] && [ "$2" = "comment" ]; then`,
    `  git --git-dir ${quoted(repo.remoteDir)} rev-parse --verify --quiet ${quoted(`refs/heads/${repo.runBranch}`)} > "$LOG/$id.head" 2>/dev/null || true`,
    `fi`,
    ...(mode === "fails-first-comment"
      ? [
          `if [ "$1" = "pr" ] && [ "$2" = "comment" ] && [ "$(ls "$LOG" | grep -c '\\.head$')" -eq 1 ]; then`,
          `  echo "gh: rate limited" >&2`,
          `  exit 1`,
          `fi`,
        ]
      : []),
    ...(mode === "answers" || mode === "fails-first-comment"
      ? [
          `if [ "$1" = "pr" ] && [ "$2" = "comment" ]; then`,
          `  echo "$3#issuecomment-$n"`,
          `  exit 0`,
          `fi`,
          `if [ "$1" = "pr" ] && [ "$2" = "view" ]; then`,
          `  echo '{"state":"${prState}"}'`,
          `  exit 0`,
          `fi`,
          `exit 1`,
        ]
      : [`echo "gh: offline" >&2`, `exit 1`]),
    "",
  ].join("\n");
  const file = join(repo.ghDir, "gh");
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  vi.stubEnv("PATH", `${repo.ghDir}:${process.env["PATH"] ?? ""}`);
}

function logFiles(repo: PrRunRepo, extension: string): string[] {
  const logDir = join(repo.ghDir, LOG_DIR);
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((name) => name.endsWith(extension))
    .toSorted();
}

function readArgs(repo: PrRunRepo, name: string): string[] {
  const text = readFileSync(join(repo.ghDir, LOG_DIR, name), "utf8");
  return text === "" ? [] : text.slice(0, -1).split("\0");
}

/** Every logged call's arguments, in call order. */
export function ghCalls(repo: PrRunRepo): readonly (readonly string[])[] {
  return logFiles(repo, ".args").map((name) => readArgs(repo, name));
}

/** Each `pr comment` call: its pull request, its body and the bare remote's run-branch sha then. */
export function ghComments(repo: PrRunRepo): readonly {
  readonly pullRequest: string | undefined;
  readonly body: string | undefined;
  readonly remoteHeadAtCall: string | null;
}[] {
  return logFiles(repo, ".args").flatMap((name) => {
    const args = readArgs(repo, name);
    if (args[0] !== "pr" || args[1] !== "comment") return [];
    const headFile = join(repo.ghDir, LOG_DIR, name.replace(/\.args$/, ".head"));
    const logged = existsSync(headFile) ? readFileSync(headFile, "utf8").trim() : "";
    const bodyAt = args.indexOf("--body");
    return [
      {
        pullRequest: args[2],
        body: bodyAt === -1 ? undefined : args[bodyAt + 1],
        remoteHeadAtCall: logged === "" ? null : logged,
      },
    ];
  });
}

/** The bare remote's `refs/heads/<runBranch>` sha, or null when it does not resolve. */
export function remoteHead(repo: PrRunRepo): string | null {
  try {
    const sha = git(
      [
        "--git-dir",
        repo.remoteDir,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${repo.runBranch}`,
      ],
      repo.repoDir,
    ).trim();
    return sha === "" ? null : sha;
  } catch {
    return null;
  }
}

/**
 * `publish-pr <run> --json` through the runner over the fake GitHub port and the real git
 * adapter. `body` is the text of the file the fake's `createPullRequest` was given, read after
 * the call, or null when no pull request was created.
 */
export async function publishPr(repo: PrRunRepo) {
  const fake = makeFakeGitHub();
  const result = await runnerCall(
    [makePublishPrCommand({ githubLayer: fake.layer })],
    ["publish-pr", repo.shortName, "--json"],
  );
  const created = fake.impl.calls.find((call) => call.method === "createPullRequest");
  const body =
    created?.method === "createPullRequest" ? readFileSync(created.bodyFile, "utf8") : null;
  const answer =
    result.code === 0 ? (JSON.parse(result.out) as { pullRequest: string | null }) : null;
  return {
    code: result.code,
    out: result.out,
    err: result.err,
    prUrl: answer?.pullRequest ?? null,
    body,
  };
}

/**
 * The lines of the description from the line `## Review findings` up to, not including, the next
 * line starting `## ` or equal to `---`, trimmed; null when there is no such heading.
 */
export function findingsSection(body: string): string | null {
  const lines = body.split("\n");
  const start = lines.indexOf("## Review findings");
  if (start === -1) return null;
  const rest = lines.slice(start);
  const end = rest.findIndex((line, i) => i > 0 && (line.startsWith("## ") || line === "---"));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}
