import { Effect, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { readCacheEntry } from "../../src/app/planCacheStore.js";
import { parseHandAuthoredQuestions } from "../../src/domain/artifact/questions.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
import { structureFindings } from "../../src/domain/plan/lint.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { type PlanDocument, projectExtractedPlan } from "../../src/schemas/planDocument.js";
import type { OpenQuestion, PlanArbitratedQuestion } from "../../src/schemas/questions.js";
import {
  EXTRACT_EFFORT,
  EXTRACT_MODEL,
  NOW,
  OPERATOR,
  RECORDS_BRANCH,
  committed,
  RECORDS_ON,
  SPEC_FRONTMATTER,
  expectFailure,
  expectNoWriter,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";
import { HAND_SPEC_MD as FIXTURE_HAND_SPEC_MD } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Real-git acceptance for `phax artifact decide --verdicts` on a headless
// plan and on a hand-authored spec (spec artifact-decide-verdicts §5, §8). The
// writer session and the terminal are fakes; git and the filesystem are real.
// Every spec, plan, verdicts file and operator is made up.

const world = useDecideRepo();

type Json = Record<string, unknown>;

const VERDICTS = "verdicts.json";

function fileOf(
  artifact: string,
  verdicts: ReadonlyArray<{ question: string; chosen: string; note?: string | null }>,
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

// ── The headless plan ─────────────────────────────────────────────────────

const PLAN_ID = "2610250930-log-rotation";
const PLAN = `docs/plans/${PLAN_ID}-plan.md`;
const PLAN_JSON = `docs/plans/${PLAN_ID}-plan.json`;
const SOURCE_SPEC = "docs/specs/2610250800-log-rotation.md";
const PLAN_FRONTMATTER = `---\nstatus: Draft\nsource-spec: ${SOURCE_SPEC}\ncompletes-spec: false\n---\n`;

const Q1: OpenQuestion = {
  id: "Q1",
  question: "Does the store rotate in one pass or two?",
  options: [
    { id: "one-pass", label: "One pass", abandons: "a cheap dry run" },
    { id: "two-pass", label: "Two passes", abandons: "a short run" },
  ],
  recommendation: "one-pass",
  rationale: "One pass keeps the store simple.",
};

const Q2: OpenQuestion = {
  id: "Q2",
  question: "Does the command live beside the store or apart?",
  options: [
    { id: "beside", label: "Beside", abandons: "a small command file" },
    { id: "apart", label: "Apart", abandons: "one file to read" },
  ],
  recommendation: "apart",
  rationale: "A command file stays thin when the store is elsewhere.",
};

function planPhase(id: string): PlanDocument["phases"][number] {
  return {
    id,
    title: `Step ${id}`,
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [`src/${id}.ts`],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: ["Do it."],
    boundaryContracts: null,
    testStrategy: [
      {
        guarantee: "The step does its work",
        size: "small",
        technique: "example",
        oracle: "the step's output",
        loop: "in-phase",
        criterion: null,
      },
    ],
    implementationOrder: ["Do it."],
    excludedScope: [],
    verification: "The `standard` gate profile.",
    expectedHandoff: "Nothing.",
    assignmentReason: null,
    model: "claude-sonnet-5-5",
    effort: "medium",
  };
}

function planDocument(
  open: readonly OpenQuestion[],
  decided: readonly PlanArbitratedQuestion[] = [],
): PlanDocument {
  return {
    kind: "plan",
    sourceSpec: SOURCE_SPEC,
    completesSpec: false,
    run: { shortName: "log-rotation", title: "Log rotation", requiredCommands: [] },
    preamble: {
      summary: "Two phases: the rotation, then its docs.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
      openQuestions: [...open],
      arbitratedQuestions: [...decided],
    },
    phases: [planPhase("phase-01"), planPhase("phase-02")],
  };
}

function seedPlan(verdictsText: string): void {
  const doc = planDocument([Q1, Q2]);
  world.writeRepoFile(PLAN, PLAN_FRONTMATTER + renderPlanBody(doc));
  world.writeRepoFile(PLAN_JSON, serializeSidecar({ kind: "plan", document: doc }));
  world.writeRepoFile(VERDICTS, verdictsText);
  world.commitAll();
}

function planAnswer(phase: string, lineage: Partial<PlanDocument> = {}): string {
  const decided: PlanArbitratedQuestion = {
    ...Q1,
    verdict: {
      kind: "decided",
      chosen: "one-pass",
      abandoned: ["two-pass"],
      why: "the writer's own reason",
      advocate: "two passes allow a dry run",
      principles: ["P1"],
      reversibility: "cheap",
      by: { kind: "operator", name: "Writer" },
      at: "2020-01-01T00:00:00Z",
      revised: [],
      phase,
    },
    history: [],
  };
  return JSON.stringify({
    $schema: currentSchemaUrl("plan-document"),
    ...planDocument([Q2], [decided]),
    ...lineage,
  });
}

describe("decide --verdicts — a plan stays executable", { timeout: 30_000 }, () => {
  it("lands Q1 with a phase of the plan, keeps Q2 open and the lineage, and seeds the extraction cache", async () => {
    seedPlan(fileOf(PLAN, [{ question: "Q1", chosen: "one-pass" }]));
    // The writer rewrites the lineage: phax restores it from the original.
    const answer = planAnswer("phase-02", {
      sourceSpec: "docs/specs/2610250900-elsewhere.md",
      completesSpec: true,
    });
    const h = world.harness({ runAnswers: [answer] });

    const done = committed(await h.run({ path: PLAN }));

    expect(done).toMatchObject({
      kind: "committed",
      paths: [PLAN, PLAN_JSON],
      open: ["Q2"],
      decisionId: `${PLAN_ID}/01`,
    });
    expect(done.commit.subject).toBe("docs(plans): decide log-rotation Q1");

    const sidecar = JSON.parse(world.readRepoFile(PLAN_JSON)) as {
      sourceSpec: unknown;
      completesSpec: unknown;
      preamble: {
        openQuestions: Array<{ id: string }>;
        arbitratedQuestions: PlanArbitratedQuestion[];
      };
    };
    expect([sidecar.sourceSpec, sidecar.completesSpec]).toEqual([SOURCE_SPEC, false]);
    expect(sidecar.preamble.openQuestions.map((q) => q.id)).toEqual(["Q2"]);
    expect(sidecar.preamble.arbitratedQuestions[0]?.verdict).toMatchObject({
      chosen: "one-pass",
      phase: "phase-02",
      why: "One pass keeps the store simple.",
      by: { kind: "operator", name: OPERATOR },
      at: NOW,
    });
    const md = world.readRepoFile(PLAN);
    expect(md.startsWith(PLAN_FRONTMATTER)).toBe(true);
    expect(structureFindings(md)).toEqual([]);
    expect(world.headFiles()).toEqual([PLAN_JSON, PLAN]);
    expect(world.porcelain()).toBe("");

    // The re-rendered plan's projection is seeded: no extraction session runs.
    const fs = makeRootedNodeFileSystemLayer(world.repoDir);
    const cached = await Effect.runPromise(
      readCacheEntry(world.stateRoot, planCacheKey(md, EXTRACT_MODEL, EXTRACT_EFFORT)).pipe(
        Effect.provide(fs),
      ),
    );
    const { $schema: _schema, ...landed } = sidecar as unknown as Record<string, unknown>;
    expect(Option.getOrNull(cached)).toEqual(
      projectExtractedPlan({ version: 1, ...(landed as unknown as PlanDocument) }),
    );
    const extractor = makeFakeBackend();
    const loaded = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN,
        model: EXTRACT_MODEL,
        effort: EXTRACT_EFFORT,
        stateRoot: world.stateRoot,
        nowIso: NOW,
      }).pipe(Effect.provide(Layer.mergeAll(fs, extractor.layer))),
    );
    expect(loaded.plan.phases.map((p) => p.id)).toEqual(["phase-01", "phase-02"]);
    expect(extractor.impl.completeCalls).toEqual([]);

    // The writer was asked for a plan document, with its phase.
    const sent = h.backend.runCalls[0]?.prompt ?? "";
    expect(sent).toContain("# phax artifact decide --verdicts — plan");
    expect(sent).toContain("- phase: the id of the plan phase the verdict bears on;");
    expect(sent).toContain("Decide a plan (bundled)");
  });

  it("a verdict naming a phase the plan lacks exits 5, naming the path", async () => {
    seedPlan(fileOf(PLAN, [{ question: "Q1", chosen: "one-pass" }]));
    const bad = planAnswer("phase-09");
    const h = world.harness({ runAnswers: [bad], resumeAnswers: [bad] });

    const { error } = expectFailure(world, await h.run({ path: PLAN }), 5, world.headSha());

    expect(error.tag).toBe("DecideDocumentError");
    expect(error.path).toContain("phase");
    expect(error.message).toContain("phase-09");
    expect(h.backend.resumeCalls).toHaveLength(1);
  });
});

