import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { NodeGitLayer } from "../../../src/infra/git.js";
import { Git } from "../../../src/ports/git.js";
import { decodeBranchName } from "../../../src/domain/branded.js";
import { encodeRunRecordManifest, type RunRecordManifest } from "../../../src/schemas/runRecord.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";

export const PROMPT_TEXT = "Implement the widget.\nKeep it small.";
const DIFF_TEXT = [
  "diff --git a/widget.txt b/widget.txt",
  "--- a/widget.txt",
  "+++ b/widget.txt",
  "+added line",
].join("\n");

const RUN_ID = "run-json-contracts-1786800000000";
const PHASE_ID = "phase-01";

export interface JsonContractsRepo {
  /** The git repository, with records enabled in-repo. */
  readonly repo: string;
  /** The state root phax.json points at. */
  readonly stateRoot: string;
  /** The phax.json path. */
  readonly configPath: string;
  /** A phase commit with a record on phax/records/v1 (prompt.md, diff.patch). */
  readonly phaseSha: string;
  /** A commit no phax phase produced: it carries no phax trailers. */
  readonly plainSha: string;
  /** The temporary directory holding everything. */
  readonly base: string;
  readonly cleanup: () => void;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();
}

/**
 * Builds, in a temporary directory, a git repository whose phax.json enables
 * records in-repo, with one phase commit carrying a record on phax/records/v1
 * (prompt.md and diff.patch) and one commit no phax phase produced. The caller
 * isolates git (isolateGit) and gives the spawned CLI a temporary home
 * (phaxHomeEnv); nothing outside the temporary directory is read.
 */
export async function buildJsonContractsRepo(): Promise<JsonContractsRepo> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "phax-records-json-")));
  const repo = join(base, "repo");
  const stateRoot = join(base, "state");
  mkdirSync(repo);
  mkdirSync(stateRoot);
  git(["init", "-q", "-b", "main"], repo);
  disableGitAutoMaintenance(repo);
  git(["config", "--local", "user.email", "test@phax.test"], repo);
  git(["config", "--local", "user.name", "phax test"], repo);

  const configPath = join(repo, "phax.json");
  const config = {
    version: 1,
    name: "made-up",
    state: { root: stateRoot },
    gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  writeFileSync(join(repo, "widget.txt"), "widget\n");
  git(["add", "."], repo);
  git(["commit", "-q", "-m", "chore: initial commit"], repo);

  const body = [
    "Do the widget.",
    "",
    "---",
    "",
    "Run-Id: " + RUN_ID,
    "Short-Name: json-contracts",
    "Phase-Id: " + PHASE_ID,
    "Phase-Title: Widget",
    "Model: claude-sonnet-5",
    "Effort: high",
  ].join("\n");
  git(["commit", "-q", "--allow-empty", "-m", "feat: widget", "-m", body], repo);
  const phaseSha = git(["rev-parse", "HEAD"], repo);

  git(["commit", "-q", "--allow-empty", "-m", "manual: hotfix, no trailers"], repo);
  const plainSha = git(["rev-parse", "HEAD"], repo);

  const manifest: RunRecordManifest = {
    runId: RUN_ID,
    phaseId: PHASE_ID,
    shape: "skeleton",
    sourceSha: phaseSha,
    model: "claude-sonnet-5",
    effort: "high",
    provider: "claude-code",
    userConfig: "loaded",
    outcome: "committed",
    usage: { available: false },
    verifiedSurfaces: ["local"],
    acceptance: null,
    mode: "headless",
    stop: null,
  };
  const encoded = encodeRunRecordManifest(withSchemaUrl("phase-record-manifest", manifest));
  const encoder = new TextEncoder();
  const contents: ReadonlyArray<readonly [string, string]> = [
    ["record.json", JSON.stringify(encoded, null, 2) + "\n"],
    ["prompt.md", PROMPT_TEXT],
    ["diff.patch", DIFF_TEXT],
  ];
  const files = contents.map(([name, content]) => ({
    path: RUN_ID + "/" + PHASE_ID + "/" + name,
    content: encoder.encode(content),
  }));
  const branch = Either.getOrThrow(decodeBranchName("phax/records/v1"));
  const message = [
    "records(" + PHASE_ID + "): committed",
    "",
    "Run-Id: " + RUN_ID,
    "Phase-Id: " + PHASE_ID,
    "Shape: skeleton",
  ].join("\n");
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({ repo, branch, message, files, parent: null, expectedTip: null }),
      ),
      NodeGitLayer,
    ),
  );

  return {
    repo,
    stateRoot,
    configPath,
    phaseSha,
    plainSha,
    base,
    cleanup: () => removeTempDir(base),
  };
}
