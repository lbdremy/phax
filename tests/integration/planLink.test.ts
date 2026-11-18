/**
 * `resolvePlanLink` over real git in temporary directories: where a plan given to `phax run`
 * lives, as the discovery arbitration of the code-repository spec says — loose for every layout
 * that is not a process repository linking the run's repository, linked for the one that is, and
 * a refusal naming the process phax.json when its link is declared but unusable.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type PlanLink, resolvePlanLink } from "../../src/app/planLink.js";
import { ConfigValidationError } from "../../src/domain/errors.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { removeTempDir } from "../helpers/tempGit.js";

const PLAN_REL = "docs/plans/2611181000-export-plan.md";

function sh(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function phaxJson(code: string | null): string {
  return JSON.stringify({
    version: 1,
    name: "process-repo",
    gateProfiles: { standard: [{ command: "true", surface: "local", firing: "every-phase" }] },
    ...(code === null ? {} : { code: { root: code } }),
  });
}

interface Layout {
  readonly processRepo: string;
  /** The code checkout the process repository links. */
  readonly codeRepo: string;
  /** Another repository, unrelated to the process repository. */
  readonly otherRepo: string;
  /** A directory in no repository. */
  readonly bare: string;
}

describe("resolvePlanLink", () => {
  let root: string | undefined;
  let restoreGit: (() => void) | undefined;

  afterEach(() => {
    removeTempDir(root);
    restoreGit?.();
    root = undefined;
    restoreGit = undefined;
  });

  function build(opts: { readonly config?: string | null; readonly ignore?: string }): Layout {
    restoreGit = isolateGit();
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-plan-link-")));
    const layout: Layout = {
      processRepo: join(root, "process"),
      codeRepo: join(root, "process", "code"),
      otherRepo: join(root, "other"),
      bare: join(root, "bare"),
    };
    for (const dir of [layout.processRepo, layout.codeRepo, layout.otherRepo, layout.bare]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const repo of [layout.processRepo, layout.codeRepo, layout.otherRepo])
      sh(repo, "init", "-q");
    const config = opts.config === undefined ? phaxJson("code") : opts.config;
    if (config !== null) put(join(layout.processRepo, "phax.json"), config);
    put(join(layout.processRepo, ".gitignore"), opts.ignore ?? "/code/\n");
    put(join(layout.processRepo, PLAN_REL), "# plan\n");
    put(join(layout.processRepo, "notes", "plan.md"), "# notes\n");
    put(join(layout.bare, "plan.md"), "# bare\n");
    return layout;
  }

  const run = (runRepoRoot: string, planAbsolute: string) =>
    Effect.runPromise(
      resolvePlanLink({ runRepoRoot, planAbsolute }).pipe(
        Effect.provide(Layer.mergeAll(NodeGitLayer, NodeFileSystemLayer)),
      ),
    );

  /** The refusal as text: the file it names, then its message. */
  const refusal = async (runRepoRoot: string, planAbsolute: string): Promise<string> => {
    const error = await Effect.runPromise(
      resolvePlanLink({ runRepoRoot, planAbsolute }).pipe(
        Effect.flip,
        Effect.provide(Layer.mergeAll(NodeGitLayer, NodeFileSystemLayer)),
      ),
    );
    expect(error).toBeInstanceOf(ConfigValidationError);
    return `${(error as ConfigValidationError).path ?? ""}\n${error.message}`;
  };

  const loose: PlanLink = { kind: "loose" };

  const layouts: ReadonlyArray<{
    readonly name: string;
    readonly options: { readonly config?: string | null; readonly ignore?: string };
    readonly run: (l: Layout) => readonly [string, string];
  }> = [
    {
      name: "a plan inside the run repository",
      options: {},
      run: (l) => [l.codeRepo, join(l.processRepo, "code", "docs", "plans", "p-plan.md")],
    },
    {
      name: "a plan in a directory of no repository",
      options: {},
      run: (l) => [l.codeRepo, join(l.bare, "plan.md")],
    },
    {
      name: "a plan outside docs/plans/ of the process repository",
      options: {},
      run: (l) => [l.codeRepo, join(l.processRepo, "notes", "plan.md")],
    },
    {
      name: "a process repository without code",
      options: { config: phaxJson(null) },
      run: (l) => [l.codeRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a process repository without a phax.json",
      options: { config: null },
      run: (l) => [l.codeRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a process repository whose link names another repository",
      options: {},
      run: (l) => [l.otherRepo, join(l.processRepo, PLAN_REL)],
    },
  ];

  it.each(layouts)("is loose for $name", async ({ options, run: pick }) => {
    const layout = build(options);
    const [runRepoRoot, planAbsolute] = pick(layout);
    expect(await run(runRepoRoot, planAbsolute)).toEqual(loose);
  });

  it("is linked for a process repository that links this repository, with the process-relative path", async () => {
    const layout = build({});
    const answer = await run(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(answer).toEqual({
      kind: "linked",
      processRoot: layout.processRepo,
      planPath: PLAN_REL,
      link: { root: "code", path: layout.codeRepo },
    });
  });

  it("is linked when the plan is reached through ../ from the code repository", async () => {
    const layout = build({});
    const answer = await run(layout.codeRepo, join(layout.codeRepo, "..", PLAN_REL));
    expect(answer.kind).toBe("linked");
  });

  it("refuses a process phax.json that is not JSON, naming it", async () => {
    const layout = build({ config: "{ not json" });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
  });

  it("refuses a process phax.json that is not a JSON object, naming it", async () => {
    const layout = build({ config: "[]" });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
    expect(text).toContain("not a JSON object");
  });

  it("refuses a process phax.json that declares code but does not decode, naming it", async () => {
    const layout = build({ config: JSON.stringify({ code: { root: "code" } }) });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
  });

  it("refuses a link that is not ignored by the process repository", async () => {
    const layout = build({ ignore: "" });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
    expect(text).toContain('code.root "code": not ignored by this repository');
    expect(text).toContain("add /code/ to .gitignore");
  });
});
