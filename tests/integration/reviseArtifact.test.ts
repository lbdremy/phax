import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inspectSidecar } from "../../src/domain/artifact/sidecar.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { type PlanDocument, projectExtractedPlan } from "../../src/schemas/planDocument.js";
import {
  AMENDMENT,
  KEPT_BRIEF,
  KEPT_SESSION,
  OPERATOR,
  RECORDS_ON,
  VIBE_ENABLED,
  failureOf,
  noWriterStarted,
  playTranscripts,
  succeeded,
  trailerOf,
  useReviseRepo,
} from "../helpers/reviseHarness.js";
import {
  ANSWER_PROSE,
  NEW_QUESTION,
  PLAN_ANSWER_APPENDS_Q9,
  PLAN_ANSWER_EDITS_VERDICT,
  PLAN_ANSWER_NO_SCHEMA,
  PLAN_ANSWER_OTHER_SOURCE_SPEC,
  PLAN_ANSWER_REMOVES_OPEN,
  PLAN_ANSWER_REORDERS,
  PLAN_ANSWER_REVISED,
  PLAN_ANSWER_UNCHANGED,
  REVISED_PLAN_SUMMARY,
  REVISE_PLAN_ID,
  REVISE_SPEC,
  REVISE_SPEC_ID,
  SOURCE_SPEC,
  SPEC_ANSWER_APPENDS_Q9,
  SPEC_ANSWER_UNCHANGED,
  SPEC_ANSWER_REVISED,
} from "../unit/revise/reviseFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Real-git acceptance for `phax artifact revise` (spec artifact-revise §8). The
// use case is `reviseArtifact`; the writer session, the terminal and GitHub are
// fakes; git and the filesystem are real. Every test is named after the §8
// criterion it covers and is marked `it.fails` until phase-06 implements the use
// case: against the stub each dies with "not implemented: reviseArtifact". The
// JSON report (§5.13) and the bad-amendment refusal (§5.19) are the command's
// surface, tested by phase-07; the `records explain` half of the record
// criterion is phase-08's.

const world = useReviseRepo();

const json = (answer: unknown): string => JSON.stringify(answer);

/** The ids of the spec fixture's open questions, in order. */
const REVISE_SPEC_OPEN_IDS = (
  REVISE_SPEC.document as { openQuestions: ReadonlyArray<{ id: string }> }
).openQuestions.map((q) => q.id);

/** The sidecar JSON of the repository, with its `$schema` dropped. */
function sidecarOf(path: string): Record<string, unknown> {
  const { $schema: _stamp, ...rest } = JSON.parse(world.readRepoFile(path)) as Record<
    string,
    unknown
  >;
  return rest;
}

describe("revise — a plan is revised from an amendment", { timeout: 30_000 }, () => {
  it.fails("A plan is revised from an amendment", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

    const done = succeeded(await h.run(plan.path, { by: "operator" }));

    expect(done).toMatchObject({
      kind: "committed",
      path: plan.path,
      paths: [plan.path, plan.sidecarPath],
      status: "Draft",
      session: "resumed-authoring",
    });
    // The kept session was resumed, not a new one run.
    expect(h.backend.runCalls).toHaveLength(0);
    expect(h.backend.resumeCalls).toHaveLength(1);
    expect(h.backend.resumeCalls[0]?.sessionId).toBe(KEPT_SESSION);
    // One new commit holding exactly the artifact and its sidecar.
    expect(world.commitsSince(head)).toBe(1);
    expect(world.headFiles()).toEqual([plan.path, plan.sidecarPath].toSorted());
    expect(world.porcelain()).toBe("");
    const md = world.readRepoFile(plan.path);
    expect(md).toContain(REVISED_PLAN_SUMMARY);
    // Still a Draft, its sidecar in sync with it.
    expect(md.startsWith(plan.frontmatter)).toBe(true);
    const inspected = inspectSidecar({
      md,
      sidecarJson: world.readRepoFile(plan.sidecarPath),
      kind: "plan",
      sidecarPath: plan.sidecarPath,
    });
    expect(inspected.agreement).toBe("in-sync");
    // The extraction cache was seeded for the new text: no extraction session runs.
    expect(await world.planCacheEntry(md)).toEqual(
      projectExtractedPlan(sidecarOf(plan.sidecarPath) as unknown as PlanDocument),
    );
  });
});

