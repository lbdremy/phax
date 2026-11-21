/**
 * A process repository that links a code repository checked out (and ignored) at `code/`, for the
 * acceptance tests of the code-repository spec. Everything lives in one temporary directory: the
 * process repository, its code repository, two state roots and a HOME. Git is isolated with
 * `isolateGit()`, so no real ~/.phax, credential store or global git config is read.
 *
 * The builder changes the process's working directory to the process repository (commands are
 * called in-process, from there); `dispose()` puts it back.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isolateGit } from "../../helpers/isolateGit.js";
import { phaxCall } from "../../helpers/runnerCall.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { boundedOutput, GIT_BOUND_MS } from "../../helpers/boundedSpawn.js";

const OPERATOR = "Ada Example";
/** A fixed stamp: the fixture never reads the clock. */
const STAMP = "2611181000";

export interface LinkedProjectOptions {
  /** Declare `"code": { "root": "code" }` in the process phax.json. Default true. */
  readonly link?: boolean;
  /** Ignore `/code/` in the process repository. Default true. */
  readonly ignored?: boolean;
}

interface PlansStatusJson {
  readonly report: ReadonlyArray<{
    readonly path: string;
    readonly result: {
      readonly kind: string;
      readonly detail?: string;
      readonly message?: string;
      readonly evidence?: ReadonlyArray<{
        readonly reason: string;
        readonly baseline?: string;
        readonly files?: ReadonlyArray<string>;
        readonly codeRoot?: string;
      }>;
    };
  }>;
}

interface PlansStatusResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The parsed answer under `--json`, otherwise null. */
  readonly json: PlansStatusJson | null;
}

export interface LinkedProject {
  /** The temporary directory holding everything below. */
  readonly root: string;
  readonly processRepo: string;
  /** `<processRepo>/code`. */
  readonly codeRepo: string;
  /** The state roots of the process and code repositories, outside both. */
  readonly stateRoots: { readonly process: string; readonly code: string };
  /** Writes `docs/plans/<stamp>-<slug>-plan.md` (Draft) planning to edit `edits`, commits it,
   *  and answers its path relative to the process repository. */
  readonly writePlan: (
    slug: string,
    opts: { readonly edits: ReadonlyArray<string>; readonly sourceSpec: string | null },
  ) => string;
  /** Writes and commits an Approved-ready spec; answers its path. */
  readonly writeSpec: (slug: string) => string;
  /** `phax artifact approve <path> --by operator` from the process repository; throws on a
   *  non-zero exit. */
  readonly approve: (path: string) => Promise<void>;
  /** Writes a file of the code repository and commits it; answers the commit's sha. */
  readonly commitInCode: (path: string, text: string) => string;
  /** Writes a file of the process repository and commits it; answers the commit's sha. */
  readonly commitInProcess: (path: string, text: string) => string;
  /** Resets the code repository to the commit's parent, then expires the reflog and prunes, so
   *  `sha` no longer exists. */
  readonly dropCodeCommit: (sha: string) => void;
  /** Rewrites and commits the process phax.json: with the link to `root`, or without one. */
  readonly setLink: (root: string | null) => void;
  /** Rewrites and commits `.gitignore`: `/code/` ignored or not. */
  readonly setIgnored: (ignored: boolean) => void;
  readonly plansStatus: (flags: ReadonlyArray<string>) => Promise<PlansStatusResult>;
  /** The code repository's HEAD sha. */
  readonly codeHead: () => string;
  /** Puts the environment and working directory back and removes the temporary directory. */
  readonly dispose: () => void;
}

function sh(cwd: string, args: ReadonlyArray<string>): string {
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd }).trim();
}

