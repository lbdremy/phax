/**
 * `resolvePlanLink` over real git in temporary directories: where a plan given to `phax run`
 * lives. Loose for every layout that is not a process repository linking the run's repository,
 * whatever else that repository's phax.json holds; linked for the one that is; and a refusal
 * naming the process phax.json only where phax cannot tell whether a plan of its docs/plans/ is
 * linked, or where the link names the run's repository but is unusable.
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

  function build(opts: {
    readonly config?: string | null;
    readonly ignore?: string;
    /** The process repository's index holds the code root as a gitlink (`git add code`). */
    readonly tracked?: boolean;
  }): Layout {
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
    mkdirSync(join(layout.codeRepo, "src"), { recursive: true });
    put(join(layout.codeRepo, "src", "a.ts"), "export {};\n");
    if (opts.tracked === true) {
      sh(layout.codeRepo, "add", "-A");
      sh(layout.codeRepo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
      sh(layout.processRepo, "add", "-f", "code");
    }
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
    {
      name: "a process phax.json with no code whose other keys do not decode",
      options: { config: JSON.stringify({ version: 99, gateProfiles: "none" }) },
      run: (l) => [l.codeRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a link to another repository in a phax.json whose other keys do not decode",
      options: { config: JSON.stringify({ code: { root: "code" } }) },
      run: (l) => [l.otherRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a link to another repository that would not decode",
      options: { config: JSON.stringify({ code: { root: "code", extra: 1 } }) },
      run: (l) => [l.otherRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a link whose root is not canonical and resolves to another repository",
      options: { config: phaxJson("../other") },
      run: (l) => [l.codeRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a link whose root does not exist",
      options: { config: phaxJson("gone") },
      run: (l) => [l.codeRepo, join(l.processRepo, PLAN_REL)],
    },
    {
      name: "a plan outside docs/plans/ of a repository whose phax.json is not JSON",
      options: { config: "{ not json" },
      run: (l) => [l.codeRepo, join(l.processRepo, "notes", "plan.md")],
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

  it("is linked when the phax.json's other keys do not decode: only code is read", async () => {
    const layout = build({ config: JSON.stringify({ code: { root: "code" }, version: 99 }) });
    const answer = await run(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(answer.kind).toBe("linked");
  });

  it.each([
    ["is not JSON", "{ not json", "is not valid JSON"],
    ["is not a JSON object", "[]", "is not a JSON object"],
    ["declares code with no root string", JSON.stringify({ code: "code" }), '"root" string'],
  ])(
    "refuses a plan of docs/plans/ whose process phax.json %s: phax cannot tell whether it is linked",
    async (_name, config, reason) => {
      const layout = build({ config });
      const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
      expect(text).toContain(join(layout.processRepo, "phax.json"));
      expect(text).toContain(`Cannot tell whether ${PLAN_REL} is linked to this repository`);
      expect(text).toContain(reason);
    },
  );

  it("refuses a link to this repository whose code key does not decode, naming the phax.json", async () => {
    const layout = build({ config: JSON.stringify({ code: { root: "code", extra: 1 } }) });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
    expect(text).toContain("extra");
  });

  it("refuses a link to this repository whose root is not written canonically", async () => {
    const layout = build({ config: phaxJson("./code") });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain('code.root "./code": must be written code');
  });

  it("refuses a link into this repository that is not its top level", async () => {
    const layout = build({ config: phaxJson("code/src") });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain('code.root "code/src": not the top level of a git repository');
  });

  it("refuses a link to this repository that the process repository ignores but tracks", async () => {
    const layout = build({ tracked: true });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
    expect(text).toContain('code.root "code": tracked by this repository');
    expect(text).toContain("git rm -r --cached code");
  });

  it("reads the phax.json nearest the plan, walking up to the process repository's root", async () => {
    const layout = build({ config: phaxJson(null) });
    put(join(layout.processRepo, "docs", "phax.json"), phaxJson("code"));
    const answer = await run(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(answer.kind).toBe("linked");
  });

  it("refuses a link that is not ignored by the process repository", async () => {
    const layout = build({ ignore: "" });
    const text = await refusal(layout.codeRepo, join(layout.processRepo, PLAN_REL));
    expect(text).toContain(join(layout.processRepo, "phax.json"));
    expect(text).toContain('code.root "code": not ignored by this repository');
    expect(text).toContain("add /code/ to .gitignore");
  });
});