describe("revise — a spec is revised in a new session", { timeout: 30_000 }, () => {
  it.fails("A spec is revised in a new session", async () => {
    const spec = world.seed({ kind: "spec", kept: { provider: "codex-cli" } });
    const h = world.harness({ runAnswers: [json(SPEC_ANSWER_REVISED)] });

    const done = succeeded(await h.run(spec.path));

    expect(done).toMatchObject({ kind: "committed", session: "new", status: "Draft" });
    expect(h.backend.resumeCalls).toHaveLength(0);
    expect(h.backend.runCalls).toHaveLength(1);
    // The prompt carries the current document, the kept brief and the amendment.
    const prompt = h.backend.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain("Every run writes one log, and nothing ever removes it.");
    expect(prompt).toContain(KEPT_BRIEF.trim());
    expect(prompt).toContain(AMENDMENT.trim());
  });
});

describe("revise — only a Draft is revised", { timeout: 30_000 }, () => {
  it.fails.each(["Approved", "Stale"] as const)(
    "Only a Draft is revised: a %s plan is refused naming phax artifact reopen",
    async (status) => {
      const plan = world.seed({ kind: "plan", status });
      const head = world.headSha();
      const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

      const failure = failureOf(await h.run(plan.path));

      expect(failure.exitCode).toBe(12);
      expect(failure.message).toContain(`phax artifact reopen ${plan.path}`);
      expect(noWriterStarted(world, h)).toBe(true);
      expect(world.headSha()).toBe(head);
    },
  );
});

describe("revise — only a headless artifact in sync is revised", { timeout: 30_000 }, () => {
  const CASES = [
    {
      name: "a hand-authored plan",
      shape: "hand",
      remedy: (message: string) => expect(message).toMatch(/edit(ing)? the `?\.md`? directly/i),
    },
    {
      name: "a diverged sidecar",
      shape: "diverged",
      remedy: (message: string) => expect(message).toContain("--headless"),
    },
    {
      name: "an invalid sidecar",
      shape: "invalid",
      remedy: (message: string) => expect(message).toContain("--headless"),
    },
    {
      name: "a sidecar stamped below its shape",
      shape: "unmigrated",
      remedy: (message: string) => expect(message).toContain("phax artifact migrate-documents"),
    },
  ] as const;

  for (const { name, shape, remedy } of CASES) {
    it.fails(`Only a headless artifact in sync is revised: ${name} exits 12 naming its remedy`, async () => {
      const plan = world.seed({ kind: "plan", shape });
      const head = world.headSha();
      const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

      const failure = failureOf(await h.run(plan.path));

      expect(failure.exitCode).toBe(12);
      remedy(failure.message);
      expect(noWriterStarted(world, h)).toBe(true);
      expect(world.headSha()).toBe(head);
    });
  }
});

describe("revise — a changed question is refused", { timeout: 30_000 }, () => {
  const CASES = [
    { name: "an edited verdict", answer: PLAN_ANSWER_EDITS_VERDICT, id: "Q3" },
    { name: "a removed open question", answer: PLAN_ANSWER_REMOVES_OPEN, id: "Q2" },
    { name: "two reordered questions", answer: PLAN_ANSWER_REORDERS, id: "Q1" },
  ] as const;

  for (const { name, answer, id } of CASES) {
    it.fails(`A changed question is refused: ${name} is refused, corrected once, then exits 5`, async () => {
      const plan = world.seed({ kind: "plan", kept: false });
      const head = world.headSha();
      const h = world.harness({ runAnswers: [json(answer)], resumeAnswers: [json(answer)] });

      const failure = failureOf(await h.run(plan.path));

      expect(failure.exitCode).toBe(5);
      expect(failure.message).toContain(id);
      // The first answer, then exactly one corrective resume.
      expect(h.backend.runCalls).toHaveLength(1);
      expect(h.backend.resumeCalls).toHaveLength(1);
      // Nothing written.
      expect(world.readRepoFile(plan.path)).toBe(plan.md);
      expect(world.readRepoFile(plan.sidecarPath)).toBe(plan.sidecarText);
      expect(world.headSha()).toBe(head);
      expect(world.porcelain()).toBe("");
    });
  }
});

