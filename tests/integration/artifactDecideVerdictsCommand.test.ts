import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeArtifactDecideCommand } from "../../src/cli/definitions/artifactDecide.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import {
  OPERATOR,
  SPEC_FRONTMATTER,
  WRITER_SESSION,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";
import { inArtifact, runnerCall, type RunnerCallOptions } from "../helpers/runnerCall.js";
import { ANSWER_FOLLOW, FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax artifact decide --verdicts` end to end in a temp repo, through the command runner over a
// memory Io: real git and filesystem, a fake writer backend, a fake terminal. The runner reads
// the verdicts document (the memory Io holds the file and the pipe). Every spec, verdicts file
// and operator is made up.

const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");
const world = useDecideRepo();

/** Seeds phax.json, the spec (with sidecar) and a verdicts file, then commits them. */
function seed(verdictsText: string): void {
  world.writeRepoFile(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  world.writeRepoFile(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument));
  world.writeRepoFile(SPEC_JSON, serializeSidecar(SPEC));
  world.writeRepoFile("verdicts.json", verdictsText);
  world.commitAll();
}

function deps(opts: { answers?: readonly string[]; terminal?: boolean }) {
  const backend = makeFakeBackend();
  for (const finalText of opts.answers ?? []) {
    backend.impl.addRunResponse({
      sessionId: WRITER_SESSION as ClaudeSessionId,
      outputPath: "",
      finalText,
    });
  }
  return {
    backend: backend.impl,
    deps: {
      backendLayer: backend.layer,
      terminalLayer: makeFakeTerminal(opts.terminal ?? true).layer,
      githubLayer: makeFakeGitHub().layer,
    },
  };
}

/** `phax artifact decide <SPEC_PATH> …rest`, the verdicts file as the repo holds it. */
function decide(
  d: ReturnType<typeof deps>["deps"],
  rest: ReadonlyArray<string>,
  verdictsText: string,
  options: RunnerCallOptions = {},
) {
  return runnerCall(
    [inArtifact(makeArtifactDecideCommand(d))],
    ["artifact", "decide", SPEC_PATH, ...rest],
    { files: { "verdicts.json": verdictsText }, ...options },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phax artifact decide --verdicts", { timeout: 30_000 }, () => {
  // Changed by §5.2: the report is one indented value (it was one compact line) and gains
  // `written` and `record` after its twelve keys; progress lines are note lines on stderr.
  it("--verdicts - --by operator --json: stdout is one indented JSON value with every report key, progress on stderr", async () => {
    seed("not read");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({
      answers: [JSON.stringify(ANSWER_FOLLOW)],
      terminal: false,
    });

    const called = await decide(d, ["--verdicts", "-", "--by", "operator", "--json"], "not read", {
      stdin: FILE_VALID,
    });

    const notNotes = called.errLines
      .map((line) => JSON.parse(line) as { kind: string })
      .filter((line) => line.kind !== "note");
    expect(notNotes).toEqual([]);
    expect(called.code).toBe(0);
    expect(backend.runCalls).toHaveLength(1);
    // stdout: one JSON value, written two-space indented with one trailing newline.
    const report = JSON.parse(called.out) as Record<string, unknown>;
    expect(called.out).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(Object.keys(report)).toEqual([
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
    expect(report).toMatchObject({
      artifact: SPEC_PATH,
      status: "Draft",
      session: "new",
      model: "claude-sonnet-5-5",
      requestedModel: "claude-sonnet-5-5",
      effort: "medium",
      open: ["q-names"],
    });
    const verdicts = report["verdicts"] as Array<{ question: string; by: unknown }>;
    expect(verdicts.map((v) => v.question)).toEqual(["q-keep", "q-scope"]);
    expect(verdicts[0]!.by).toEqual({ kind: "operator", name: OPERATOR });
    // stderr: the use case's progress, labelled `stdin`.
    expect(called.err).toContain("verdicts from stdin: q-keep, q-scope");
    expect(world.headFiles()).toEqual([SPEC_PATH, SPEC_JSON].toSorted());
  });

  it("a file path: prints the human report on stdout and ends with the Draft status", async () => {
    seed(FILE_VALID);
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { deps: d } = deps({ answers: [JSON.stringify(ANSWER_FOLLOW)] });

    const called = await decide(d, ["--verdicts", "verdicts.json", "--by", "operator"], FILE_VALID);

    expect(called.err).toBe("");
    expect(called.code).toBe(0);
    const text = called.out;
    expect(text).toContain("verdicts from verdicts.json: q-keep, q-scope");
    expect(text).toContain("q-keep");
    expect(text).toContain("(recommended)");
    expect(text).toContain("q-names");
    expect(text).toContain("(not in the verdicts file)");
    expect(text).toMatch(/commit {5}[0-9a-f]{7} — docs\(specs\): decide log-rotation/);
    expect(text).toContain(
      `status     Draft — read the verdicts and the diff above, then \`phax artifact approve ${SPEC_PATH} --by operator\``,
    );
  });

  // Changed by §5.16: a verdicts file that does not decode is refused by the runner before run,
  // with 64 and one refused line naming the file, where decide answered 12 with its sentence.
  it("a refused file exits 64 with an empty stdout and no session, one refused line under --json", async () => {
    seed("{ not json");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({});

    const called = await decide(
      d,
      ["--verdicts", "verdicts.json", "--by", "operator", "--json"],
      "{ not json",
    );

    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    expect(called.errLines).toHaveLength(1);
    const refused = JSON.parse(called.errLines[0]!) as { kind: string; text: string };
    expect(refused.kind).toBe("refused");
    expect(refused.text).toContain("verdicts.json");
    expect(backend.runCalls).toEqual([]);
    expect(world.porcelain()).toBe("");
  });

  it("keeps verdicts.json in the decision folder as the runner read it, byte for byte", async () => {
    seed("not read");
    // The state root beside the repository, so that the decision folder can be read back.
    world.writeRepoFile(
      "phax.json",
      JSON.stringify({
        version: 1,
        name: "made-up",
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        state: { root: world.stateRoot },
      }),
    );
    world.commitAll("state root");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { deps: d } = deps({ answers: [JSON.stringify(ANSWER_FOLLOW)], terminal: false });
    // The piped bytes, laid out unlike any serializer would: kept as they came.
    const piped = `\n  ${FILE_VALID.trim().replaceAll("\n", "\n\t")}  \n\n`;

    const called = await decide(d, ["--verdicts", "-", "--by", "operator"], "not read", {
      stdin: piped,
    });

    expect(called.code).toBe(0);
    const kept = readdirSync(world.stateRoot, { recursive: true, encoding: "utf8" }).filter(
      (path) => basename(path) === "verdicts.json",
    );
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(world.stateRoot, kept[0]!), "utf8")).toBe(piped);
  });

  it("--by machine:<grant> is refused before any session", async () => {
    seed(FILE_VALID);
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({});

    const called = await decide(
      d,
      ["--verdicts", "verdicts.json", "--by", "machine:roadmap-loop"],
      FILE_VALID,
    );

    expect(called.code).toBe(12);
    expect(called.out).toBe("");
    expect(backend.runCalls).toEqual([]);
  });
});
