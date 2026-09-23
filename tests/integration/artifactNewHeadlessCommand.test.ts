// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { runCreateArtifactHeadless } from "../../src/cli/commands/artifact.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// End-to-end through the command function: real temp git and filesystem, a
// fake backend swapped in through runCreateArtifactHeadless's deps seam — the
// only layer left unreal is the provider session itself.

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

const SPEC_DOCUMENT = {
  version: 1,
  kind: "spec",
  title: "Plan Prune",
  ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea this spec makes precise" }],
  context: "A slug is held forever by its archived run.",
  problem: "The `-2` habit is the visible symptom.",
  productGoal: {
    statement: "Free a slug once its run is archived.",
    guidingRule: "A slug is held only by a live run.",
  },
  terminology: [{ term: "live run", definition: "a run that is not archived" }],
  requirements: [
    {
      id: "5.1",
      title: "Prune eligibility",
      pattern: "event",
      statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
    },
  ],
  surface: [
    {
      surface: "cli: `phax prune <run>`",
      binding: "normative",
      before: null,
      after: "phax prune usage-cli\n  pruned usage-cli\n  $? = 0",
    },
  ],
  nonGoals: ["pruning a run that is not archived"],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Prune frees the slug",
      given: "an archived run usage-cli",
      when: "`phax prune usage-cli` runs",
      then: "the slug is free",
      refs: ["5.1"],
    },
  ],
  openQuestions: [
    {
      id: "Q1",
      question: "Is pruning manual or automatic past `keep`?",
      options: [
        { id: "manual", label: "an explicit `phax prune`", abandons: "self-shrinking" },
        { id: "auto", label: "prune at archive time", abandons: "later inspection" },
      ],
      recommendation: "manual",
      rationale: "records already keep the trajectory",
    },
  ],
  planningNote: { settled: ["manual prune"], open: [], constraints: ["no new state"] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

let repoDir: string;
let tempHome: string;
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-headless-cmd-")));
  execSync("git init -q", { cwd: repoDir });
  disableGitAutoMaintenance(repoDir);
  execSync('git config user.email "test@example.com"', { cwd: repoDir });
  execSync('git config user.name "Test"', { cwd: repoDir });

  writeFileSync(
    join(repoDir, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "test",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  writeFileSync(join(repoDir, "brief.md"), "Prune archived runs.\nFree their slugs.\n");

  tempHome = mkdtempSync(join(tmpdir(), "phax-headless-cmd-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tempHome;

  process.chdir(repoDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  removeTempDir(repoDir);
  removeTempDir(tempHome);
});

function headCommitPaths(): string[] {
  return execSync("git diff-tree --no-commit-id --name-only -r --root HEAD", { cwd: repoDir })
    .toString("utf8")
    .trim()
    .split("\n")
    .filter((p) => p.length > 0)
    .toSorted();
}

describe("artifact new spec --headless (command)", () => {
  it("a brief file: writes the spec and sidecar, commits exactly those two paths, exits 0", async () => {
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: "sess-authoring" as ClaudeSessionId,
      outputPath: "output.jsonl",
      finalText: JSON.stringify(SPEC_DOCUMENT),
    });

    const { out, lines, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "brief.md" },
      out,
      { backendLayer: backend.layer },
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith("authoring spec plan-prune —"))).toBe(true);
    expect(lines.some((l) => l.includes("(Draft, headless)"))).toBe(true);
    expect(lines.some((l) => l.startsWith("sidecar "))).toBe(true);
    expect(lines.some((l) => l.startsWith("commit "))).toBe(true);
    // No `records` block in phax.json: records are off.
    expect(lines.at(-1)).toBe("record off");

    const specFiles = headCommitPaths().filter((p) => p.startsWith("docs/specs/"));
    expect(specFiles).toHaveLength(2);
    const [md] = specFiles.filter((p) => p.endsWith(".md"));
    const [json] = specFiles.filter((p) => p.endsWith(".json"));
    expect(md).toBeDefined();
    expect(json).toBeDefined();
    if (md === undefined || json === undefined) return;

    const mdContent = readFileSync(join(repoDir, md), "utf8");
    expect(mdContent).toContain("status: Draft");
    expect(mdContent).toContain("# Plan Prune");

    const sidecarContent = JSON.parse(readFileSync(join(repoDir, json), "utf8"));
    expect(sidecarContent).toEqual(SPEC_DOCUMENT);

    expect(backend.impl.runCalls).toHaveLength(1);
  });

  it("--brief -: reads the brief from the injected stdin reader, same result", async () => {
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: "sess-authoring" as ClaudeSessionId,
      outputPath: "output.jsonl",
      finalText: JSON.stringify(SPEC_DOCUMENT),
    });

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune-stdin",
      undefined,
      { headless: true, brief: "-" },
      out,
      {
        backendLayer: backend.layer,
        readStdin: async () => "Prune archived runs.\nFree their slugs.\n",
      },
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const specFiles = headCommitPaths().filter((p) => p.startsWith("docs/specs/"));
    expect(specFiles).toHaveLength(2);
    expect(backend.impl.runCalls[0]?.prompt).toContain("Prune archived runs.");
  });

  it("records on: writes the authoring record after the artifact commit and prints its key", async () => {
    writeFileSync(
      join(repoDir, "phax.json"),
      JSON.stringify({
        version: 1,
        name: "test",
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        // Transcript off: a skeleton record is safe in-repo whatever the
        // visibility, so the destination policy never asks `gh`.
        records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
      }),
    );
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: "sess-authoring" as ClaudeSessionId,
      outputPath: "output.jsonl",
      finalText: JSON.stringify(SPEC_DOCUMENT),
    });

    const { out, lines, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "brief.md" },
      out,
      { backendLayer: backend.layer },
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const recordLine = lines.at(-1) ?? "";
    expect(recordLine).toMatch(/^record authoring\/\d{10}-plan-prune$/);
    const key = recordLine.slice("record ".length);

    const recordFiles = execSync(`git ls-tree -r --name-only phax/records/v1`, { cwd: repoDir })
      .toString("utf8")
      .trim()
      .split("\n");
    expect(recordFiles).toEqual([
      `${key}/brief.md`,
      `${key}/document.json`,
      `${key}/prompt.md`,
      `${key}/record.json`,
    ]);

    const manifest = JSON.parse(
      execSync(`git show phax/records/v1:${key}/record.json`, { cwd: repoDir }).toString("utf8"),
    );
    const artifactCommit = execSync("git rev-parse HEAD", { cwd: repoDir }).toString("utf8").trim();
    expect(manifest).toMatchObject({
      kind: "authoring",
      outcome: "committed",
      artifactKind: "spec",
      sourceSha: artifactCommit,
      shape: "skeleton",
    });
    // The artifact commit's Authoring-Id trailer names the record's key.
    const body = execSync("git log -1 --format=%B HEAD", { cwd: repoDir }).toString("utf8");
    expect(body).toContain(`Authoring-Id: ${key.slice("authoring/".length)}`);
  });

  it("--headless without --brief: refuses before spawning, exits 12", async () => {
    const backend = makeFakeBackend();

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true },
      out,
      { backendLayer: backend.layer },
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("--brief");
    expect(backend.impl.runCalls).toHaveLength(0);
  });
});
