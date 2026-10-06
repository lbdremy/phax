import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { createArtifact, resolveArtifactTarget } from "../../src/app/createArtifact.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { validateArtifact } from "../../src/domain/artifact/document.js";
import { ArtifactCreationError } from "../../src/domain/errors.js";

const APPROVED_SPEC = `---
status: Approved
date: 2026-09-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-09
  baseline: abc1234
---
# Plan prune
`;

const SPEC_PATH = "docs/specs/2609091412-plan-prune.md";
const PLAN_PATH = "docs/plans/2609101030-plan-prune-plan.md";

const NO_FLAGS = { last: false, notLast: false } as const;
const LAST = { last: true, notLast: false } as const;
const NOT_LAST = { last: false, notLast: true } as const;

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(Effect.either(effect));
}

describe("createArtifact", () => {
  it("creates a Draft spec named from the current UTC minute", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "plan-prune",
        sourceSpec: null,
        completion: NO_FLAGS,
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        path: "docs/specs/2609091412-plan-prune.md",
        sourceSpec: null,
        completesSpec: null,
      });
    }
    const written = impl.getFile("docs/specs/2609091412-plan-prune.md");
    expect(written).toContain("status: Draft");
    expect(written).toContain("date: 2026-09-09");
    expect(written).toContain("audience: implementation planning with Claude Code");
    expect(written).toContain("scope: functional behavior and consumption surface");
  });

  it("creates a Draft plan bound to an existing source spec, completes-spec true with --last", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: SPEC_PATH,
        completion: LAST,
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ path: PLAN_PATH, sourceSpec: SPEC_PATH, completesSpec: true });
    }
    const written = impl.getFile(PLAN_PATH) ?? "";
    expect(written).toBe(
      `---\nstatus: Draft\nsource-spec: ${SPEC_PATH}\ncompletes-spec: true\n---\n`,
    );
    expect(Either.isRight(validateArtifact(PLAN_PATH, written))).toBe(true);
  });

  it("writes completes-spec false on the line after source-spec with --not-last", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: SPEC_PATH,
        completion: NOT_LAST,
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.completesSpec).toBe(false);
    const written = impl.getFile(PLAN_PATH) ?? "";
    expect(written).toContain(`source-spec: ${SPEC_PATH}\ncompletes-spec: false\n`);
    expect(Either.isRight(validateArtifact(PLAN_PATH, written))).toBe(true);
  });

  it("creates a Draft plan with source-spec null and no completes-spec when no --spec is given", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "catalog-refresh",
        sourceSpec: null,
        completion: NO_FLAGS,
        nowIso: "2026-09-10T10:31:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        path: "docs/plans/2609101031-catalog-refresh-plan.md",
        sourceSpec: null,
        completesSpec: null,
      });
    }
    const written = impl.getFile("docs/plans/2609101031-catalog-refresh-plan.md") ?? "";
    expect(written).toContain("source-spec: null");
    expect(written).not.toContain("completes-spec");
    expect(
      Either.isRight(validateArtifact("docs/plans/2609101031-catalog-refresh-plan.md", written)),
    ).toBe(true);
  });

  it.each([
    {
      label: "neither flag with --spec",
      sourceSpec: SPEC_PATH,
      completion: NO_FLAGS,
      names: "--spec needs --last",
    },
    {
      label: "both flags with --spec",
      sourceSpec: SPEC_PATH,
      completion: { last: true, notLast: true },
      names: "opposites",
    },
    {
      label: "--last without --spec",
      sourceSpec: null,
      completion: LAST,
      names: "--last needs --spec",
    },
    {
      label: "--not-last without --spec",
      sourceSpec: null,
      completion: NOT_LAST,
      names: "--not-last needs --spec",
    },
  ])("refuses $label, without writing", async ({ sourceSpec, completion, names }) => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec,
        completion,
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain(names);
    }
    expect([...impl.files.keys()]).toEqual([SPEC_PATH]);
  });

  it("refuses a slug that does not match the slug grammar, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "Plan_Prune",
        sourceSpec: null,
        completion: NO_FLAGS,
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain("Plan_Prune");
    }
    expect(impl.files.size).toBe(0);
  });

  it("refuses a spec slug ending in -plan, whose name would read as a plan, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "foo-plan",
        sourceSpec: null,
        completion: NO_FLAGS,
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain("2609091412-foo-plan.md");
    }
    expect(impl.files.size).toBe(0);
  });

  it("refuses when the target already exists, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "plan-prune",
        sourceSpec: null,
        completion: NO_FLAGS,
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain("2609091412-plan-prune.md");
    }
    expect(impl.getFile(SPEC_PATH)).toBe(APPROVED_SPEC);
  });

  it("refuses when --spec is missing, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: SPEC_PATH,
        completion: LAST,
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
    }
    expect(impl.files.size).toBe(0);
  });

  it("refuses when --spec points at a plan path, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      "docs/plans/2609091412-other-plan.md",
      `---\nstatus: Draft\nsource-spec: null\n---\n`,
    );

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: "docs/plans/2609091412-other-plan.md",
        completion: LAST,
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
    }
    expect(impl.files.size).toBe(1);
  });
});

describe("resolveArtifactTarget", () => {
  it("resolves a plan's path, its validated source spec and completes-spec without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(SPEC_PATH, APPROVED_SPEC);

    const result = await run(
      resolveArtifactTarget({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: SPEC_PATH,
        completion: NOT_LAST,
        nowIso: "2026-09-10T10:30:00.000Z",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        dir: "docs/plans",
        path: PLAN_PATH,
        sourceSpec: { path: SPEC_PATH, markdown: APPROVED_SPEC },
        completesSpec: false,
      });
    }
    expect(impl.files.size).toBe(1);
  });

  it("ignores --spec and the completion flags for a spec", async () => {
    const { layer } = makeFakeFileSystem();

    const result = await run(
      resolveArtifactTarget({
        kind: "spec",
        slug: "plan-prune",
        sourceSpec: "docs/specs/2609091412-missing.md",
        completion: { last: true, notLast: true },
        nowIso: "2026-09-09T14:12:40.000Z",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        dir: "docs/specs",
        path: "docs/specs/2609091412-plan-prune.md",
        sourceSpec: null,
        completesSpec: null,
      });
    }
  });
});
