import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { buildDecideRetryPrompt } from "../../src/domain/decide/prompt.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import type { ModelRouting } from "../../src/schemas/modelRouting.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type {
  OpenQuestion,
  SpecArbitratedQuestion,
  SpecVerdict,
} from "../../src/schemas/questions.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import {
  KEPT_FIRST_SESSION,
  KEPT_SESSION,
  NOW,
  OPERATOR,
  RECORDS_BRANCH,
  RECORDS_ON,
  RETRY_SESSION,
  SPEC_FRONTMATTER,
  WRITER_SESSION,
  expectFailure,
  expectNoWriter,
  playTranscripts,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";
import {
  ANSWER_ADDS_OPTION,
  ANSWER_CITES_S12,
  ANSWER_DEPARTS,
  ANSWER_DEPARTS_WITHOUT_REVISED,
  ANSWER_EDITS_BODY,
  ANSWER_FOLLOW,
  ANSWER_FOLLOW_WITH_REVISED,
  ANSWER_MOVES_NAMES,
  ANSWER_OTHER,
  ANSWER_REARBITRATE_ADDS_OPTION,
  ANSWER_REARBITRATE_KEEP_20,
  ANSWER_REARBITRATE_SAME,
  ANSWER_RESTORE_KEEP,
  ANSWER_RESTORE_KEEP_UNNAMED,
  ANSWER_RESTORE_UNREVISED,
  ANSWER_RESTORE_UNREVISED_NAMES,
  ANSWER_WRONG_OPTION,
  FILE_EMPTY_NOTE,
  FILE_EMPTY_VERDICTS,
  FILE_EXTRA_KEY,
  FILE_NOT_JSON,
  FILE_NO_NOTE,
  FILE_NO_SCHEMA,
  FILE_OTHER_RELEASE,
  FILE_REVERSED,
  FILE_VALID,
  FILE_WRONG_FORMAT,
  OTHER_RELEASE_URL,
  OTHER_SPEC_PATH,
  PREVIOUS_KEEP,
  SPEC,
  SPEC_KEEP_20_DECIDED,
  SPEC_KEEP_20_UNREVISED,
  SPEC_KEEP_DECIDED,
  SPEC_NAMES_DECIDED,
  SPEC_PATH,
  TRANSCRIBED_FOLLOW,
} from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Real-git acceptance for `phax artifact decide --verdicts` on a headless
// spec (spec artifact-decide-verdicts §5, §8). The writer session and the
// terminal are fakes; git and the filesystem are real. Every spec, verdicts
// file, operator and doctrine is made up.

const AUTHORING_ID = "2610250900-log-rotation";
const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");
const VERDICTS = "verdicts.json";

const world = useDecideRepo();

type Json = Record<string, unknown>;

function fileOf(
  verdicts: ReadonlyArray<{ question: string; chosen: string; note?: string | null }>,
  artifact = SPEC_PATH,
): string {
  return JSON.stringify(
    {
      $schema: currentSchemaUrl("decide-verdicts"),
      artifact,
      verdicts: verdicts.map((v) => ({ note: null, ...v })),
    },
    null,
    2,
  );
}

/** Seeds the spec (and sidecar) and the verdicts file, then commits them. */
function seed(
  verdictsText: string,
  sidecar = SPEC,
  frontmatter = SPEC_FRONTMATTER,
): { md: string } {
  const doc = sidecar.document as SpecDocument;
  const md = frontmatter + renderSpecBody(doc);
  world.writeRepoFile(SPEC_PATH, md);
  world.writeRepoFile(SPEC_JSON, serializeSidecar(sidecar));
  world.writeRepoFile(VERDICTS, verdictsText);
  world.commitAll();
  return { md };
}

function sidecarJson(): Json {
  return JSON.parse(world.readRepoFile(SPEC_JSON)) as Json;
}

function arbitratedOf(sidecar: Json = sidecarJson()): SpecArbitratedQuestion[] {
  return sidecar["arbitratedQuestions"] as SpecArbitratedQuestion[];
}

function openIds(sidecar: Json = sidecarJson()): string[] {
  return (sidecar["openQuestions"] as Array<{ id: string }>).map((q) => q.id);
}

/** A question as the writer returns it decided: its own why, by and at, which phax sets over. */
function writerDecided(q: OpenQuestion, chosen: string, revised: string[]): SpecArbitratedQuestion {
  return {
    ...q,
    verdict: {
      kind: "decided",
      chosen,
      abandoned: q.options.map((o) => o.id).filter((id) => id !== chosen),
      why: "the writer's own reason",
      advocate: "the other option is simpler to explain",
      principles: ["S1"],
      reversibility: "cheap",
      by: { kind: "operator", name: "Writer" },
      at: "2020-01-01T00:00:00Z",
      revised,
    },
    history: [],
  };
}

function lastCommitMessage(): string {
  return world.git(["log", "-1", "--format=%B"]).trimEnd();
}

