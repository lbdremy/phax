// The release notes of a version, built from decoded facts. Pure: no file, no
// git and no process, so the Node test suite can typecheck and unit-test it.
// scripts/release-notes.ts gathers the input from git, the plans, the specs
// and docs/upgrading.md, and applies this module.
export interface ReleaseNotesInput {
  readonly version: string; // the release, X.Y.Z
  readonly previous: string; // the previous release, X.Y.Z
  readonly repository: string; // e.g. https://github.com/lbdremy/phax, no trailing slash
  readonly upgrading: string; // the whole text of docs/upgrading.md
  readonly plans: ReadonlyArray<ReleasePlan>; // the plans the release's runs delivered, in run order
  readonly commits: ReadonlyArray<ReleaseCommit>; // the commits outside any announced run, oldest first
}

export interface ReleasePlan {
  readonly path: string; // repo-relative plan.md path, for messages
  readonly title: string; // the plan's # heading, plain text
  readonly firstParagraph: string; // the first paragraph under the title, raw Markdown
  readonly spec: ReleaseSpec | null; // null: the plan has no source spec
  readonly completesSpec: boolean; // the plan's completes-spec; false when spec is null
}

export interface ReleaseSpec {
  readonly path: string; // repo-relative spec .md path where it was found; identifies the spec
  readonly title: string;
  readonly guidingRule: string | null; // null when the spec has no sidecar
  readonly surface: ReadonlyArray<ReleaseSurface>; // empty when the spec has no sidecar
}

export interface ReleaseSurface {
  readonly surface: string;
  readonly summary: string;
  readonly before: string | null;
  readonly after: string;
}

export interface ReleaseCommit {
  readonly hash: string; // full 40-hex hash
  readonly subject: string;
}

export interface ReleaseNotes {
  readonly markdown: string;
  readonly warnings: ReadonlyArray<string>;
}

export function renderReleaseNotes(_input: ReleaseNotesInput): ReleaseNotes {
  throw new Error("renderReleaseNotes is not implemented");
}

export function githubReleaseBody(_markdown: string, _version: string): string {
  throw new Error("githubReleaseBody is not implemented");
}
