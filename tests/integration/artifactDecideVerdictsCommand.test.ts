import { afterEach, describe, expect, it, vi } from "vitest";
import { runArtifactDecide } from "../../src/cli/commands/artifactDecide.js";
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
import { ANSWER_FOLLOW, FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `runArtifactDecide --verdicts` end to end in a temp repo: real git and
// filesystem, a fake writer backend, a fake terminal that holds stdin. Every
// spec, verdicts file and operator is made up.

const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");
const world = useDecideRepo();

function makeOutput() {
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warnings.push(m),
      error: (m: string) => errors.push(m),
    },
    logs,
    warnings,
    errors,
  };
}

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

function deps(opts: { stdin?: string; answers?: readonly string[]; terminal?: boolean }) {
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
      terminalLayer: makeFakeTerminal(opts.terminal ?? true, opts.stdin).layer,
      githubLayer: makeFakeGitHub().layer,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runArtifactDecide --verdicts", { timeout: 30_000 }, () => {
  it("--verdicts - --by operator --json: stdout is one JSON object with every report key, progress on stderr", async () => {
    seed("not read");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({
      stdin: FILE_VALID,
      answers: [JSON.stringify(ANSWER_FOLLOW)],
      terminal: false,
    });
    const o = makeOutput();

    const code = await runArtifactDecide(
      SPEC_PATH,
      { verdicts: "-", by: "operator", json: true },
      o.out,
      d,
    );

    expect(o.errors).toEqual([]);
    expect(code).toBe(0);
    expect(backend.runCalls).toHaveLength(1);
    // stdout: exactly one line, one JSON object.
    expect(o.logs).toHaveLength(1);
    const report = JSON.parse(o.logs[0]!) as Record<string, unknown>;
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
    expect(o.warnings.join("\n")).toContain("verdicts from stdin: q-keep, q-scope");
    expect(world.headFiles()).toEqual([SPEC_PATH, SPEC_JSON].toSorted());
  });

  it("a file path: prints the human report on stdout and ends with the Draft status", async () => {
    seed(FILE_VALID);
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { deps: d } = deps({ answers: [JSON.stringify(ANSWER_FOLLOW)] });
    const o = makeOutput();

    const code = await runArtifactDecide(
      SPEC_PATH,
      { verdicts: "verdicts.json", by: "operator" },
      o.out,
      d,
    );

    expect(o.errors).toEqual([]);
    expect(code).toBe(0);
    const text = o.logs.join("\n");
    expect(text).toContain("verdicts from verdicts.json: q-keep, q-scope");
    expect(text).toContain("q-keep");
    expect(text).toContain("(recommended)");
    expect(text).toContain("q-names");
    expect(text).toContain("(not in the verdicts file)");
    expect(text).toMatch(/commit {5}[0-9a-f]{7} — docs\(specs\): decide log-rotation/);
    expect(text).toContain(
      `status     Draft — read the verdicts and the diff above, then \`phax artifact approve ${SPEC_PATH}\``,
    );
  });

  it("a refused file exits 12 with an empty stdout and no session, even with --json", async () => {
    seed("{ not json");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({});
    const o = makeOutput();

    const code = await runArtifactDecide(
      SPEC_PATH,
      { verdicts: "verdicts.json", by: "operator", json: true },
      o.out,
      d,
    );

    expect(code).toBe(12);
    expect(o.logs).toEqual([]);
    expect(o.errors).toHaveLength(1);
    expect(o.errors[0]).toContain("verdicts.json");
    expect(backend.runCalls).toEqual([]);
    expect(world.porcelain()).toBe("");
  });

  it("--by machine:<grant> is refused before any session", async () => {
    seed(FILE_VALID);
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps({});
    const o = makeOutput();

    const code = await runArtifactDecide(
      SPEC_PATH,
      { verdicts: "verdicts.json", by: "machine:roadmap-loop" },
      o.out,
      d,
    );

    expect(code).toBe(12);
    expect(o.logs).toEqual([]);
    expect(backend.runCalls).toEqual([]);
  });
});