describe("decide --verdicts — verdicts land headless", { timeout: 30_000 }, () => {
  it("lands q-keep and q-scope with no prompt: why, operator, q-names open, Draft, one commit of two paths", async () => {
    const { md } = seed(FILE_VALID);
    const head = world.headSha();
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const result = await h.run();

    const done = Either.getOrThrow(result);
    expect(done).toMatchObject({
      kind: "committed",
      path: SPEC_PATH,
      paths: [SPEC_PATH, SPEC_JSON],
      status: "Draft",
      session: "new",
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      requestedModel: "claude-sonnet-5-5",
      effort: "medium",
      modelSource: "built-in default",
      effortSource: "built-in default",
      open: ["q-names"],
      decisionId: `${AUTHORING_ID}/01`,
      record: { kind: "records-off" },
    });
    expect(done.verdicts).toEqual(TRANSCRIBED_FOLLOW);
    expect(done.commit.subject).toBe("docs(specs): decide log-rotation q-keep, q-scope");
    expect(done.diff).toContain("## 9b. Arbitrated questions");

    // The committed sidecar: the note, or the rationale, as why; the committing
    // identity as by; the command's clock as at. The writer's own values are gone.
    const sidecar = sidecarJson();
    expect(sidecar["$schema"]).toBe(currentSchemaUrl("spec-document"));
    expect(openIds(sidecar)).toEqual(["q-names"]);
    expect(arbitratedOf(sidecar).map((q) => [q.id, q.verdict])).toEqual([
      [
        "q-keep",
        expect.objectContaining({
          kind: "decided",
          chosen: "keep-10",
          why: "Ten logs cover a week of runs.",
          by: { kind: "operator", name: OPERATOR },
          at: NOW,
          revised: [],
        }),
      ],
      [
        "q-scope",
        expect.objectContaining({
          chosen: "per-run",
          why: "A report names its run, so a log is kept with its run.",
          by: { kind: "operator", name: OPERATOR },
          at: NOW,
        }),
      ],
    ]);

    // Still Draft, frontmatter byte for byte, the body outside the question sections as it was.
    const after = world.readRepoFile(SPEC_PATH);
    expect(after.startsWith(SPEC_FRONTMATTER)).toBe(true);
    expect(after).toContain("## 9b. Arbitrated questions");
    expect(after).not.toBe(md);

    // One commit of exactly the spec and its sidecar, with the verdicts trailers.
    expect(world.headSha()).not.toBe(head);
    expect(world.headFiles()).toEqual([SPEC_JSON, SPEC_PATH]);
    expect(lastCommitMessage()).toBe(
      [
        "docs(specs): decide log-rotation q-keep, q-scope",
        "",
        "Decided from a verdicts file, transcribed in a headless session (claude-sonnet-5-5 / medium on claude-code).",
        "",
        `Artifact: ${SPEC_PATH}`,
        `Decided-By: operator (${OPERATOR})`,
        "Decided-Via: verdicts",
        `Decision-Id: ${AUTHORING_ID}/01`,
      ].join("\n"),
    );
    expect(world.porcelain()).toBe("");

    // The progress lines.
    expect(h.lines).toEqual([
      "decide spec log-rotation — verdicts from verdicts.json: q-keep, q-scope — headless, new session",
      "model      claude-sonnet-5-5 / medium (built-in default) on claude-code",
    ]);
    expect(h.warnings).toEqual([]);

    // The writer: one new session, read-only, the prompt kept beside the file as given.
    const folder = world.decisionFolder(AUTHORING_ID);
    expect(h.backend.resumeCalls).toEqual([]);
    expect(h.backend.runCalls).toHaveLength(1);
    const [call] = h.backend.runCalls;
    expect(call?.prompt).toBe(readFileSync(join(folder, "prompt.md"), "utf8"));
    expect(call?.options).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      cwd: world.repoDir,
      readOnly: true,
      outputJsonlPath: join(folder, "output.jsonl"),
      phaseFolderPath: folder,
    });
    expect(readFileSync(join(folder, "verdicts.json"), "utf8")).toBe(FILE_VALID);
    expect(call?.prompt).not.toContain("F1:");
    // No handback prompt: the writer answers in its first turn.
    expect(existsSync(join(folder, "handback-prompt.md"))).toBe(false);
  });

  it("binds, transcribes and reports in the artifact's order, not the file's", async () => {
    seed(FILE_REVERSED);
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.verdicts.map((v) => v.question)).toEqual(["q-keep", "q-scope"]);
    expect(done.commit.subject).toBe("docs(specs): decide log-rotation q-keep, q-scope");
    expect(h.lines[0]).toContain("q-keep, q-scope");
  });

  it("reads the verdicts from a pipe on stdin when asked", async () => {
    seed("unused");
    const h = world.harness({
      runAnswers: [JSON.stringify(ANSWER_FOLLOW)],
      stdin: FILE_VALID,
      terminal: false,
    });

    const done = Either.getOrThrow(
      await h.run({ verdicts: { kind: "stdin" }, label: "stdin", by: "operator" }),
    );

    expect(done.kind).toBe("committed");
    expect(h.lines[0]).toContain("verdicts from stdin: q-keep, q-scope");
    expect(readFileSync(join(world.decisionFolder(AUTHORING_ID), "verdicts.json"), "utf8")).toBe(
      FILE_VALID,
    );
  });

  it("an unreadable stdin exits 12 before any session, as a refusal naming its remedy", async () => {
    seed("unused");
    const h = world.harness({ terminal: false });

    const result = await h.run({ verdicts: { kind: "stdin" }, label: "stdin", by: "operator" });

    const { error } = expectFailure(world, result, 12, world.headSha());
    expect(error.reason).toBe("verdicts-file");
    expect(error.message.startsWith("Decide refused: cannot read the verdicts from stdin")).toBe(
      true,
    );
    expect(error.message).toContain("pass its path");
    expectNoWriter(world, h);
  });

  it("--verdicts - with a terminal on stdin exits 12 before reading it", async () => {
    seed("unused");
    const h = world.harness({ terminal: true, stdin: FILE_VALID });

    const result = await h.run({ verdicts: { kind: "stdin" }, label: "stdin", by: "operator" });

    const { error } = expectFailure(world, result, 12, world.headSha());
    expect(error.reason).toBe("verdicts-file");
    expect(error.message).toBe(
      "Decide refused: --verdicts - reads the verdicts from a pipe; pipe a file or pass its path",
    );
    expectNoWriter(world, h);
  });
});