function put(repo: string, rel: string, text: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function commitAll(repo: string, message: string): string {
  sh(repo, ["add", "-A"]);
  sh(repo, ["commit", "-q", "-m", message]);
  return sh(repo, ["rev-parse", "HEAD"]);
}

function configFor(name: string, stateRoot: string, link: string | null): string {
  return (
    JSON.stringify(
      {
        version: 1,
        name,
        state: { root: stateRoot },
        gateProfiles: { standard: [{ command: "true", surface: "local", firing: "every-phase" }] },
        publish: { auto: false },
        review: { compliance: { enabled: false } },
        ...(link === null ? {} : { code: { root: link } }),
      },
      null,
      2,
    ) + "\n"
  );
}

function specMd(slug: string): string {
  return `---
status: Draft
date: 2026-11-18
audience: test
scope: test
---
# ${slug}

## Overview

Body text.
`;
}

function planMd(slug: string, edits: ReadonlyArray<string>, sourceSpec: string | null): string {
  const list = edits.length === 0 ? "- (none)" : edits.map((e) => `- \`${e}\``).join("\n");
  const completes = sourceSpec === null ? "" : "completes-spec: true\n";
  return `---
status: Draft
source-spec: ${sourceSpec ?? "null"}
${completes}---
# ${slug} plan

## Overview

Plan body.

## Required commands

- (none)

## phase-01 — Step {#phase-01-step}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

${list}

### Optional files that may be edited

- (none)

### Commit subject

\`feat: ${slug}\`

### Commit body

Does ${slug}.
`;
}

export function createLinkedProject(opts: LinkedProjectOptions = {}): LinkedProject {
  const restoreGit = isolateGit();
  const savedCwd = process.cwd();
  const savedHome = process.env["HOME"];
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-linked-project-")));
  const home = join(root, "home");
  mkdirSync(home);
  process.env["HOME"] = home;

  const processRepo = join(root, "process");
  const codeRepo = join(processRepo, "code");
  const stateRoots = { process: join(root, "state-process"), code: join(root, "state-code") };
  mkdirSync(stateRoots.process);
  mkdirSync(stateRoots.code);
  mkdirSync(codeRepo, { recursive: true });

  for (const repo of [processRepo, codeRepo]) {
    sh(repo, ["init", "-q", "-b", "main"]);
    disableGitAutoMaintenance(repo);
    sh(repo, ["config", "--local", "user.name", OPERATOR]);
    sh(repo, ["config", "--local", "user.email", "ada@example.test"]);
    sh(repo, ["config", "--local", "commit.gpgsign", "false"]);
  }

  // The code repository: two source files and its own phax.json (publish off).
  put(codeRepo, "src/export/csv.ts", "export const csv = 1;\n");
  put(codeRepo, "src/other.ts", "export const other = 1;\n");
  put(codeRepo, "phax.json", configFor("code-repo", stateRoots.code, null));
  commitAll(codeRepo, "seed");

  // The process repository: phax.json and .gitignore; the code checkout stays untracked.
  const link = opts.link === false ? null : "code";
  put(processRepo, "phax.json", configFor("process-repo", stateRoots.process, link));
  put(processRepo, ".gitignore", opts.ignored === false ? "" : "/code/\n");
  put(processRepo, "README.md", "# process\n");
  commitAll(processRepo, "seed");

  process.chdir(processRepo);

  return {
    root,
    processRepo,
    codeRepo,
    stateRoots,
    writePlan: (slug, { edits, sourceSpec }) => {
      const path = `docs/plans/${STAMP}-${slug}-plan.md`;
      put(processRepo, path, planMd(slug, edits, sourceSpec));
      commitAll(processRepo, `plan ${slug}`);
      return path;
    },
    writeSpec: (slug) => {
      const path = `docs/specs/${STAMP}-${slug}.md`;
      put(processRepo, path, specMd(slug));
      commitAll(processRepo, `spec ${slug}`);
      return path;
    },
    approve: async (path) => {
      const result = await phaxCall(["artifact", "approve", path, "--by", "operator"]);
      if (result.code !== 0) {
        throw new Error(`approve ${path} exited ${result.code}: ${result.err}${result.out}`);
      }
    },
    commitInCode: (path, text) => {
      put(codeRepo, path, text);
      return commitAll(codeRepo, `change ${path}`);
    },
    commitInProcess: (path, text) => {
      put(processRepo, path, text);
      return commitAll(processRepo, `change ${path}`);
    },
    dropCodeCommit: (sha) => {
      sh(codeRepo, ["reset", "-q", "--hard", `${sha}~1`]);
      sh(codeRepo, ["reflog", "expire", "--expire=now", "--all"]);
      sh(codeRepo, ["gc", "-q", "--prune=now"]);
    },
    setLink: (target) => {
      put(processRepo, "phax.json", configFor("process-repo", stateRoots.process, target));
      commitAll(processRepo, "set link");
    },
    setIgnored: (ignored) => {
      put(processRepo, ".gitignore", ignored ? "/code/\n" : "");
      commitAll(processRepo, "set ignored");
    },
    plansStatus: async (flags) => {
      const result = await phaxCall(["plans", "status", ...flags]);
      const json = flags.includes("--json") ? (JSON.parse(result.out) as PlansStatusJson) : null;
      return { code: result.code, stdout: result.out, stderr: result.err, json };
    },
    codeHead: () => sh(codeRepo, ["rev-parse", "HEAD"]),
    dispose: () => {
      process.chdir(savedCwd);
      if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
      removeTempDir(root);
      restoreGit();
    },
  };
}
