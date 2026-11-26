// Where a fixed finding's latest fix landed (spec finding-fix-identity §5.3 to §5.8): pure. On
// one branch, the recorded commit when the branch reaches it, else the commits of the search
// range that carry the fix's fate key (its `Finding-Run` and `Finding` trailers in one
// paragraph), else, when the repository holds the recorded commit, the range's commits with its
// patch id. One match is found, two or more are ambiguous, none sends the search to the next
// branch. The use case gathers the facts through the Git port, lazily: a step that needs a fact
// not yet gathered says so, and the use case gathers it and asks again.

/** What resolving a fixed finding's latest fix answers. `recorded` is the sha its record names. */
export type Landed =
  | {
      readonly status: "found";
      readonly by: "recorded" | "key" | "patch-id";
      readonly commit: string;
      readonly branch: string;
      readonly recorded: string;
    }
  | {
      readonly status: "ambiguous";
      /** Two or more, oldest first. */
      readonly commits: readonly string[];
      readonly branch: string;
      readonly recorded: string;
    }
  | {
      readonly status: "not-found";
      /** Every branch looked for, in search order: the base branch, then the run's. */
      readonly branches: readonly string[];
      readonly recorded: string;
    };

/** The trailers a fix commit carries for one finding: `Finding-Run: <runId>` and `Finding: <findingId>`. */
interface FateKey {
  readonly runId: string;
  readonly findingId: string;
}

/**
 * Whether `message` carries the fate key: one of its paragraphs (CRLF read as LF, split on blank
 * lines) holds a line that is exactly `Finding-Run: <runId>` and another exactly
 * `Finding: <findingId>`, each with its trailing whitespace trimmed. Case-sensitive, as phax
 * writes them; any paragraph counts, not only the last. `resolveOnBranch` is its only reader.
 */
function carriesFateKey(message: string, key: FateKey): boolean {
  const run = `Finding-Run: ${key.runId}`;
  const finding = `Finding: ${key.findingId}`;
  let paragraph: string[] = [];
  const holds = () => paragraph.includes(run) && paragraph.includes(finding);
  for (const raw of message.replaceAll("\r\n", "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      if (holds()) return true;
      paragraph = [];
      continue;
    }
    paragraph.push(line);
  }
  return holds();
}

/** One commit of a branch's search range, as the Git port lists it. */
interface RangeCommitFacts {
  readonly sha: string;
  /** The committer date, ISO-8601. */
  readonly committedAt: string;
  readonly message: string;
}

/** What one branch knows about one fix. A fact left undefined has not been gathered yet. */
export interface BranchFacts {
  /** The branch's label, as `Landed` names it. */
  readonly branch: string;
  readonly recorded: string;
  readonly key: FateKey;
  /** Whether the branch's tip is, or descends from, the recorded commit. */
  readonly recordedReachable: boolean;
  /** The run's start, or null when it could not be read: then only the recorded step runs. */
  readonly startedAt: string | null;
  /** The branch's commits since the run's start, oldest first. */
  readonly range: readonly RangeCommitFacts[] | undefined;
  /** Whether the repository holds the recorded commit: the patch-id step runs only then. */
  readonly recordedHeld: boolean;
  /** The recorded commit's patch id (undefined when its diff is empty) and the range's, by sha. */
  readonly patchIds:
    | { readonly recorded: string | undefined; readonly range: ReadonlyMap<string, string> }
    | undefined;
}

/** What a branch answers so far: a resolution, nothing, or the fact it needs next. */
export type BranchStep =
  | { readonly kind: "landed"; readonly landed: Landed }
  | { readonly kind: "none" }
  | { readonly kind: "needs-range" }
  | { readonly kind: "needs-patch-ids" };

const NONE: BranchStep = { kind: "none" };

/** Whether `committedAt` is at or after `startedAt`, compared to the millisecond. */
function atOrAfter(committedAt: string, startedAt: string): boolean {
  return Date.parse(committedAt) >= Date.parse(startedAt);
}

function matchStep(
  facts: BranchFacts,
  by: "key" | "patch-id",
  matches: readonly string[],
): BranchStep | undefined {
  const [first] = matches;
  if (first === undefined) return undefined;
  const { branch, recorded } = facts;
  const landed: Landed =
    matches.length === 1
      ? { status: "found", by, commit: first, branch, recorded }
      : { status: "ambiguous", commits: matches, branch, recorded };
  return { kind: "landed", landed };
}

/**
 * One branch's answer for one fix, from the facts gathered so far, steps in order: the recorded
 * commit, the fate key, the patch id. Commits before the run's start never match. Several matches
 * of a step are ambiguous, never the latest: a finding fixed twice in the run has two commits
 * carrying its key.
 */
export function resolveOnBranch(facts: BranchFacts): BranchStep {
  const { branch, recorded } = facts;
  if (facts.recordedReachable) {
    return {
      kind: "landed",
      landed: { status: "found", by: "recorded", commit: recorded, branch, recorded },
    };
  }
  const { startedAt } = facts;
  if (startedAt === null) return NONE;
  if (facts.range === undefined) return { kind: "needs-range" };
  const range = facts.range.filter((commit) => atOrAfter(commit.committedAt, startedAt));
  const keyed = matchStep(
    facts,
    "key",
    range.filter((commit) => carriesFateKey(commit.message, facts.key)).map((commit) => commit.sha),
  );
  if (keyed !== undefined) return keyed;
  if (!facts.recordedHeld) return NONE;
  const { patchIds } = facts;
  if (patchIds === undefined) return { kind: "needs-patch-ids" };
  const patchId = patchIds.recorded;
  if (patchId === undefined) return NONE;
  return (
    matchStep(
      facts,
      "patch-id",
      range.filter((commit) => patchIds.range.get(commit.sha) === patchId).map((c) => c.sha),
    ) ?? NONE
  );
}

/** The answer when no branch resolved the fix: every branch looked for, in search order. */
export function notFound(branches: readonly string[], recorded: string): Landed {
  return { status: "not-found", branches, recorded };
}