describe("decide --verdicts — a departing verdict revises the body", { timeout: 30_000 }, () => {
  it("lands keep-20 with the requirement and criterion rewritten and named in revised", async () => {
    const note = "Support asks for a fortnight of runs.";
    seed(fileOf([{ question: "q-keep", chosen: "keep-20", note }]));
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_DEPARTS)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.verdicts).toEqual([
      {
        question: "q-keep",
        chosen: "keep-20",
        recommendation: "keep-10",
        departs: true,
        why: note,
        revised: ["5.1", "AC-1"],
        by: { kind: "operator", name: OPERATOR },
      },
    ]);
    expect(done.open).toEqual(["q-scope", "q-names"]);
    const sidecar = sidecarJson() as unknown as SpecDocument;
    expect(sidecar.requirements[0]?.statement).toBe(
      "THE system SHALL keep the twenty most recent logs.",
    );
    // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
    expect(sidecar.acceptanceCriteria[0]).toMatchObject({ then: "twenty logs remain" });
    expect(sidecar.arbitratedQuestions[0]?.verdict).toMatchObject({
      chosen: "keep-20",
      why: note,
      revised: ["5.1", "AC-1"],
    });
    expect(done.diff).toContain("twenty most recent logs");
    expect(world.readRepoFile(SPEC_PATH)).toContain("twenty most recent logs");
  });
});

describe("decide --verdicts — a choice off the menu: other", { timeout: 30_000 }, () => {
  it("lands other with a note, every listed option abandoned", async () => {
    const note = "Name each log by its date and its phase.";
    seed(fileOf([{ question: "q-names", chosen: "other", note }]));
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_OTHER)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.verdicts).toMatchObject([
      { question: "q-names", chosen: "other", departs: true, why: note, revised: ["5.3"] },
    ]);
    const landed = arbitratedOf();
    expect(landed.map((q) => q.id)).toEqual(["q-names"]);
    expect(landed[0]?.verdict).toMatchObject({
      kind: "decided",
      chosen: "other",
      abandoned: ["by-date", "by-run"],
      why: note,
    });
    // The question keeps exactly its listed options: `other` is never added.
    expect(landed[0]?.options.map((o) => o.id)).toEqual(["by-date", "by-run"]);
    expect(openIds()).toEqual(["q-keep", "q-scope"]);
  });

  it("a null note exits 12 before any session", async () => {
    seed(fileOf([{ question: "q-names", chosen: "other", note: null }]));
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("verdicts-binding");
    expect(error.message).toContain("q-names");
    expect(error.message).toContain("by-date");
    expectNoWriter(world, h);
  });

  it("a writer that adds an option exits 5 after one resume, writing nothing", async () => {
    seed(
      fileOf([{ question: "q-names", chosen: "other", note: "Name each log by run and phase." }]),
    );
    const h = world.harness({
      runAnswers: [JSON.stringify(ANSWER_ADDS_OPTION)],
      resumeAnswers: [JSON.stringify(ANSWER_ADDS_OPTION)],
    });

    const { error } = expectFailure(world, await h.run(), 5, world.headSha());

    expect(error.tag).toBe("DecideDocumentError");
    expect(h.backend.runCalls).toHaveLength(1);
    expect(h.backend.resumeCalls).toHaveLength(1);
    expect(h.backend.resumeCalls[0]?.sessionId).toBe(WRITER_SESSION);
  });

  it("a writer that adds an option to a re-arbitrated question is refused naming its options, not its history", async () => {
    seed(
      fileOf([{ question: "q-names", chosen: "other", note: "Name each log by run and phase." }]),
      SPEC_NAMES_DECIDED,
    );
    const answer = JSON.stringify(ANSWER_REARBITRATE_ADDS_OPTION);
    const h = world.harness({ runAnswers: [answer], resumeAnswers: [answer] });

    const { error } = expectFailure(world, await h.run(), 5, world.headSha());

    expect(error.path).toBe("arbitratedQuestions[0].options");
    expect(error.message).toContain('"q-names" keeps its options (by-date, by-run)');
    expect(error.message).not.toContain("history");
    expect(h.backend.resumeCalls).toHaveLength(1);
  });
});

describe(
  "decide --verdicts — a verdict that restores the recommendation",
  { timeout: 30_000 },
  () => {
    it("lands after a departure that revised the body, restoring and naming 5.1; why is the rationale", async () => {
      seed(fileOf([{ question: "q-keep", chosen: "keep-10" }]), SPEC_KEEP_20_DECIDED);
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_RESTORE_KEEP)] });

      const done = Either.getOrThrow(await h.run());

      expect(done.verdicts).toEqual([
        {
          question: "q-keep",
          chosen: "keep-10",
          recommendation: "keep-10",
          departs: false,
          why: "Ten logs cover a week of runs and keep the directory small.",
          revised: ["5.1"],
          by: { kind: "operator", name: OPERATOR },
        },
      ]);
      const sidecar = sidecarJson() as unknown as SpecDocument;
      expect(sidecar.requirements[0]?.statement).toBe(
        "THE system SHALL keep the ten most recent logs.",
      );
      expect(arbitratedOf()[0]?.history.map((v) => v.chosen)).toEqual(["keep-20"]);
      expect(world.readRepoFile(SPEC_PATH)).toContain("ten most recent logs");
    });

    it("lands with revised [] after a departure that revised nothing", async () => {
      seed(fileOf([{ question: "q-keep", chosen: "keep-10" }]), SPEC_KEEP_20_UNREVISED);
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_RESTORE_UNREVISED)] });

      const done = Either.getOrThrow(await h.run());

      expect(done.verdicts).toMatchObject([{ question: "q-keep", departs: false, revised: [] }]);
    });

    it.each([
      {
        name: "names no section after a departure that revised the body",
        sidecar: SPEC_KEEP_20_DECIDED,
        answer: ANSWER_RESTORE_KEEP_UNNAMED,
        message: "name the body sections it restores",
      },
      {
        name: "names a section after a departure that revised nothing",
        sidecar: SPEC_KEEP_20_UNREVISED,
        answer: ANSWER_RESTORE_UNREVISED_NAMES,
        message: "revised nothing: its revised is []",
      },
    ])(
      "a writer that $name exits 5 after the corrective resume, writing nothing",
      async ({ sidecar, answer, message }) => {
        seed(fileOf([{ question: "q-keep", chosen: "keep-10" }]), sidecar);
        const h = world.harness({
          runAnswers: [JSON.stringify(answer)],
          resumeAnswers: [JSON.stringify(answer)],
        });

        const { error } = expectFailure(world, await h.run(), 5, world.headSha());

        expect(error.tag).toBe("DecideDocumentError");
        expect(error.path).toBe("arbitratedQuestions[0].verdict.revised");
        expect(error.message).toContain(message);
        expect(h.backend.resumeCalls).toHaveLength(1);
      },
    );
  },
);

