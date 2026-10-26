// A fixture repository for the release notes reader: a temporary git
// repository with a local identity, made-up versions (a ledger of 4.0.0 and
// 4.1.0, the tag v4.1.0, the opened version 4.2.0), and builders for the
// plans, specs and sidecars it reads. Git is isolated from the person's
// configuration until `dispose`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isolateGit } from "../../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { validDocuments, withKey } from "../schemasPackage/documents.js";

export const PREVIOUS = "4.1.0";
export const OPENED = "4.2.0";

interface CommitOptions {
  readonly body?: string;
  /** A run commit: phax's layout (body, `---`, trailers) with Run-Id and Short-Name. */
  readonly runId?: string;
  readonly shortName?: string;
  /** The whole message, instead of the subject and body. */
  readonly message?: string;
}

export interface FixtureRepo {
  readonly root: string;
  /** Runs git in the repository and returns its stdout. */
  git(...args: string[]): string;
  /** Writes a file under the root, creating its folders. */
  write(path: string, content: string): void;
  /** Stages everything and commits it, even when nothing changed; returns the hash. */
  commit(subject: string, options?: CommitOptions): string;
  tag(name: string): void;
  /** Restores the environment and removes the repository. */
  dispose(): void;
}

/** An empty repository on `main` with a local identity; git is isolated until `dispose`. */
function createFixtureRepo(): FixtureRepo {
  const restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-release-notes-")));
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  disableGitAutoMaintenance(root);
  git("config", "--local", "user.name", "Fixture");
  git("config", "--local", "user.email", "fixture@example.invalid");
  git("config", "--local", "commit.gpgsign", "false");
  git("config", "--local", "tag.gpgsign", "false");
  return {
    root,
    git,
    write(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
    commit(subject, options = {}) {
      git("add", "-A");
      const trailers = [
        ...(options.runId === undefined ? [] : [`Run-Id: ${options.runId}`]),
        ...(options.shortName === undefined ? [] : [`Short-Name: ${options.shortName}`]),
      ];
      const parts =
        options.runId === undefined
          ? [subject, ...(options.body === undefined ? [] : [options.body]), trailers.join("\n")]
          : [subject, options.body ?? "", "---", trailers.join("\n")];
      const message = options.message ?? `${parts.filter((part) => part !== "").join("\n\n")}\n`;
      execFileSync("git", ["commit", "-q", "--allow-empty", "-F", "-"], {
        cwd: root,
        input: message,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return git("rev-parse", "HEAD").trim();
    },
    tag(name) {
      git("tag", name);
    },
    dispose() {
      removeTempDir(root);
      restoreGit();
    },
  };
}

export const UPGRADING_TEXT = ["# Upgrading", "", "### 4.2.0", "", "- Do the thing.", ""].join(
  "\n",
);

/**
 * A repository at the previous release: package.json naming the opened
 * version, the ledger, docs/upgrading.md, one commit tagged v4.1.0.
 * `beforeTag` writes files that belong to the tagged commit.
 */
export function releasedRepo(beforeTag?: (repo: FixtureRepo) => void): FixtureRepo {
  const repo = createFixtureRepo();
  beforeTag?.(repo);
  repo.write("package.json", `${JSON.stringify({ name: "fixture", version: OPENED }, null, 2)}\n`);
  repo.write(
    "packages/schemas/releases.json",
    `${JSON.stringify({ releases: ["4.0.0", PREVIOUS] }, null, 2)}\n`,
  );
  repo.write("docs/upgrading.md", UPGRADING_TEXT);
  repo.commit("chore: release v4.1.0");
  repo.tag(`v${PREVIOUS}`);
  return repo;
}

export interface PlanFile {
  readonly stamp: string;
  readonly slug: string;
  readonly title: string;
  readonly lede?: string;
  readonly status?: string;
  /** The `source-spec` path with `completes-spec`; `source-spec: null` without. */
  readonly spec?: { readonly path: string; readonly completes: boolean };
  /** The run's short name and title in the sidecar; no sidecar when null. */
  readonly run?: { readonly shortName: string; readonly title: string } | null;
}

/** The archived path of a plan. */
export function planPath(plan: Pick<PlanFile, "stamp" | "slug">): string {
  return `docs/plans/archive/${plan.stamp}-${plan.slug}-plan.md`;
}

/** The text of a plan's Markdown. */
function planMarkdown(plan: PlanFile): string {
  const front = [
    `status: ${plan.status ?? "Completed"}`,
    ...(plan.spec === undefined
      ? ["source-spec: null"]
      : [`source-spec: ${plan.spec.path}`, `completes-spec: ${plan.spec.completes}`]),
  ];
  return [
    "---",
    ...front,
    "---",
    "",
    `# ${plan.title}`,
    "",
    plan.lede ?? `What ${plan.title} delivers.`,
    "",
    "## Phases",
    "",
  ].join("\n");
}

/** A current plan sidecar whose run has the given short name and title. */
function planSidecar(run: { shortName: string; title: string }): string {
  const document = withKey(validDocuments["plan-document"], "run", {
    shortName: run.shortName,
    title: run.title,
    requiredCommands: [],
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Writes an archived plan (and its sidecar unless `run` is null) without committing it. */
export function writePlan(repo: FixtureRepo, plan: PlanFile): string {
  const path = planPath(plan);
  repo.write(path, planMarkdown(plan));
  const run = plan.run === undefined ? { shortName: plan.slug, title: plan.title } : plan.run;
  if (run !== null) repo.write(path.replace(/\.md$/, ".json"), planSidecar(run));
  return path;
}

export interface SpecFile {
  /** The spec's repo-relative path, under docs/specs/ or docs/specs/archive/. */
  readonly path: string;
  readonly title: string;
  readonly guidingRule?: string;
  readonly surface?: ReadonlyArray<{
    readonly surface: string;
    readonly summary: string;
    readonly before: string | null;
    readonly after: string;
  }>;
  /** No sidecar: the spec is the Markdown alone. */
  readonly noSidecar?: boolean;
}

/** A current spec sidecar. */
function specSidecar(spec: SpecFile): string {
  const base = validDocuments["spec-document"];
  const document = withKey(
    withKey(withKey(base, "title", spec.title), "productGoal", {
      statement: "Make it so.",
      guidingRule: spec.guidingRule ?? "Say what is.",
    }),
    "surface",
    (spec.surface ?? []).map((element) => ({ ...element, binding: "normative" })),
  );
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Writes a spec (and its sidecar unless `noSidecar`) without committing it. */
export function writeSpec(repo: FixtureRepo, spec: SpecFile): void {
  repo.write(spec.path, `# ${spec.title}\n`);
  if (spec.noSidecar !== true) repo.write(spec.path.replace(/\.md$/, ".json"), specSidecar(spec));
}
