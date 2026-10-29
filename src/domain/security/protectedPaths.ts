// Protected paths: the files whose change is the operator's decision. No phase
// of a run may land a change to them. Pure: infra observes the worktree, this
// module judges the observation. (Line comments, because globs hold `**/`.)
//
// Contract:
//
// - `protectedList(declared, configPath)` is null when `declared` is undefined.
//   Otherwise it holds each declared glob, in order, with entry
//   `protectedPaths[N]` (counted from 0), then `{ glob: configPath, entry:
//   configPath }` unless a declared glob is exactly `configPath`. `configPath`
//   is the repo-relative POSIX path of the phax.json phax loaded, such as
//   `phax.json` or `pkg/phax.json`.
// - `matchProtected(list, path)` is the first entry, in list order, whose glob
//   matches the path in phax's glob dialect, with glob and path both
//   lowercased (`toLowerCase`) and no Unicode normalization.
// - `protectedChanges(list, observation)` yields one change per protected
//   path, sorted by path, spelt as observed:
//   - a `renamed` entry names each side that matches as `renamed`;
//   - `added` and an untracked path give `created`;
//   - `modified`, `type-changed` and a tracked state of `content` or `type`
//     give `edited`;
//   - `deleted` and a tracked state of `missing` give `deleted`.
//   When the evidence for one path disagrees, `renamed` wins over `created`,
//   `created` over `deleted`, and `deleted` over `edited`.
//   Then, failing closed, one change per observed link that no path change
//   names and that an entry reaches below (`reachesBelow`): a symbolic link
//   gives `symlink`, a nested repository `nested-repository`, with the first
//   such entry in list order. An ignored symbolic link whose target is inside
//   the worktree is let through for an entry its target mirrors
//   (`mirroredAtTarget`): every file below it is checked at its real path.
// - `reachesBelow(glob, path)`: the glob, case-folded, could match a path
//   below `path` — some leading run of its segments matches `path` and
//   segments are left after it, or that run ends with `**`. A glob starting
//   with `**/` reaches below every path.
// - `mirroredAtTarget(glob, path)`: the glob is `**/` followed by segments
//   none of which is `**`, and no leading run of those segments, shorter than
//   all of them, matches the last segments of `path`, case-folded. Such a
//   glob matches `path/rest` exactly when it matches `target/rest`.
// - Native forms: a glob holding none of `*`, `?`, `[`, `]` is a literal path;
//   `**/` followed by such a rest is an any-depth path; any other glob has no
//   native form.
// - `claudeProtectedDenyRules(root, list)` gives `Edit(/<root>/<glob>)` per
//   glob with a native form, in list order, `<root>` being the worktree root
//   with trailing slashes removed (an absolute root gives `Edit(//…)`).
// - `vibeProtectedDenylist(root, list)` gives, in list order, `<root>/<path>`
//   per literal glob, and `<root>/<rest>` then `<root>/**/<rest>` per
//   any-depth glob.
// - `protectedEnforcement(list, provider, mode)` is `commit-check-only` for
//   codex-cli or any mode but `secure`; otherwise `enforced` when every entry
//   has a native form, `partial` when some do, `commit-check-only` when none
//   do.
// - `submoduleConflict(declared, submodules)` is the first declared glob whose
//   leading literal segments (those before the first segment holding `*` or
//   `?`) reach a submodule: case-folded, their joined path equals the
//   submodule's path or starts with it followed by `/`. Undefined otherwise.
import { matchesGlob } from "../architecture/glob.js";
import type { ProviderId } from "../routing/types.js";
import type { SecurityMode } from "./types.js";

export interface ProtectedEntry {
  readonly glob: string;
  readonly entry: string;
}

export type ProtectedList = readonly ProtectedEntry[];

/** How a path changed; `symlink` and `nested-repository` name a link a
 *  protected glob could reach below, which the check cannot see through. */
export type ProtectedChangeKind =
  | "created"
  | "edited"
  | "deleted"
  | "renamed"
  | "symlink"
  | "nested-repository";

export interface ProtectedChange {
  readonly path: string;
  readonly kind: ProtectedChangeKind;
  readonly entry: string;
  readonly glob: string;
}