describe("decide --verdicts — a writer's answer is checked", { timeout: 30_000 }, () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly verdicts: ReadonlyArray<{ question: string; chosen: string; note?: string | null }>;
    readonly answer: Json;
    readonly path: RegExp;
    readonly message?: string;
  }> = [
    {
      name: "a wrong option",
      verdicts: [{ question: "q-keep", chosen: "keep-20", note: "A fortnight of runs." }],
      answer: ANSWER_WRONG_OPTION,
      path: /^arbitratedQuestions\[0\]\.verdict\.chosen$/,
    },
    {
      name: "a moved question",
      verdicts: [{ question: "q-keep", chosen: "keep-10" }],
      answer: ANSWER_MOVES_NAMES,
      path: /^arbitratedQuestions\[1\]\.id$/,
      message: "q-names",
    },
    {
      name: "a body edit while no verdict departs",
      verdicts: [{ question: "q-keep", chosen: "keep-10" }],
      answer: ANSWER_EDITS_BODY,
      path: /^requirements/,
      message: "no verdict of the file departs",
    },
    {
      name: "an unloaded principle",
      verdicts: [{ question: "q-keep", chosen: "keep-10" }],
      answer: ANSWER_CITES_S12,
      path: /^arbitratedQuestions\[0\]\.verdict\.principles\[0\]$/,
      message: "S12",
    },
    {
      name: "a following verdict that fills revised",
      verdicts: [{ question: "q-keep", chosen: "keep-10" }],
      answer: ANSWER_FOLLOW_WITH_REVISED,
      path: /^arbitratedQuestions\[0\]\.verdict\.revised$/,
      message: "follows the recommendation",
    },
    {
      name: "a departing verdict that names no revised section",
      verdicts: [{ question: "q-keep", chosen: "keep-20", note: "A fortnight of runs." }],
      answer: ANSWER_DEPARTS_WITHOUT_REVISED,
      path: /^arbitratedQuestions\[0\]\.verdict\.revised$/,
      message: "departs from the recommendation",
    },
  ];

  it.each(CASES)(
    "$name resumes once, exits 5 naming the path, leaves the tree and HEAD, records a failure",
    async ({ verdicts, answer, path, message }) => {
      const { md } = seed(fileOf(verdicts));
      const head = world.headSha();
      const h = world.harness({
        runAnswers: [JSON.stringify(answer)],
        resumeAnswers: [JSON.stringify(answer)],
      });
      playTranscripts(h);

      const { error } = expectFailure(world, await h.run({ records: RECORDS_ON }), 5, head);

      expect(error.tag).toBe("DecideDocumentError");
      expect(error.path).toMatch(path);
      expect(error.message).toContain("rejected twice");
      if (message !== undefined) expect(error.message).toContain(message);
      expect(h.backend.runCalls).toHaveLength(1);
      expect(h.backend.resumeCalls).toHaveLength(1);
      expect(h.warnings[0]).toContain("refused");
      expect(world.readRepoFile(SPEC_PATH)).toBe(md);

      const manifest = JSON.parse(
        world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
      ) as Json;
      expect(manifest).toMatchObject({
        mode: "verdicts",
        outcome: "failed",
        commit: null,
        arbitrated: 0,
        questions: verdicts.map((v) => v.question),
        requestedModel: "claude-sonnet-5-5",
      });
    },
  );

  it("a refused first answer then a good one lands, after one corrective resume", async () => {
    seed(fileOf([{ question: "q-keep", chosen: "keep-20", note: "A fortnight of runs." }]));
    const h = world.harness({
      runAnswers: [JSON.stringify(ANSWER_WRONG_OPTION)],
      resumeAnswers: [JSON.stringify(ANSWER_DEPARTS)],
    });

    const done = Either.getOrThrow(await h.run({ records: RECORDS_ON }));

    expect(done.kind).toBe("committed");
    expect(h.backend.runCalls).toHaveLength(1);
    expect(h.backend.resumeCalls).toHaveLength(1);
    const folder = world.decisionFolder(AUTHORING_ID);
    const retryPrompt = readFileSync(join(folder, "retry-prompt.md"), "utf8");
    expect(h.backend.resumeCalls[0]?.prompt).toBe(retryPrompt);
    expect(h.backend.resumeCalls[0]?.options.outputJsonlPath).toBe(
      join(folder, "retry-output.jsonl"),
    );
    const refusal = /^Refusal: (.*)$/m.exec(retryPrompt)?.[1] ?? "";
    expect(refusal).toContain("arbitratedQuestions[0].verdict.chosen");
    expect(retryPrompt).toBe(buildDecideRetryPrompt("headless", refusal));
    expect(h.warnings[0]).toContain("resuming the session once");
    const manifest = JSON.parse(
      world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
    ) as Json;
    expect(manifest).toMatchObject({ outcome: "committed", arbitrated: 1, departed: 1 });
    expect(world.git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH]).split("\n")).toContain(
      `decision/${AUTHORING_ID}/01/retry-prompt.md`,
    );
  });
});