describe("revise — a new open question is accepted", { timeout: 30_000 }, () => {
  it.fails("A new open question is accepted: a plan lists Q9 under ## Open questions", async () => {
    const plan = world.seed({ kind: "plan" });
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_APPENDS_Q9)] });

    const done = succeeded(await h.run(plan.path));

    expect(done.kind).toBe("committed");
    expect(done.newQuestions).toEqual([{ id: "Q9", question: NEW_QUESTION.question }]);
    const open = (
      sidecarOf(plan.sidecarPath) as { preamble: { openQuestions: Array<{ id: string }> } }
    ).preamble.openQuestions;
    expect(open.map((q) => q.id)).toEqual(["Q1", "Q2", "Q9"]);
    const md = world.readRepoFile(plan.path);
    expect(md).toContain("## Open questions");
    expect(md.slice(md.indexOf("## Open questions"))).toContain(NEW_QUESTION.question);
  });

  it.fails("A new open question is accepted: a spec lists Q9 under ## 9. Open questions", async () => {
    const spec = world.seed({ kind: "spec" });
    const h = world.harness({ resumeAnswers: [json(SPEC_ANSWER_APPENDS_Q9)] });

    const done = succeeded(await h.run(spec.path));

    expect(done.kind).toBe("committed");
    expect(done.newQuestions).toEqual([{ id: "Q9", question: NEW_QUESTION.question }]);
    const open = (sidecarOf(spec.sidecarPath) as { openQuestions: Array<{ id: string }> })
      .openQuestions;
    expect(open.map((q) => q.id)).toEqual([...REVISE_SPEC_OPEN_IDS, "Q9"]);
    const md = world.readRepoFile(spec.path);
    expect(md).toContain("## 9. Open questions");
    expect(md.slice(md.indexOf("## 9. Open questions"))).toContain(NEW_QUESTION.question);
  });
});

describe("revise — a malformed answer is refused", { timeout: 30_000 }, () => {
  it.fails("A malformed answer is refused: prose, then a document without $schema, exits 5", async () => {
    const plan = world.seed({ kind: "plan", kept: false });
    const head = world.headSha();
    const h = world.harness({
      runAnswers: [ANSWER_PROSE],
      resumeAnswers: [json(PLAN_ANSWER_NO_SCHEMA)],
    });

    const failure = failureOf(await h.run(plan.path));

    expect(failure.exitCode).toBe(5);
    expect(failure.message).toContain("$schema");
    expect(h.backend.runCalls).toHaveLength(1);
    expect(h.backend.resumeCalls).toHaveLength(1);
    expect(world.porcelain()).toBe("");
    expect(world.headSha()).toBe(head);
  });
});

describe("revise — frontmatter is kept", { timeout: 30_000 }, () => {
  it.fails("Frontmatter is kept: an answer rendering another source-spec keeps the frontmatter's bytes", async () => {
    const plan = world.seed({ kind: "plan" });
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_OTHER_SOURCE_SPEC)] });

    const done = succeeded(await h.run(plan.path));

    expect(done.kind).toBe("committed");
    const md = world.readRepoFile(plan.path);
    expect(md.startsWith(plan.frontmatter)).toBe(true);
    expect(md.slice(0, plan.frontmatter.length)).toBe(plan.frontmatter);
    expect((sidecarOf(plan.sidecarPath) as { sourceSpec: string }).sourceSpec).toBe(SOURCE_SPEC);
  });
});

describe("revise — no change is not a commit", { timeout: 30_000 }, () => {
  it.fails("No change is not a commit: the current document ends unchanged with no commit", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_UNCHANGED)] });

    const done = succeeded(await h.run(plan.path));

    expect(done).toMatchObject({ kind: "unchanged", commit: null, paths: [], status: "Draft" });
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe("");
    expect(world.readRepoFile(plan.path)).toBe(plan.md);
    expect(world.readRepoFile(plan.sidecarPath)).toBe(plan.sidecarText);
  });

  it.fails("No change is not a commit: a spec answering its current document ends unchanged", async () => {
    const spec = world.seed({ kind: "spec" });
    const head = world.headSha();
    const h = world.harness({ resumeAnswers: [json(SPEC_ANSWER_UNCHANGED)] });

    const done = succeeded(await h.run(spec.path));

    expect(done).toMatchObject({ kind: "unchanged", commit: null, paths: [] });
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe("");
  });
});