/** One change as the operator and the agent read it: `<path> — <kind> (<entry> <glob>)`.
 *  The implied phax.json entry, whose glob is its entry, shows once. */
export function describeProtectedChange(change: ProtectedChange): string {
  const names = change.entry === change.glob ? change.entry : `${change.entry} ${change.glob}`;
  return `${change.path} — ${change.kind} (${names})`;
}

/** At least one protected change: what a `protected-paths` failure names. */
export type NonEmptyProtectedChanges = readonly [ProtectedChange, ...ProtectedChange[]];

export type ObservedEntry =
  | { readonly status: "added" | "modified" | "deleted" | "type-changed"; readonly path: string }
  | { readonly status: "renamed"; readonly path: string; readonly oldPath: string };

export type TrackedState = "same" | "content" | "type" | "missing";

/**
 * A path below which the observation sees nothing of what a reader of it
 * would. `tree`: a symbolic link the staged tree adds, retargets or puts in
 * place of a file. `ignored`: an untracked symbolic link git ignores, whose
 * target resolves to a path inside the worktree (not its root, not under
 * `.phax-context/`), or `elsewhere` (outside it, there, or nowhere). A nested
 * repository: an untracked directory that is a repository, or a gitlink the
 * staged tree adds.
 */
export type ObservedLink =
  | { readonly type: "symlink"; readonly path: string; readonly source: "tree" }
  | {
      readonly type: "symlink";
      readonly path: string;
      readonly source: "ignored";
      readonly into: "worktree" | "elsewhere";
    }
  | { readonly type: "nested-repository"; readonly path: string };

export interface ProtectedObservation {
  readonly entries: readonly ObservedEntry[];
  readonly tracked: readonly { readonly path: string; readonly state: TrackedState }[];
  readonly untracked: readonly string[];
  readonly links: readonly ObservedLink[];
}

export type ProtectedEnforcement = "enforced" | "partial" | "commit-check-only";

export interface SubmoduleConflict {
  readonly index: number;
  readonly glob: string;
  readonly submodule: string;
}

export interface NativeProtectedGlob {
  readonly glob: string;
  readonly form: "literal" | "any-depth";
  readonly path: string;
}

export function protectedList(
  declared: readonly string[] | undefined,
  configPath: string,
): ProtectedList | null {
  if (declared === undefined) return null;
  const entries = declared.map((glob, index) => ({ glob, entry: `protectedPaths[${index}]` }));
  return declared.includes(configPath)
    ? entries
    : [...entries, { glob: configPath, entry: configPath }];
}

export function matchProtected(list: ProtectedList, path: string): ProtectedEntry | undefined {
  const folded = path.toLowerCase();
  return list.find((entry) => matchesGlob(entry.glob.toLowerCase(), folded));
}

type PathChangeKind = "created" | "edited" | "deleted" | "renamed";

// Higher wins when the evidence for one path disagrees: a rename's source is
// also tracked `missing`, and stays `renamed`.
const KIND_RANK: Record<PathChangeKind, number> = {
  renamed: 3,
  created: 2,
  deleted: 1,
  edited: 0,
};