describe(
  "decide --verdicts — a bad file is refused before any session",
  { timeout: 30_000 },
  () => {
    const CASES: ReadonlyArray<{ name: string; text: string; message: string[] }> = [
      {
        name: "text that is not JSON",
        text: FILE_NOT_JSON,
        message: ["verdicts.json is not a valid verdicts file"],
      },
      { name: "a missing $schema", text: FILE_NO_SCHEMA, message: ["$schema", "no $schema"] },
      {
        name: "another format's $schema",
        text: FILE_WRONG_FORMAT,
        message: ["$schema", "decide-verdicts"],
      },
      {
        name: "another release's $schema",
        text: FILE_OTHER_RELEASE,
        message: ["$schema", OTHER_RELEASE_URL],
      },
      { name: "an unknown key", text: FILE_EXTRA_KEY, message: ["reason"] },
      {
        name: "an empty verdicts list",
        text: FILE_EMPTY_VERDICTS,
        message: ["verdicts: the list is empty — give at least one verdict"],
      },
      { name: "a missing note", text: FILE_NO_NOTE, message: ["verdicts[0].note"] },
      { name: "an empty note", text: FILE_EMPTY_NOTE, message: ["verdicts[0].note"] },
    ];

    it.each(CASES)(
      "$name exits 12, naming where, and writes nothing",
      async ({ text, message }) => {
        seed(text);
        const h = world.harness();

        const { error } = expectFailure(world, await h.run(), 12, world.headSha());

        expect(error.reason).toBe("verdicts-file");
        expect(error.message.startsWith("Decide refused: ")).toBe(true);
        for (const part of message) expect(error.message).toContain(part);
        expectNoWriter(world, h);
      },
    );

    it("a file that cannot be read exits 12, naming its path", async () => {
      seed("unused");
      const h = world.harness();

      const { error } = expectFailure(
        world,
        await h.run({ verdicts: { kind: "file", path: "missing/verdicts.json" } }),
        12,
        world.headSha(),
      );

      expect(error.reason).toBe("verdicts-file");
      expect(error.message).toContain("missing/verdicts.json");
      expectNoWriter(world, h);
    });
  },
);

describe("decide --verdicts — a file that does not fit the artifact", { timeout: 30_000 }, () => {
  const CASES: ReadonlyArray<{ name: string; text: string; message: string[] }> = [
    {
      name: "another spec",
      text: fileOf([{ question: "q-keep", chosen: "keep-10" }], OTHER_SPEC_PATH),
      message: [OTHER_SPEC_PATH, SPEC_PATH],
    },
    {
      name: "an unknown question",
      text: fileOf([{ question: "q-zzz", chosen: "keep-10" }]),
      message: ["q-zzz", "q-keep, q-scope, q-names"],
    },
    {
      name: "a question named twice",
      text: fileOf([
        { question: "q-keep", chosen: "keep-10" },
        { question: "q-keep", chosen: "keep-10" },
      ]),
      message: ["q-keep twice"],
    },
    {
      name: "an option the question does not list",
      text: fileOf([{ question: "q-keep", chosen: "keep-30" }]),
      message: ["keep-30", "keep-10, keep-20, or other"],
    },
    {
      name: "a departure with a null note",
      text: fileOf([{ question: "q-keep", chosen: "keep-20", note: null }]),
      message: ["q-keep", "keep-10", "needs a note"],
    },
  ];

  it.each(CASES)("$name exits 12 before any session", async ({ text, message }) => {
    seed(text);
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("verdicts-binding");
    for (const part of message) expect(error.message).toContain(part);
    expectNoWriter(world, h);
  });
});

describe("decide --verdicts — preconditions as interactive decide's", { timeout: 30_000 }, () => {
  it("refuses an Approved spec, naming phax artifact reopen", async () => {
    seed(
      FILE_VALID,
      SPEC,
      SPEC_FRONTMATTER.replace("Draft", "Approved").replace(
        "---\n",
        "---\napproved:\n  date: 2026-10-25\n  baseline: abc1234\n",
      ),
    );
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("not-draft");
    expect(error.message).toBe(
      `Decide refused: ${SPEC_PATH} is Approved — reopen it first with \`phax artifact reopen ${SPEC_PATH}\``,
    );
    expectNoWriter(world, h);
  });

  it("refuses a sidecar the body diverged from", async () => {
    const { md } = seed(FILE_VALID);
    world.writeRepoFile(SPEC_PATH, `${md}\nA stray paragraph.\n`);
    world.commitAll("edit by hand");
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("sidecar");
    expect(error.message).toContain("differs from its sidecar");
    expectNoWriter(world, h);
  });

  it("waits for migration: an older live sidecar refuses decide, naming migrate-documents", async () => {
    seed(FILE_VALID);
    const older = "docs/specs/2609281200-log-format.md";
    world.writeRepoFile(older, `${SPEC_FRONTMATTER}# Log format\n`);
    world.writeRepoFile(
      older.replace(/\.md$/, ".json"),
      JSON.stringify({ $schema: schemaUrl("spec-document", "0.17.0"), kind: "spec" }),
    );
    world.commitAll("older spec");
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.message).toContain("docs/specs/2609281200-log-format.json");
    expect(error.message).toContain("phax artifact migrate-documents");
    expectNoWriter(world, h);
  });

  it("refuses an uncommitted change on the write set", async () => {
    const { md } = seed(FILE_VALID);
    world.writeRepoFile(SPEC_PATH, `${md}\nNot committed.\n`);
    const h = world.harness();

    const result = await h.run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "dirty" });
      expect((result.left as { message: string }).message).toContain("has uncommitted changes");
    }
    expect(world.porcelain()).toBe(`M ${SPEC_PATH}`);
    expectNoWriter(world, h);
  });

  it("refuses a --doctrine it cannot read", async () => {
    seed(FILE_VALID);
    const h = world.harness();

    const { error } = expectFailure(
      world,
      await h.run({ doctrinePath: "docs/missing-doctrine.md" }),
      12,
      world.headSha(),
    );

    expect(error.reason).toBe("doctrine");
    expect(error.message).toContain("cannot read doctrine file docs/missing-doctrine.md");
    expectNoWriter(world, h);
  });

  it("refuses without a committing identity", async () => {
    seed(FILE_VALID);
    world.git(["config", "--local", "--unset", "user.name"]);
    const h = world.harness();

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("operator");
    expect(error.message).toContain("git user.name");
    expectNoWriter(world, h);
  });

  it("refuses an effort outside low, medium and high, naming the allowed values", async () => {
    seed(FILE_VALID);
    const h = world.harness();

    const { error } = expectFailure(world, await h.run({ effort: "xhigh" }), 12, world.headSha());

    expect(error.reason).toBe("model");
    expect(error.message).toContain("--effort xhigh");
    expect(error.message).toContain("low, medium, high");
    expectNoWriter(world, h);
  });

  it("checks the file before the arbiter: a bad file and no --by learns only the file problem", async () => {
    seed(FILE_NOT_JSON);
    const h = world.harness({ terminal: false });

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("verdicts-file");
  });
});

