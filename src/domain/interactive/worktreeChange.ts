// Whether a phax turn (or a person) changed a stopped phase's worktree. The
// snapshots leave `.phax-context/` out, so the person's handoff file is
// compared by hash and folded in here. Pure: the app takes the snapshots.

/** The person's handoff file, which snapshots do not see. */
export const PERSON_HANDOFF_PATH = ".phax-context/correction-handoff.md";

const PHAX_CONTEXT_PREFIX = ".phax-context/";

/** One row of `git diff-tree -r --name-status --no-renames`. */
export interface ChangedPath {
  readonly status: "A" | "M" | "D" | "T";
  readonly path: string;
}

type PersonHandoffChange = "unchanged" | "created" | "modified" | "deleted";

export type WorktreeChangeVerdict =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "changed";
      /** Sorted and never empty. */
      readonly paths: readonly string[];
      readonly personHandoff: PersonHandoffChange;
    };

export interface WorktreeChangeInput {
  /** The snapshot tree ids before and after. */
  readonly before: string;
  readonly after: string;
  /** The name-status list between them. */
  readonly changed: readonly ChangedPath[];
  /** The sha256 of the person's handoff file before and after, or null when absent. */
  readonly personHandoffBefore: string | null;
  readonly personHandoffAfter: string | null;
}

function personHandoffChange(before: string | null, after: string | null): PersonHandoffChange {
  if (before === after) return "unchanged";
  if (before === null) return "created";
  if (after === null) return "deleted";
  return "modified";
}

/**
 * `unchanged` when the two trees are the same and the person's handoff file
 * is the same. Otherwise `changed`, with the sorted changed paths: those of
 * the tree difference outside `.phax-context/`, plus the person's handoff
 * file when it was created, modified or deleted. The paths of the list count
 * only when the tree ids differ.
 */
export function worktreeChangeVerdict(input: WorktreeChangeInput): WorktreeChangeVerdict {
  const personHandoff = personHandoffChange(input.personHandoffBefore, input.personHandoffAfter);
  const paths = new Set<string>();
  if (input.before !== input.after) {
    for (const entry of input.changed) {
      if (!entry.path.startsWith(PHAX_CONTEXT_PREFIX)) paths.add(entry.path);
    }
  }
  if (personHandoff !== "unchanged") paths.add(PERSON_HANDOFF_PATH);
  if (paths.size === 0) return { kind: "unchanged" };
  return { kind: "changed", paths: [...paths].toSorted(), personHandoff };
}