export function protectedChanges(
  list: ProtectedList,
  observation: ProtectedObservation,
): readonly ProtectedChange[] {
  const evidence = new Map<string, PathChangeKind>();
  const note = (path: string, kind: PathChangeKind): void => {
    const known = evidence.get(path);
    if (known === undefined || KIND_RANK[kind] > KIND_RANK[known]) evidence.set(path, kind);
  };
  for (const observed of observation.entries) {
    switch (observed.status) {
      case "renamed":
        note(observed.path, "renamed");
        note(observed.oldPath, "renamed");
        break;
      case "added":
        note(observed.path, "created");
        break;
      case "deleted":
        note(observed.path, "deleted");
        break;
      case "modified":
      case "type-changed":
        note(observed.path, "edited");
        break;
    }
  }
  for (const { path, state } of observation.tracked) {
    if (state === "content" || state === "type") note(path, "edited");
    else if (state === "missing") note(path, "deleted");
  }
  for (const path of observation.untracked) note(path, "created");

  const changes: ProtectedChange[] = [];
  for (const [path, kind] of evidence) {
    const matched = matchProtected(list, path);
    if (matched !== undefined) {
      changes.push({ path, kind, entry: matched.entry, glob: matched.glob });
    }
  }
  const named = new Set(changes.map((change) => change.path));
  for (const link of observation.links) {
    if (named.has(link.path)) continue;
    const mirrored =
      link.type === "symlink" && link.source === "ignored" && link.into === "worktree";
    const reaching = list.find(
      (entry) =>
        reachesBelow(entry.glob, link.path) &&
        !(mirrored && mirroredAtTarget(entry.glob, link.path)),
    );
    if (reaching === undefined) continue;
    named.add(link.path);
    changes.push({
      path: link.path,
      kind: link.type,
      entry: reaching.entry,
      glob: reaching.glob,
    });
  }
  return changes.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function reachesBelow(glob: string, path: string): boolean {
  const segments = glob.toLowerCase().split("/");
  const folded = path.toLowerCase();
  for (let run = 1; run <= segments.length; run++) {
    if (run === segments.length && segments[run - 1] !== "**") break;
    if (matchesGlob(segments.slice(0, run).join("/"), folded)) return true;
  }
  return false;
}

export function mirroredAtTarget(glob: string, path: string): boolean {
  const segments = glob.toLowerCase().split("/");
  if (segments[0] !== "**") return false;
  const rest = segments.slice(1);
  if (rest.length === 0 || rest.includes("**")) return false;
  const folded = path.toLowerCase();
  for (let run = 1; run < rest.length; run++) {
    if (matchesGlob(["**", ...rest.slice(0, run)].join("/"), folded)) return false;
  }
  return true;
}

const WILDCARD = /[*?[\]]/;

/** The globs of `list` with a native form, in list order. */
export function nativeProtectedGlobs(list: ProtectedList): readonly NativeProtectedGlob[] {
  const native: NativeProtectedGlob[] = [];
  for (const { glob } of list) {
    if (!WILDCARD.test(glob)) {
      native.push({ glob, form: "literal", path: glob });
    } else if (glob.startsWith("**/") && !WILDCARD.test(glob.slice(3))) {
      native.push({ glob, form: "any-depth", path: glob.slice(3) });
    }
  }
  return native;
}

function trimTrailingSlashes(root: string): string {
  let end = root.length;
  while (end > 0 && root[end - 1] === "/") end--;
  return root.slice(0, end);
}

export function claudeProtectedDenyRules(
  worktreeRoot: string,
  list: ProtectedList,
): readonly string[] {
  const root = trimTrailingSlashes(worktreeRoot);
  return nativeProtectedGlobs(list).map(({ glob }) => `Edit(/${root}/${glob})`);
}

export function vibeProtectedDenylist(
  worktreeRoot: string,
  list: ProtectedList,
): readonly string[] {
  const root = trimTrailingSlashes(worktreeRoot);
  return nativeProtectedGlobs(list).flatMap(({ form, path }) =>
    form === "literal" ? [`${root}/${path}`] : [`${root}/${path}`, `${root}/**/${path}`],
  );
}

export function protectedEnforcement(
  list: ProtectedList,
  provider: ProviderId,
  mode: SecurityMode,
): ProtectedEnforcement {
  if (provider === "codex-cli" || mode !== "secure") return "commit-check-only";
  const native = nativeProtectedGlobs(list).length;
  if (native === 0) return "commit-check-only";
  return native === list.length ? "enforced" : "partial";
}

export function submoduleConflict(
  declared: readonly string[],
  submodules: readonly string[],
): SubmoduleConflict | undefined {
  for (const [index, glob] of declared.entries()) {
    const segments = glob.toLowerCase().split("/");
    const stop = segments.findIndex((segment) => /[*?]/.test(segment));
    const leading = (stop === -1 ? segments : segments.slice(0, stop)).join("/");
    if (leading === "") continue;
    const submodule = submodules.find((candidate) => {
      const folded = candidate.toLowerCase();
      return leading === folded || leading.startsWith(`${folded}/`);
    });
    if (submodule !== undefined) return { index, glob, submodule };
  }
  return undefined;
}