describe(
  "decide --verdicts — naming an arbitrated question re-arbitrates it",
  { timeout: 30_000 },
  () => {
    it("gives it the new verdict, its history ends with the previous one, the others are byte-identical", async () => {
      const note = "Support asks for a fortnight of runs.";
      seed(fileOf([{ question: "q-keep", chosen: "keep-20", note }]), SPEC_KEEP_DECIDED);
      const before = sidecarJson();
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_REARBITRATE_KEEP_20)] });

      const done = Either.getOrThrow(await h.run());

      expect(done.verdicts).toMatchObject([{ question: "q-keep", chosen: "keep-20", why: note }]);
      expect(done.open).toEqual(["q-scope", "q-names"]);
      const after = sidecarJson();
      const [keep] = arbitratedOf(after);
      expect(keep?.verdict).toMatchObject({
        chosen: "keep-20",
        why: note,
        by: { kind: "operator", name: OPERATOR },
        at: NOW,
      });
      expect(keep?.history).toEqual([PREVIOUS_KEEP]);
      expect(after["openQuestions"]).toEqual(before["openQuestions"]);
      expect(openIds(after)).toEqual(["q-scope", "q-names"]);
    });

    it("keeps the previous verdict in history even when the choice is the same", async () => {
      seed(fileOf([{ question: "q-keep", chosen: "keep-10" }]), SPEC_KEEP_DECIDED);
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_REARBITRATE_SAME)] });

      Either.getOrThrow(await h.run());

      const [keep] = arbitratedOf();
      expect(keep?.verdict).toMatchObject({
        chosen: "keep-10",
        why: "Ten logs cover a week of runs and keep the directory small.",
        by: { kind: "operator", name: OPERATOR },
      });
      expect(keep?.history).toEqual([PREVIOUS_KEEP]);
      expect(h.lines[1]).toContain("claude-sonnet-5-5");
      // The prompt told the writer the current verdict is replaced.
      const prompt = readFileSync(join(world.decisionFolder(AUTHORING_ID), "prompt.md"), "utf8");
      expect(prompt).toContain("being re-arbitrated");
      expect(prompt).toContain("Grace Hopper");
    });
  },
);

describe("decide --verdicts — who decides", { timeout: 30_000 }, () => {
  it("refuses --by machine:roadmap-loop, naming --by operator", async () => {
    seed(FILE_VALID);
    const h = world.harness();

    const { error } = expectFailure(
      world,
      await h.run({ by: "machine:roadmap-loop" }),
      12,
      world.headSha(),
    );

    expect(error.reason).toBe("by-machine");
    expect(error.message).toContain("machine:roadmap-loop");
    expect(error.message).toContain("`--by operator`");
    expectNoWriter(world, h);
  });

  it.each([
    { by: "bob", reason: "by" },
    { by: "machine:Bad_Grant", reason: "by" },
  ])(
    "refuses --by $by with the verdicts remedy, not the approve parser's",
    async ({ by, reason }) => {
      seed(FILE_VALID);
      const h = world.harness();

      const { error } = expectFailure(world, await h.run({ by }), 12, world.headSha());

      expect(error.reason).toBe(reason);
      expect(error.message).toBe(
        `Decide refused: --by ${by} — a verdict always comes from the operator; pass \`--by operator\``,
      );
      expect(error.message).not.toContain("machine:<grant>");
      expectNoWriter(world, h);
    },
  );

  it("refuses no --by and no terminal", async () => {
    seed(FILE_VALID);
    const h = world.harness({ terminal: false });

    const { error } = expectFailure(world, await h.run(), 12, world.headSha());

    expect(error.reason).toBe("no-by");
    expect(error.message).toBe(
      "Decide refused: no terminal and no --by — pass `--by operator`: a verdict always comes from the operator",
    );
    expectNoWriter(world, h);
  });

  it.each([
    { name: "--by operator without a terminal", by: "operator", terminal: false },
    { name: "a terminal without --by", by: undefined, terminal: true },
  ])("$name records the operator by git user.name", async ({ by, terminal }) => {
    seed(FILE_VALID);
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)], terminal });

    const done = Either.getOrThrow(await h.run({ by }));

    expect(done.verdicts.map((v) => v.by)).toEqual([
      { kind: "operator", name: OPERATOR },
      { kind: "operator", name: OPERATOR },
    ]);
    expect(arbitratedOf().map((q) => (q.verdict as SpecVerdict & { by: unknown }).by)).toEqual([
      { kind: "operator", name: OPERATOR },
      { kind: "operator", name: OPERATOR },
    ]);
    expect(lastCommitMessage()).toContain(`Decided-By: operator (${OPERATOR})`);
  });
});