// ── The hand-authored spec ────────────────────────────────────────────────

const HAND = "docs/specs/2610250900-log-retention.md";
const HAND_ID = "2610250900-log-retention";

// The fixture hand-authored spec, with the frontmatter a spec file requires.
const HAND_SPEC_MD = FIXTURE_HAND_SPEC_MD.replace(
  "date: 2026-10-25\n---",
  "date: 2026-10-25\naudience: maintainers\nscope: logs\n---",
);

function seedHand(verdictsText: string, md = HAND_SPEC_MD): void {
  world.writeRepoFile(HAND, md);
  world.writeRepoFile(VERDICTS, verdictsText);
  world.commitAll();
}

function handAnswer(
  chosen: string,
  options: { revised?: string[]; markdown?: string } = {},
): string {
  return JSON.stringify({
    $schema: currentSchemaUrl("hand-decision-answer"),
    kind: "spec",
    decisions: [
      {
        id: "Q1",
        verdict: {
          kind: "decided",
          chosen,
          abandoned: ["keep-10", "keep-20"].filter((id) => id !== chosen),
          why: "the writer's own reason",
          advocate: "the other option keeps more logs",
          principles: ["S1"],
          reversibility: "cheap",
          by: { kind: "operator", name: "Writer" },
          at: "2020-01-01T00:00:00Z",
          revised: options.revised ?? [],
        },
      },
    ],
    markdown: options.markdown ?? HAND_SPEC_MD,
  });
}

