import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import { memoryIo } from "../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import type { ExitCode } from "../../src/cli/commandLibrary/contract/index.js";
import { makeArtifactDecideCommand } from "../../src/cli/definitions/artifactDecide.js";
import {
  makeArtifactNewPlanCommand,
  makeArtifactNewSpecCommand,
} from "../../src/cli/definitions/artifactNew.js";
import {
  type StdinDocumentsFakes,
  type StdinDocumentsRepo,
  makeStdinDocumentsRepo,
} from "../fixtures/artifact/stdinDocumentsRepo.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Acceptance tests of command-contracts plan 3, phase-03, passed by phase-04: what `artifact
// decide --verdicts` and `artifact new --brief` answer on the runner. Each call goes through
// `runner.run` over the memory Io, with the factories given fake layers, in a temporary git
// repository. Every test is marked as an expected failure (`it.fails`) until phase-04 moves the
// two commands off their stubs, and phase-04 removes the marker from each.

const TIMEOUT = 30_000;
const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

const repos: StdinDocumentsRepo[] = [];
const fresh = (): StdinDocumentsRepo => {
  const repo = makeStdinDocumentsRepo();
  repos.push(repo);
  return repo;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const repo of repos.splice(0)) repo.dispose();
});

interface CallOptions {
  readonly stdin?: string;
  readonly stdinIsTerminal?: boolean;
  readonly files?: Readonly<Record<string, string>>;
}

/** One call of the repository's program, the factories given the fakes. */
async function call(
  repo: StdinDocumentsRepo,
  fakes: StdinDocumentsFakes,
  argv: readonly string[],
  options: CallOptions = {},
) {
  vi.spyOn(process, "cwd").mockReturnValue(repo.repoDir);
  const program = repo.program({
    decide: makeArtifactDecideCommand(fakes.decideDeps),
    newSpec: makeArtifactNewSpecCommand(fakes.newDeps),
    newPlan: makeArtifactNewPlanCommand(fakes.newDeps),
  });
  const memory = memoryIo({ argv, ...options });
  const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
  return { code, memory, out: memory.out(), err: memory.err() };
}

const lines = (text: string): ReadonlyArray<Record<string, unknown>> =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** The question id and chosen option of each arbitrated question of the committed sidecar. */
function decided(repo: StdinDocumentsRepo): ReadonlyArray<readonly [string, string]> {
  const sidecar = JSON.parse(repo.read(repo.sidecarPath)) as {
    document?: { arbitratedQuestions: Array<{ id: string; verdict: { chosen: string } }> };
    arbitratedQuestions?: Array<{ id: string; verdict: { chosen: string } }>;
  };
  const questions = sidecar.document?.arbitratedQuestions ?? sidecar.arbitratedQuestions ?? [];
  return questions.map((question) => [question.id, question.verdict.chosen] as const);
}

const decideArgv = (repo: StdinDocumentsRepo, ...rest: string[]) => [
  "artifact",
  "decide",
  repo.specPath,
  ...rest,
];