describe("decide --verdicts — the writer's session and model", { timeout: 30_000 }, () => {
  it("resumes the kept authoring session on its own provider, with no --model", async () => {
    seed(FILE_VALID);
    world.keepAuthoringSession(AUTHORING_ID);
    const h = world.harness({ resumeAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.session).toBe("resumed-authoring");
    expect(h.lines[0]).toBe(
      "decide spec log-rotation — verdicts from verdicts.json: q-keep, q-scope — headless, resumed authoring session",
    );
    expect(h.backend.runCalls).toEqual([]);
    expect(h.backend.resumeCalls).toHaveLength(1);
    // The retried session is the one resumed.
    expect(h.backend.resumeCalls[0]?.sessionId).toBe(KEPT_SESSION);
    expect(h.backend.resumeCalls[0]?.options).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      readOnly: true,
    });
  });

  it("resumes the first session when the authoring was not retried", async () => {
    seed(FILE_VALID);
    world.keepAuthoringSession(AUTHORING_ID, { retrySessionId: null });
    const h = world.harness({ resumeAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    Either.getOrThrow(await h.run());

    expect(h.backend.resumeCalls[0]?.sessionId).toBe(KEPT_FIRST_SESSION);
  });

  it.each([
    { name: "another provider", keep: { provider: "codex-cli" } },
    { name: "another checkout", keep: { cwd: "/somewhere/else" } },
  ])("starts a new session for a kept session from $name", async ({ keep }) => {
    seed(FILE_VALID);
    world.keepAuthoringSession(AUTHORING_ID, keep);
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.session).toBe("new");
    expect(h.lines[0]).toContain("headless, new session");
    expect(h.backend.resumeCalls).toEqual([]);
    expect(h.backend.runCalls).toHaveLength(1);
  });

  it("starts a new session when session.json does not decode", async () => {
    seed(FILE_VALID);
    const folder = join(world.stateRoot, "authoring", AUTHORING_ID);
    world.keepAuthoringSession(AUTHORING_ID);
    writeFileSync(join(folder, "session.json"), "{ not json");
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run());

    expect(done.session).toBe("new");
  });

  it("routes --model gpt-6-luna to codex-cli once enabled, in a new session", async () => {
    seed(FILE_VALID);
    world.keepAuthoringSession(AUTHORING_ID);
    const codexEnabled: ProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
      },
    };
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(
      await h.run({ model: "gpt-6-luna", providerConfig: codexEnabled }),
    );

    expect(done).toMatchObject({
      session: "new",
      provider: "codex-cli",
      model: "gpt-6-luna",
      requestedModel: "gpt-6-luna",
      modelSource: "flag",
      effortSource: "built-in default",
    });
    expect(h.backend.resumeCalls).toEqual([]);
    expect(h.backend.runCalls[0]?.options).toMatchObject({
      provider: "codex-cli",
      model: "gpt-6-luna",
    });
    expect(h.lines[1]).toBe(
      "model      gpt-6-luna / medium (model flag, effort built-in default) on codex-cli",
    );
    expect(lastCommitMessage()).toContain("(gpt-6-luna / medium on codex-cli)");
  });

  it("resumes a kept codex-cli session when routing selects codex-cli", async () => {
    seed(FILE_VALID);
    world.keepAuthoringSession(AUTHORING_ID, { provider: "codex-cli" });
    const codexEnabled: ProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
      },
    };
    const h = world.harness({ resumeAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(
      await h.run({ model: "gpt-6-luna", providerConfig: codexEnabled }),
    );

    expect(done.session).toBe("resumed-authoring");
    expect(h.backend.resumeCalls[0]?.options.provider).toBe("codex-cli");
  });

  it("refuses a model routing sends to mistral-vibe before any session, naming --model", async () => {
    seed(FILE_VALID);
    const vibeEnabled: ProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
      },
    };
    const h = world.harness();

    const { error } = expectFailure(
      world,
      await h.run({ model: "claude-sonnet-4-6", providerConfig: vibeEnabled }),
      12,
      world.headSha(),
    );

    expect(error.reason).toBe("model");
    expect(error.message).toBe(
      "Decide refused: routing sends the writer's model claude-sonnet-4-6 to mistral-vibe (phax-mistral-medium-3.5-medium), which ignores read-only — pass --model with a Claude Code or Codex model",
    );
    expectNoWriter(world, h);
  });

  it("runs --model and --effort as given, naming both as flags", async () => {
    seed(FILE_VALID);
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run({ model: "claude-opus-5-5", effort: "high" }));

    expect(done).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
      modelSource: "flag",
      effortSource: "flag",
    });
    expect(h.lines[1]).toBe("model      claude-opus-5-5 / high (flag) on claude-code");
  });

  it("runs a model with no equivalent on the concrete model routing chose, naming both", async () => {
    seed(FILE_VALID);
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      requestedModelNormalization: { "mystery-1": "openai-gpt" },
    };
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(await h.run({ model: "mystery-1", routing }));

    expect(done.requestedModel).toBe("mystery-1");
    expect(done.model).toMatch(/^claude-sonnet/);
    expect(h.backend.runCalls[0]?.options.model).toBe(done.model);
    expect(h.lines[1]).toBe(
      `model      ${done.model} / medium (model flag, effort built-in default) on claude-code, requested mystery-1`,
    );
  });
});