describe(
  "decide --verdicts — a hand-authored spec is decided in place",
  { timeout: 30_000 },
  () => {
    it("moves Q1 to the arbitrated section with its Decision block and one log entry; Q2 stays open; HEAD holds that file alone", async () => {
      seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]));
      const h = world.harness({ runAnswers: [handAnswer("keep-10")] });

      const done = committed(await h.run({ path: HAND }));

      expect(done).toMatchObject({
        kind: "committed",
        path: HAND,
        paths: [HAND],
        status: "Draft",
        open: ["Q2"],
        decisionId: `${HAND_ID}/01`,
      });
      expect(done.verdicts).toMatchObject([
        {
          question: "Q1",
          chosen: "keep-10",
          departs: false,
          revised: [],
          why: "ten logs cover a week of runs\n\nA longer history costs disk and nobody reads it.",
        },
      ]);
      expect(done.commit.subject).toBe("docs(specs): decide log-retention Q1");

      const md = world.readRepoFile(HAND);
      const parsed = parseHandAuthoredQuestions("spec", md);
      if (parsed.kind !== "parsed") throw new Error("the decided spec does not parse");
      expect(parsed.open.map((q) => q.id)).toEqual(["Q2"]);
      expect(parsed.arbitrated.map((q) => q.id)).toEqual(["Q1"]);
      expect(md).toContain("Decision: keep-10");
      expect(md.match(/Q1/g)?.length).toBeGreaterThan(1);
      expect(md.startsWith(HAND_SPEC_MD.slice(0, HAND_SPEC_MD.indexOf("# Log retention")))).toBe(
        true,
      );
      expect(world.headFiles()).toEqual([HAND]);
      expect(world.porcelain()).toBe("");

      // The writer was asked for a hand decision answer, with the artifact's Markdown.
      const sent = h.backend.runCalls[0]?.prompt ?? "";
      expect(sent).toContain("Hand decision answer JSON Schema");
      expect(sent).toContain("### Q1 — Retention: ten logs or twenty?");
      expect(h.lines[0]).toBe(
        "decide spec log-retention — verdicts from verdicts.json: Q1 — headless, new session",
      );
    });

    it("a departing verdict revises the Markdown and names the section; the note is its why", async () => {
      const note = "Support asks for a fortnight of runs.";
      seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-20", note }]));
      const revisedMd = HAND_SPEC_MD.replace("ten most recent", "twenty most recent");
      const h = world.harness({
        runAnswers: [handAnswer("keep-20", { revised: ["5.1"], markdown: revisedMd })],
      });

      const done = committed(await h.run({ path: HAND }));

      expect(done.verdicts).toMatchObject([
        { question: "Q1", chosen: "keep-20", departs: true, why: note, revised: ["5.1"] },
      ]);
      const md = world.readRepoFile(HAND);
      expect(md).toContain("THE system SHALL keep the twenty most recent logs.");
      expect(md).toContain("Decision: keep-20");
      expect(md).toContain(note);
      expect(world.headFiles()).toEqual([HAND]);
    });

    it("other is accepted as a Decision, with every listed option abandoned", async () => {
      const note = "Keep logs for as long as the run's report is kept.";
      seedHand(fileOf(HAND, [{ question: "Q1", chosen: "other", note }]));
      const revisedMd = HAND_SPEC_MD.replace(
        "THE system SHALL keep the ten most recent logs.",
        "THE system SHALL keep a log as long as its run's report is kept.",
      );
      const h = world.harness({
        runAnswers: [handAnswer("other", { revised: ["5.1"], markdown: revisedMd })],
      });

      const done = committed(await h.run({ path: HAND }));

      expect(done.verdicts).toMatchObject([{ question: "Q1", chosen: "other", departs: true }]);
      const md = world.readRepoFile(HAND);
      expect(md).toContain("Decision: other");
      const parsed = parseHandAuthoredQuestions("spec", md);
      expect(parsed.kind).toBe("parsed");
    });

    it("an arbitrated hand question named again keeps the earlier decision", async () => {
      seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]));
      committed(await world.harness({ runAnswers: [handAnswer("keep-10")] }).run({ path: HAND }));
      const decidedMd = world.readRepoFile(HAND);
      world.writeRepoFile(
        VERDICTS,
        fileOf(HAND, [{ question: "Q1", chosen: "keep-20", note: "A fortnight of runs." }]),
      );
      world.commitAll("second file");
      const revisedMd = decidedMd.replace("ten most recent", "twenty most recent");
      const h = world.harness({
        runAnswers: [handAnswer("keep-20", { revised: ["5.1"], markdown: revisedMd })],
      });

      const done = committed(await h.run({ path: HAND }));

      expect(done.verdicts).toMatchObject([{ question: "Q1", chosen: "keep-20", departs: true }]);
      expect(done.decisionId).toBe(`${HAND_ID}/02`);
      const md = world.readRepoFile(HAND);
      expect(md).toContain("Decision: keep-20");
      // The first decision stays in the file as an earlier one.
      expect(md).toContain("Earlier decision: keep-10");
      expect(world.headFiles()).toEqual([HAND]);
    });

    it.each([
      { name: "restoring the body it revised", restores: true },
      { name: "leaving the body as it is", restores: false },
    ])(
      "a verdict restoring the recommendation after a departure lands, $name: a Decision block records no revised sections",
      async ({ restores }) => {
        const note = "Support asks for a fortnight of runs.";
        seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-20", note }]));
        const departedMd = HAND_SPEC_MD.replace("ten most recent", "twenty most recent");
        committed(
          await world
            .harness({
              runAnswers: [handAnswer("keep-20", { revised: ["5.1"], markdown: departedMd })],
            })
            .run({ path: HAND }),
        );
        const decidedMd = world.readRepoFile(HAND);
        world.writeRepoFile(VERDICTS, fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]));
        world.commitAll("second file");
        const h = world.harness({
          runAnswers: [
            restores
              ? handAnswer("keep-10", {
                  revised: ["5.1"],
                  markdown: decidedMd.replace("twenty most recent", "ten most recent"),
                })
              : handAnswer("keep-10", { markdown: decidedMd }),
          ],
        });

        const done = committed(await h.run({ path: HAND }));

        expect(done.verdicts).toMatchObject([
          {
            question: "Q1",
            chosen: "keep-10",
            departs: false,
            revised: restores ? ["5.1"] : [],
            why: "ten logs cover a week of runs\n\nA longer history costs disk and nobody reads it.",
          },
        ]);
        const md = world.readRepoFile(HAND);
        expect(md).toContain("Decision: keep-10");
        expect(md).toContain("Earlier decision: keep-20");
        expect(md).toContain(
          restores
            ? "THE system SHALL keep the ten most recent logs."
            : "THE system SHALL keep the twenty most recent logs.",
        );
        // The writer was told the verdict restores the recommendation.
        expect(h.backend.runCalls[0]?.prompt).toContain("it restores the recommendation");
      },
    );

    it("a verdict with no note on a question with an empty rationale exits 12 before any session", async () => {
      seedHand(
        fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]),
        HAND_SPEC_MD.replace(
          "Recommendation: keep-10 — ten logs cover a week of runs\n\nA longer history costs disk and nobody reads it.\n",
          "Recommendation: keep-10 —\n",
        ),
      );
      const h = world.harness();

      const { error } = expectFailure(world, await h.run({ path: HAND }), 12, world.headSha());

      expect(error.reason).toBe("verdicts-binding");
      expect(error.message).toBe(
        "Decide refused: verdicts.json gives Q1 no note, and Q1 has no rationale to stand as its why — give the verdict a note, or write the question's rationale",
      );
      expectNoWriter(world, h);
    });

    it("a wrong option exits 5 after one resume, the file unchanged", async () => {
      const { head } = (() => {
        seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]));
        return { head: world.headSha() };
      })();
      const wrong = handAnswer("keep-20", { revised: ["5.1"] });
      const h = world.harness({ runAnswers: [wrong], resumeAnswers: [wrong] });

      const { error } = expectFailure(
        world,
        await h.run({ path: HAND, records: RECORDS_ON }),
        5,
        head,
      );

      expect(error.path).toBe("decisions[0].verdict.chosen");
      expect(h.backend.resumeCalls).toHaveLength(1);
      expect(
        JSON.parse(world.git(["show", `${RECORDS_BRANCH}:decision/${HAND_ID}/01/record.json`])),
      ).toMatchObject({ mode: "verdicts", outcome: "failed", commit: null } as Json);
    });
  },
);

