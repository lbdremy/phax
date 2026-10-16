import { Effect, Either } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDoctrine } from "../../src/app/resolveDoctrine.js";
import { DecideRefusedError } from "../../src/domain/errors.js";
import { makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";

const BUNDLED = "# Bundled doctrine\n\n- `S1` **Adopt the default.**\n";
const PROJECT = "# Project copy\n\n- `S1` **Adopt the default.**\n- `C4` **Condition.**\n";

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "phax-resolve-doctrine-test-"));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const run = (doctrinePath: string | null, kind: "spec" | "plan" = "spec") =>
  Effect.runPromise(
    Effect.either(resolveDoctrine({ kind, bundledSkillText: BUNDLED, doctrinePath })).pipe(
      Effect.provide(makeRootedNodeFileSystemLayer(repo)),
    ),
  );

async function writeRepoFile(rel: string, text: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), text);
}

describe("resolveDoctrine", () => {
  it("uses the bundled skill when the project has no copy", async () => {
    const result = await run(null);
    if (Either.isLeft(result)) throw result.left;
    expect(result.right.text).toBe(BUNDLED);
    expect(result.right.sources).toEqual([
      expect.objectContaining({ kind: "skill", name: "phax-decide-spec", source: "bundled" }),
    ]);
  });

  it("lets the project copy win and appends the --doctrine file after it", async () => {
    await writeRepoFile(".claude/skills/phax-decide-spec/SKILL.md", PROJECT);
    await writeRepoFile("docs/doctrine/spec.md", "- `X1` **Project rule.**\n");
    const result = await run("docs/doctrine/spec.md");
    if (Either.isLeft(result)) throw result.left;
    const { text, principleIds, sources } = result.right;
    expect(text.startsWith(PROJECT)).toBe(true);
    expect(text).not.toContain("Bundled doctrine");
    expect(text.indexOf("## Project doctrine (docs/doctrine/spec.md)")).toBeGreaterThan(
      text.indexOf("Project copy"),
    );
    expect([...principleIds]).toEqual(["S1", "C4", "X1"]);
    expect(sources.map((s) => (s.kind === "skill" ? s.source : s.path))).toEqual([
      "project",
      "docs/doctrine/spec.md",
    ]);
  });

  it("reads the plan's project copy under phax-decide-plan", async () => {
    await writeRepoFile(".claude/skills/phax-decide-spec/SKILL.md", PROJECT);
    const result = await run(null, "plan");
    if (Either.isLeft(result)) throw result.left;
    expect(result.right.sources).toEqual([
      expect.objectContaining({ name: "phax-decide-plan", source: "bundled" }),
    ]);
  });

  it("refuses an unreadable doctrine file with reason doctrine", async () => {
    const result = await run("docs/doctrine/missing.md");
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toBeInstanceOf(DecideRefusedError);
    expect(result.left).toMatchObject({ reason: "doctrine" });
    expect(result.left.message).toContain("docs/doctrine/missing.md");
  });

  it("refuses a doctrine file that redefines a skill id", async () => {
    await writeRepoFile("docs/doctrine/clash.md", "- `S1` **Mine.**\n");
    const result = await run("docs/doctrine/clash.md");
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toMatchObject({ reason: "doctrine" });
    expect(result.left.message).toContain("`S1`");
  });

  it("refuses a doctrine file that defines no id", async () => {
    await writeRepoFile("docs/doctrine/prose.md", "Only prose, `X1` inline.\n");
    const result = await run("docs/doctrine/prose.md");
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toMatchObject({ reason: "doctrine" });
    expect(result.left.message).toContain("docs/doctrine/prose.md");
  });
});