describe(
  "decide --verdicts — what can go wrong after the writer started",
  { timeout: 30_000 },
  () => {
    it("a usage limit exits 8 with nothing written or committed, and records a failure", async () => {
      seed(FILE_VALID);
      world.keepAuthoringSession(AUTHORING_ID);
      const h = world.harness();
      h.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });

      const { error } = expectFailure(
        world,
        await h.run({ records: RECORDS_ON }),
        8,
        world.headSha(),
      );

      expect(error.tag).toBe("UsageLimitError");
      expect(h.backend.resumeCalls).toHaveLength(1);
      const manifest = JSON.parse(
        world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
      ) as Json;
      expect(manifest).toMatchObject({ mode: "verdicts", outcome: "failed", commit: null });
    });

    it("a limit on the corrective resume is not retried either", async () => {
      seed(fileOf([{ question: "q-keep", chosen: "keep-20", note: "A fortnight of runs." }]));
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_WRONG_OPTION)] });
      h.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });

      expectFailure(world, await h.run(), 8, world.headSha());

      expect(h.backend.resumeCalls).toHaveLength(1);
    });

    it("a spec edited while the writer ran exits 12, keeps the edit, makes no commit", async () => {
      const { md } = seed(FILE_VALID);
      const head = world.headSha();
      world.keepAuthoringSession(AUTHORING_ID);
      const h = world.harness({ resumeAnswers: [JSON.stringify(ANSWER_FOLLOW)] });
      h.backend.setOnResumeAgent(() => {
        writeFileSync(join(world.repoDir, SPEC_PATH), `${md}\nEdited meanwhile.\n`);
      });

      const result = await h.run();

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "DecideRefusedError", reason: "changed" });
      }
      expect(world.readRepoFile(SPEC_PATH)).toBe(`${md}\nEdited meanwhile.\n`);
      expect(world.headSha()).toBe(head);
      expect(world.porcelain()).toBe(`M ${SPEC_PATH}`);
    });

    it("a failed commit exits 12, leaving both files written but uncommitted", async () => {
      seed(FILE_VALID);
      const head = world.headSha();
      const hook = join(world.repoDir, ".git", "hooks", "pre-commit");
      writeFileSync(hook, "#!/bin/sh\nexit 1\n");
      chmodSync(hook, 0o755);
      const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

      const result = await h.run({ records: RECORDS_ON });

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "ArtifactCommitFailedError" });
      }
      expect(world.headSha()).toBe(head);
      expect(world.readRepoFile(SPEC_PATH)).toContain("## 9b. Arbitrated questions");
      expect(world.porcelain().split("\n").toSorted()).toEqual([
        `M  ${SPEC_JSON}`,
        `M  ${SPEC_PATH}`,
      ]);
      const manifest = JSON.parse(
        world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
      ) as Json;
      expect(manifest).toMatchObject({ outcome: "failed", commit: null });
    });
  },
);

describe("decide --verdicts — the decision record", { timeout: 30_000 }, () => {
  it("explains a committed decide: mode verdicts, the file as given, two arbitrated, one departing", async () => {
    const note = "Support asks for a fortnight of runs.";
    const text = fileOf([
      { question: "q-keep", chosen: "keep-20", note },
      { question: "q-scope", chosen: "per-run" },
    ]);
    seed(text);
    const head = world.headSha();
    world.keepAuthoringSession(AUTHORING_ID);
    const [keep, scope, names] = (SPEC.document as SpecDocument).openQuestions;
    if (keep === undefined || scope === undefined || names === undefined)
      throw new Error("fixture");
    const answer = {
      ...(ANSWER_DEPARTS as Json),
      openQuestions: [names],
      arbitratedQuestions: [
        writerDecided(keep, "keep-20", ["5.1", "AC-1"]),
        writerDecided(scope, "per-run", []),
      ],
    };
    const h = world.harness({ resumeAnswers: [JSON.stringify(answer)] });
    playTranscripts(h);

    const done = Either.getOrThrow(await h.run({ records: RECORDS_ON }));

    expect(done.record).toMatchObject({
      kind: "written",
      key: `decision/${AUTHORING_ID}/01`,
      shape: "full",
    });
    const outcome = await Effect.runPromise(
      explainRecord({
        sha: done.commit.hash,
        repoRoot: world.repoDir,
        records: RECORDS_ON,
        publishRemote: "origin",
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
    );
    if (outcome.kind !== "found-decision") {
      throw new Error(`expected found-decision: ${outcome.kind}`);
    }
    expect(outcome.record.manifest).toMatchObject({
      kind: "decision",
      decisionId: `${AUTHORING_ID}/01`,
      artifact: SPEC_PATH,
      artifactKind: "spec",
      mode: "verdicts",
      session: "resumed-authoring",
      doctrine: [{ kind: "skill", name: "phax-decide-spec", source: "bundled" }],
      questions: ["q-keep", "q-scope"],
      arbitrated: 2,
      departed: 1,
      sourceSha: head,
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      requestedModel: "claude-sonnet-5-5",
      effort: "medium",
      outcome: "committed",
      commit: done.commit.hash,
      usage: { available: true, usage: { provider: "claude-code", outputTokens: 700 } },
    });
    expect(outcome.record.files).toEqual([
      "body.diff",
      "document.json",
      "output.jsonl",
      "prompt.md",
      "verdicts.json",
    ]);

    const branchFile = (name: string) =>
      world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/${name}`]);
    expect(branchFile("verdicts.json")).toBe(text);
    expect(branchFile("document.json")).toBe(world.readRepoFile(SPEC_JSON));
    expect(branchFile("body.diff")).toContain("twenty most recent logs");
    expect(branchFile("prompt.md")).toContain("verdicts a person has already made");
    // No session id reaches a record: the kept ones and the writer's own.
    const paths = world.git(["ls-tree", "-r", "--name-only", RECORDS_BRANCH]).trim().split("\n");
    for (const path of paths) {
      const blob = world.git(["show", `${RECORDS_BRANCH}:${path}`]);
      for (const id of [KEPT_SESSION, KEPT_FIRST_SESSION, WRITER_SESSION, RETRY_SESSION]) {
        expect(blob, path).not.toContain(id);
      }
    }
  });

  it("a requested model that routing replaced is recorded beside the concrete one", async () => {
    seed(FILE_VALID);
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      requestedModelNormalization: { "mystery-1": "openai-gpt" },
    };
    const h = world.harness({ runAnswers: [JSON.stringify(ANSWER_FOLLOW)] });

    const done = Either.getOrThrow(
      await h.run({ model: "mystery-1", routing, records: RECORDS_ON }),
    );

    const manifest = JSON.parse(
      world.git(["show", `${RECORDS_BRANCH}:decision/${AUTHORING_ID}/01/record.json`]),
    ) as Json;
    expect(manifest).toMatchObject({ model: done.model, requestedModel: "mystery-1" });
  });
});