describe(
  "decide --verdicts — the reserved other id in a hand-authored §9",
  { timeout: 30_000 },
  () => {
    const CASES: ReadonlyArray<{ name: string; md: string; message: string }> = [
      {
        name: "an option bullet",
        md: HAND_SPEC_MD.replace(
          "- keep-20 — Twenty logs — abandons: disk space",
          "- other — Something else — abandons: nothing",
        ),
        message: "Q1 lists the reserved option id other",
      },
      {
        name: "a recommendation",
        md: HAND_SPEC_MD.replace(
          "Recommendation: keep-10 — ten logs cover a week of runs",
          "Recommendation: other — ten logs cover a week of runs",
        ),
        message: "Q1 recommends the reserved id other",
      },
    ];

    it.each(CASES)(
      "$name naming other is refused with exit 12 naming Q1, no session spawned",
      async ({ md, message }) => {
        seedHand(fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]), md);
        const h = world.harness();

        const { error } = expectFailure(world, await h.run({ path: HAND }), 12, world.headSha());

        expect(error.reason).toBe("hand-format");
        expect(error.message).toContain(message);
        expectNoWriter(world, h);
      },
    );

    it("a hand-authored spec with no §9 section names no question a file could bind", async () => {
      seedHand(
        fileOf(HAND, [{ question: "Q1", chosen: "keep-10" }]),
        `${SPEC_FRONTMATTER}# Log retention\n\n## 1. Context\n\nEvery run writes one log.\n`,
      );
      const h = world.harness();

      const { error } = expectFailure(world, await h.run({ path: HAND }), 12, world.headSha());

      expect(error.reason).toBe("verdicts-binding");
      expect(error.message).toContain("Q1");
      expect(error.message).toContain("its questions are none");
      expectNoWriter(world, h);
    });
  },
);