describe("artifact decide --verdicts <file|->", { timeout: TIMEOUT }, () => {
  // ac-stdin-file-or-dash
  it.fails("decides the same verdicts from a file and from a pipe, never reading stdin for the file", async () => {
    const fromFile = fresh();
    const file = await call(
      fromFile,
      fromFile.fakes("decide"),
      decideArgv(fromFile, "--verdicts", "verdicts.json", "--by", "operator"),
      { files: { "verdicts.json": fromFile.verdictsText } },
    );
    expect(file.err).toBe("");
    expect(file.code).toBe(0);
    expect(file.memory.stdinReads()).toBe(0);

    const fromPipe = fresh();
    const piped = await call(
      fromPipe,
      fromPipe.fakes("decide"),
      decideArgv(fromPipe, "--verdicts", "-", "--by", "operator"),
      { stdin: fromPipe.verdictsText },
    );
    expect(piped.err).toBe("");
    expect(piped.code).toBe(0);

    expect(decided(fromFile)).toEqual([
      ["q-keep", "keep-10"],
      ["q-scope", "per-run"],
    ]);
    expect(decided(fromPipe)).toEqual(decided(fromFile));
  });

  // ac-stdin-terminal
  it.fails("refuses --verdicts - on a terminal at once, naming --verdicts, without reading stdin", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "-", "--by", "operator"),
      { stdinIsTerminal: true },
    );
    expect(called.code).toBe(64);
    expect(called.err).toContain("--verdicts");
    expect(called.err).toContain("stdin is a terminal");
    expect(called.memory.stdinReads()).toBe(0);
    expect(called.out).toBe("");
    expect(fakes.backend.runCalls).toEqual([]);
  });

  // ac-stdin-terminal, under --json
  it.fails("writes one refused line naming --verdicts for a terminal stdin under --json", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "-", "--by", "operator", "--json"),
      { stdinIsTerminal: true },
    );
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    const written = lines(called.err);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ kind: "refused", source: "stdin", exit: 64 });
    expect(written[0]?.["path"]).toContain("--verdicts");
    expect(called.memory.stdinReads()).toBe(0);
    expect(fakes.backend.runCalls).toEqual([]);
  });

  // ac-stdin-bad
  it.fails("refuses a verdicts file choosing an unknown option, naming the field, touching nothing", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const before = snapshot(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "verdicts.json", "--by", "operator", "--json"),
      { files: { "verdicts.json": repo.badVerdictsText } },
    );
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    const written = lines(called.err);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      kind: "refused",
      source: "stdin",
      path: ["verdicts", "0", "chosen"],
      text: "error: verdicts.json: verdicts[0].chosen is not an option of q-keep",
      exit: 64,
    });
    expect(snapshot(repo)).toEqual(before);
    expect(fakes.backend.runCalls).toEqual([]);
  });

  // ac-stdin-bad
  it.fails("refuses a verdicts path that does not exist, naming it, touching nothing", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const before = snapshot(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "missing.json", "--by", "operator", "--json"),
    );
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    const written = lines(called.err);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      kind: "refused",
      text: "error: missing.json: no such file or directory",
      exit: 64,
    });
    expect(snapshot(repo)).toEqual(before);
    expect(fakes.backend.runCalls).toEqual([]);
  });

  // ac-no-person
  it.fails("refuses --json without --verdicts before any session or backend call starts", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const called = await call(repo, fakes, decideArgv(repo, "--json"), { stdinIsTerminal: true });
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    const written = lines(called.err);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      kind: "refused",
      source: "flags",
      path: ["json"],
      exit: 64,
    });
    expect(fakes.session.invocations).toEqual([]);
    expect(fakes.backend.runCalls).toEqual([]);
    expect(fakes.backend.resumeCalls).toEqual([]);
  });

  // ac-json-every-command
  it.fails("answers --json with one indented value: today's twelve keys, then written and record", async () => {
    const repo = fresh();
    const fakes = fakesOf(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "verdicts.json", "--by", "operator", "--json"),
      { files: { "verdicts.json": repo.verdictsText } },
    );
    expect(called.code).toBe(0);
    const answer = JSON.parse(called.out) as Record<string, unknown>;
    // Two-space indented, one trailing newline.
    expect(called.out).toBe(`${JSON.stringify(answer, null, 2)}\n`);
    expect(Object.keys(answer)).toEqual([
      "artifact",
      "status",
      "session",
      "provider",
      "model",
      "requestedModel",
      "effort",
      "verdicts",
      "open",
      "diff",
      "commit",
      "decisionId",
      "written",
      "record",
    ]);
    expect(answer["artifact"]).toBe(repo.specPath);
    // Everything on stderr is a message line.
    for (const line of lines(called.err)) expect(MESSAGE_KINDS).toContain(line["kind"]);
  });

  // ac-written-on-failure
  it.fails("lists the spec and its sidecar in the error line's written when the commit fails", async () => {
    const repo = fresh();
    const hook = join(repo.repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const fakes = fakesOf(repo);
    const called = await call(
      repo,
      fakes,
      decideArgv(repo, "--verdicts", "verdicts.json", "--by", "operator", "--json"),
      { files: { "verdicts.json": repo.verdictsText } },
    );
    expect(called.code).toBe(12);
    expect(called.out).toBe("");
    const errors = lines(called.err).filter((line) => line["kind"] === "error");
    expect(errors).toHaveLength(1);
    const records = errors[0]?.["written"] as Array<{ path: string; digest: string }>;
    expect(records.map((record) => record.path).toSorted()).toEqual(
      [repo.specPath, repo.sidecarPath].toSorted(),
    );
    for (const record of records) expect(record.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("artifact new spec --headless --brief <file|->", { timeout: TIMEOUT }, () => {
  // ac-brief-text
  it.fails("hands the session the same brief text from a file and from a pipe", async () => {
    const argv = ["artifact", "new", "spec", "plan-prune", "--headless"];
    const fromFile = fresh();
    const fileFakes = fromFile.fakes("new-spec");
    const file = await call(fromFile, fileFakes, [...argv, "--brief", "brief.md"], {
      files: { "brief.md": fromFile.briefText },
    });
    expect(file.err).toBe("");
    expect(file.code).toBe(0);
    expect(file.memory.stdinReads()).toBe(0);

    const fromPipe = fresh();
    const pipeFakes = fromPipe.fakes("new-spec");
    const piped = await call(fromPipe, pipeFakes, [...argv, "--brief", "-"], {
      stdin: fromPipe.briefText,
    });
    expect(piped.err).toBe("");
    expect(piped.code).toBe(0);

    const brief = `## Brief\n\n${fromFile.briefText.trimEnd()}\n`;
    expect(fileFakes.backend.runCalls).toHaveLength(1);
    expect(pipeFakes.backend.runCalls).toHaveLength(1);
    expect(section(fileFakes.backend.runCalls[0]?.prompt)).toContain(brief);
    expect(section(pipeFakes.backend.runCalls[0]?.prompt)).toBe(
      section(fileFakes.backend.runCalls[0]?.prompt),
    );
  });

  // ac-brief-text
  it.fails("refuses --brief - on a terminal at once, naming --brief, with no backend call", async () => {
    const repo = fresh();
    const fakes = repo.fakes("new-spec");
    const called = await call(
      repo,
      fakes,
      ["artifact", "new", "spec", "plan-prune", "--headless", "--brief", "-"],
      { stdinIsTerminal: true },
    );
    expect(called.code).toBe(64);
    expect(called.err).toContain("--brief");
    expect(called.err).toContain("stdin is a terminal");
    expect(called.memory.stdinReads()).toBe(0);
    expect(fakes.backend.runCalls).toEqual([]);
  });
});

/** A prompt from its `## Brief` section on. */
function section(prompt: string | undefined): string | undefined {
  return prompt?.slice(prompt.indexOf("## Brief"));
}

/** Fakes answering the decide writer, the terminal a real one (decide is never interactive here). */
function fakesOf(repo: StdinDocumentsRepo): StdinDocumentsFakes {
  return repo.fakes("decide", true);
}

/** What a refused call must leave as it was: the spec, its sidecar, HEAD and the tree. */
function snapshot(repo: StdinDocumentsRepo) {
  return {
    spec: repo.read(repo.specPath),
    sidecar: repo.read(repo.sidecarPath),
    head: repo.head(),
    porcelain: repo.porcelain(),
  };
}
