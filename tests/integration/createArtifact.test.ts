import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { createArtifact } from "../../src/app/createArtifact.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
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
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        path: "docs/specs/2609091412-plan-prune.md",
        sourceSpec: null,
      });
    }
    const written = impl.getFile("docs/specs/2609091412-plan-prune.md");
    expect(written).toContain("status: Draft");
    expect(written).toContain("date: 2026-09-09");
    expect(written).toContain("audience: implementation planning with Claude Code");
    expect(written).toContain("scope: functional behavior and consumption surface");
  });

  it("creates a Draft plan bound to an existing source spec", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile("docs/specs/2609091412-plan-prune.md", APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: "docs/specs/2609091412-plan-prune.md",
        nowIso: "2026-09-10T10:30:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        path: "docs/plans/2609101030-plan-prune-plan.md",
        sourceSpec: "docs/specs/2609091412-plan-prune.md",
      });
    }
    const written = impl.getFile("docs/plans/2609101030-plan-prune-plan.md");
    expect(written).toContain("status: Draft");
    expect(written).toContain("source-spec: docs/specs/2609091412-plan-prune.md");
  });

  it("creates a Draft plan with source-spec null when no --spec is given", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "catalog-refresh",
        sourceSpec: null,
        nowIso: "2026-09-10T10:31:00.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        path: "docs/plans/2609101031-catalog-refresh-plan.md",
        sourceSpec: null,
      });
    }
    const written = impl.getFile("docs/plans/2609101031-catalog-refresh-plan.md");
    expect(written).toContain("source-spec: null");
  });

  it("refuses a slug that does not match the slug grammar, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "Plan_Prune",
        sourceSpec: null,
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
    impl.setFile("docs/specs/2609091412-plan-prune.md", APPROVED_SPEC);

    const result = await run(
      createArtifact({
        kind: "spec",
        slug: "plan-prune",
        sourceSpec: null,
        nowIso: "2026-09-09T14:12:40.000Z",
        repoRoot: "/fake-repo",
      }).pipe(Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCreationError);
      expect(result.left.message).toContain("2609091412-plan-prune.md");
    }
    expect(impl.getFile("docs/specs/2609091412-plan-prune.md")).toBe(APPROVED_SPEC);
  });

  it("refuses when --spec is missing, without writing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    const result = await run(
      createArtifact({
        kind: "plan",
        slug: "plan-prune",
        sourceSpec: "docs/specs/2609091412-plan-prune.md",
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