describe("revise — the commit carries the amendment and the requester", { timeout: 30_000 }, () => {
  it.fails("The commit carries the amendment and the requester: --by machine:plan-loop", async () => {
    const plan = world.seed({ kind: "plan" });
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

    const done = succeeded(await h.run(plan.path, { by: "machine:plan-loop" }));

    expect(done.requester).toEqual({ kind: "machine", grant: "plan-loop" });
    const message = world.headMessage();
    expect(message.split("\n")[0]).toBe("docs(plans): revise log-rotation");
    expect(message).toContain(AMENDMENT.trimEnd());
    expect(trailerOf(message, "Artifact")).toBe(plan.path);
    expect(trailerOf(message, "Revised-By")).toBe("machine (plan-loop)");
    expect(trailerOf(message, "Revision-Id")).toBe(`${REVISE_PLAN_ID}/01`);
  });
});

describe("revise — no requester without a terminal", { timeout: 30_000 }, () => {
  it.fails("No requester without a terminal: no --by and no TTY exits 12 naming both forms", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)], terminal: false });

    const failure = failureOf(await h.run(plan.path, { by: undefined }));

    expect(failure.exitCode).toBe(12);
    expect(failure.message).toContain("--by operator");
    expect(failure.message).toContain("--by machine:<grant>");
    expect(noWriterStarted(world, h)).toBe(true);
    expect(world.headSha()).toBe(head);
  });
});

describe("revise — a concurrent edit is kept", { timeout: 30_000 }, () => {
  it.fails("A concurrent edit is kept: the plan edited while the writer runs exits 12", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const edited = `${plan.md}\nEdited meanwhile.\n`;
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });
    h.backend.setOnResumeAgent(() => {
      writeFileSync(join(world.repoDir, plan.path), edited);
    });

    const failure = failureOf(await h.run(plan.path));

    expect(failure.exitCode).toBe(12);
    // The edit stays; nothing of revise's was written to the repository.
    expect(world.readRepoFile(plan.path)).toBe(edited);
    expect(world.readRepoFile(plan.sidecarPath)).toBe(plan.sidecarText);
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe(`M ${plan.path}`);
  });
});

describe("revise — a writer routed to Vibe runs read-only", { timeout: 30_000 }, () => {
  it.fails("A writer routed to Vibe runs read-only: the revision commits", async () => {
    const spec = world.seed({ kind: "spec" });
    const head = world.headSha();
    const h = world.harness({ runAnswers: [json(SPEC_ANSWER_REVISED)] });

    const done = succeeded(
      await h.run(spec.path, { model: "claude-sonnet-4-6", providerConfig: VIBE_ENABLED }),
    );

    expect(done).toMatchObject({ kind: "committed", provider: "mistral-vibe" });
    expect(h.backend.runCalls[0]?.options).toMatchObject({
      provider: "mistral-vibe",
      readOnly: true,
    });
    expect(world.commitsSince(head)).toBe(1);
    expect(world.headFiles()).toEqual([spec.path, spec.sidecarPath].toSorted());
  });
});

describe("revise — the revision is explained", { timeout: 30_000 }, () => {
  it.fails("The revision is explained: a committed revision leaves its record", async () => {
    const plan = world.seed({ kind: "plan" });
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });
    playTranscripts(h);

    const done = succeeded(await h.run(plan.path, { records: RECORDS_ON }));

    expect(done.revisionId).toBe(`${REVISE_PLAN_ID}/01`);
    const record = world.revisionRecord(done.revisionId);
    expect(record).toMatchObject({
      kind: "revision",
      revisionId: done.revisionId,
      artifact: plan.path,
      artifactKind: "plan",
      session: "resumed-authoring",
      requester: { kind: "operator", name: OPERATOR },
      newQuestions: [],
      outcome: "committed",
      commit: done.commit?.hash,
    });
    expect(record?.["$schema"]).toBe(currentSchemaUrl("revision-record-manifest"));
  });

  it.fails("The revision is explained: a revision failed with exit 5 leaves a failed record", async () => {
    const plan = world.seed({ kind: "plan", kept: false });
    const h = world.harness({
      runAnswers: [json(PLAN_ANSWER_REMOVES_OPEN)],
      resumeAnswers: [json(PLAN_ANSWER_REMOVES_OPEN)],
    });
    playTranscripts(h);

    const failure = failureOf(await h.run(plan.path, { records: RECORDS_ON }));

    expect(failure.exitCode).toBe(5);
    const record = world.revisionRecord(`${REVISE_PLAN_ID}/01`);
    expect(record).toMatchObject({
      kind: "revision",
      revisionId: `${REVISE_PLAN_ID}/01`,
      session: "new",
      outcome: "failed",
      commit: null,
      failure: "answer-refused",
    });
    expect(record?.["$schema"]).toBe(currentSchemaUrl("revision-record-manifest"));
  });
});

