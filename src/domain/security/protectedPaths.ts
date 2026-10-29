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
//   Which kind wins when the evidence for one path disagrees is not part of
//   this contract's oracles.
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
import type { ProviderId } from "../routing/types.js";
import type { SecurityMode } from "./types.js";

export interface ProtectedEntry {
  readonly glob: string;
  readonly entry: string;
}

export type ProtectedList = readonly ProtectedEntry[];

export type ProtectedChangeKind = "created" | "edited" | "deleted" | "renamed";

export interface ProtectedChange {
  readonly path: string;
  readonly kind: ProtectedChangeKind;
  readonly entry: string;
  readonly glob: string;
}

export type ObservedEntry =
  | { readonly status: "added" | "modified" | "deleted" | "type-changed"; readonly path: string }
  | { readonly status: "renamed"; readonly path: string; readonly oldPath: string };

export type TrackedState = "same" | "content" | "type" | "missing";

export interface ProtectedObservation {
  readonly entries: readonly ObservedEntry[];
  readonly tracked: readonly { readonly path: string; readonly state: TrackedState }[];
  readonly untracked: readonly string[];
}

export type ProtectedEnforcement = "enforced" | "partial" | "commit-check-only";

export interface SubmoduleConflict {
  readonly index: number;
  readonly glob: string;
  readonly submodule: string;
}

export function protectedList(
  _declared: readonly string[] | undefined,
  _configPath: string,
): ProtectedList | null {
  throw new Error("not implemented: protectedList");
}

export function matchProtected(_list: ProtectedList, _path: string): ProtectedEntry | undefined {
  throw new Error("not implemented: matchProtected");
}

export function protectedChanges(
  _list: ProtectedList,
  _observation: ProtectedObservation,
): readonly ProtectedChange[] {
  throw new Error("not implemented: protectedChanges");
}

export function claudeProtectedDenyRules(
  _worktreeRoot: string,
  _list: ProtectedList,
): readonly string[] {
  throw new Error("not implemented: claudeProtectedDenyRules");
}

export function vibeProtectedDenylist(
  _worktreeRoot: string,
  _list: ProtectedList,
): readonly string[] {
  throw new Error("not implemented: vibeProtectedDenylist");
}

export function protectedEnforcement(
  _list: ProtectedList,
  _provider: ProviderId,
  _mode: SecurityMode,
): ProtectedEnforcement {
  throw new Error("not implemented: protectedEnforcement");
}

export function submoduleConflict(
  _declared: readonly string[],
  _submodules: readonly string[],
): SubmoduleConflict | undefined {
  throw new Error("not implemented: submoduleConflict");
}