describe("revise — a provider failure writes nothing", { timeout: 30_000 }, () => {
  it.fails("A provider failure writes nothing: a usage limit exits 8", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const h = world.harness();
    h.backend.failNextResumeWithRateLimit({ kind: "usage_limit" });

    const failure = failureOf(await h.run(plan.path));

    expect(failure.exitCode).toBe(8);
    expect(world.readRepoFile(plan.path)).toBe(plan.md);
    expect(world.readRepoFile(plan.sidecarPath)).toBe(plan.sidecarText);
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe("");
  });

  it.fails("A provider failure writes nothing: a network failure exits 14", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    const h = world.harness();
    h.backend.failNextResumeWith({
      provider: "claude-code",
      kind: "network",
      message: "getaddrinfo ENOTFOUND api.anthropic.com",
      sessionId: null,
      resetAt: null,
    });

    const failure = failureOf(await h.run(plan.path));

    expect(failure.exitCode).toBe(14);
    expect(world.readRepoFile(plan.path)).toBe(plan.md);
    expect(world.readRepoFile(plan.sidecarPath)).toBe(plan.sidecarText);
    expect(world.headSha()).toBe(head);
    expect(world.porcelain()).toBe("");
  });
});

describe("revise — uncommitted changes are refused", { timeout: 30_000 }, () => {
  it.fails("Uncommitted changes are refused: an uncommitted sidecar edit exits 12", async () => {
    const plan = world.seed({ kind: "plan" });
    const head = world.headSha();
    world.writeRepoFile(plan.sidecarPath, `${plan.sidecarText ?? ""}\n`);
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

    const failure = failureOf(await h.run(plan.path));

    expect(failure.exitCode).toBe(12);
    expect(failure.message).toContain(plan.sidecarPath);
    expect(noWriterStarted(world, h)).toBe(true);
    expect(world.headSha()).toBe(head);
  });

  it.fails.each(["operator", "machine:plan-loop"])(
    "Uncommitted changes are refused: no git user.name exits 12 for --by %s",
    async (by) => {
      const plan = world.seed({ kind: "plan" });
      const head = world.headSha();
      world.unsetCommitterName();
      const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });

      const failure = failureOf(await h.run(plan.path, { by }));

      expect(failure.exitCode).toBe(12);
      expect(failure.message).toContain("user.name");
      expect(noWriterStarted(world, h)).toBe(true);
      expect(world.headSha()).toBe(head);
    },
  );
});

describe("revise — the revision's files are kept", { timeout: 30_000 }, () => {
  it.fails("The revision's files are kept under revise/<authoringId>/<NN>/", async () => {
    const plan = world.seed({ kind: "plan" });
    const h = world.harness({ resumeAnswers: [json(PLAN_ANSWER_REVISED)] });
    playTranscripts(h);

    const done = succeeded(await h.run(plan.path));

    const files = world.reviseFolderFiles(REVISE_PLAN_ID, "01");
    for (const name of [
      "amendment.md",
      "prompt.md",
      "output.jsonl",
      "document.json",
      "body.diff",
    ]) {
      expect(files).toContain(name);
    }
    const folder = world.reviseFolder(REVISE_PLAN_ID, "01");
    expect(readFileSync(join(folder, "amendment.md"), "utf8")).toBe(AMENDMENT);
    // `<authoringId>/<NN>` is the commit's Revision-Id.
    expect(done.revisionId).toBe(`${REVISE_PLAN_ID}/01`);
    expect(trailerOf(world.headMessage(), "Revision-Id")).toBe(done.revisionId);
  });

  it.fails("The revision's files are kept: a spec's folder is named by its own authoring id", async () => {
    const spec = world.seed({ kind: "spec" });
    const h = world.harness({ resumeAnswers: [json(SPEC_ANSWER_REVISED)] });
    playTranscripts(h);

    const done = succeeded(await h.run(spec.path));

    expect(done.revisionId).toBe(`${REVISE_SPEC_ID}/01`);
    expect(world.reviseFolderFiles(REVISE_SPEC_ID, "01")).toContain("document.json");
    expect(trailerOf(world.headMessage(), "Revision-Id")).toBe(`${REVISE_SPEC_ID}/01`);
  });
});
