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

/**
 * One named finding's search on the base branch for `phax finding fix --commit` (spec §5.15):
 * its key, then the named commit's patch id. `match` is what `resolveOnBranch` answered: one
 * commit, several, or null when no commit matched.
 */
export interface FollowMatch {
  readonly id: string;
  readonly match: { readonly by: "key" | "patch-id"; readonly commits: readonly string[] } | null;
}

/**
 * What `resolveOnBranch` answered from `facts` (`step`), as a `FollowMatch`'s `match`. An
 * ambiguous answer came from the key step when the key step alone (no patch-id step) answers it.
 */
export function followMatchOf(facts: BranchFacts, step: BranchStep): FollowMatch["match"] {
  if (step.kind !== "landed") return null;
  const { landed } = step;
  if (landed.status === "found") {
    return landed.by === "recorded" ? null : { by: landed.by, commits: [landed.commit] };
  }
  if (landed.status === "ambiguous") {
    const byKey = resolveOnBranch({ ...facts, recordedHeld: false }).kind === "landed";
    return { by: byKey ? "key" : "patch-id", commits: landed.commits };
  }
  return null;
}

/** What following a named commit decides: one commit for every named finding, or a refusal. */
export type FollowDecision =
  | { readonly kind: "follow"; readonly commit: string; readonly by: "key" | "patch-id" }
  | { readonly kind: "refused"; readonly message: string };

const short = (sha: string) => sha.slice(0, 7);

/**
 * What a followed `--commit` value is: `<sha7> is on neither <b1> nor <b2>` for a commit the
 * repository holds (`notOn` the branches it is on neither of), else `<value> is not in the
 * repository`.
 */
export function followSubject(named: string, notOn: readonly string[] | null): string {
  return notOn === null
    ? `${named} is not in the repository`
    : `${short(named)} is on neither ${notOn.join(" nor ")}`;
}

/**
 * Decides a follow (spec §5.15, §5.16): one commit when every named finding resolves to exactly
 * one commit and it is the same one; otherwise a refusal naming every candidate. `subject` says
 * what the named commit is (`<sha7> is on neither … nor …`, or `<value> is not in the
 * repository`), `held` whether the repository holds it (the patch-id step ran only then).
 */
export function decideFollow(input: {
  readonly subject: string;
  readonly base: string;
  readonly runId: string;
  readonly held: boolean;
  readonly matches: readonly FollowMatch[];
}): FollowDecision {
  const { subject, base, runId, matches } = input;
  const found = matches.flatMap((m) =>
    m.match !== null && m.match.commits.length === 1
      ? [{ id: m.id, by: m.match.by, commit: m.match.commits[0] ?? "" }]
      : [],
  );
  const several = matches.flatMap((m) =>
    m.match !== null && m.match.commits.length > 1 ? [{ id: m.id, ...m.match }] : [],
  );
  const none = matches.filter((m) => m.match === null).map((m) => m.id);
  const distinct = [...new Set(found.map((f) => f.commit))];
  const [first] = found;
  if (first !== undefined && found.length === matches.length && distinct.length === 1) {
    // Every finding names the same commit; by key when any found it by key.
    const by = found.some((f) => f.by === "key") ? "key" : "patch-id";
    return { kind: "follow", commit: first.commit, by };
  }

  const clauses: string[] = [];
  for (const s of several) {
    const commits = s.commits.map(short).join(", ");
    clauses.push(
      s.by === "key"
        ? `${s.commits.length} commits of ${base} carry ${runId} ${s.id}: ${commits}`
        : `${s.commits.length} commits of ${base} have its patch id: ${commits}`,
    );
  }
  if (distinct.length > 1) {
    clauses.push(
      `the named findings resolve to different commits of ${base}: ${found.map((f) => `${f.id} → ${short(f.commit)}`).join(", ")}`,
    );
  } else if (first !== undefined) {
    const ids = found.map((f) => f.id).join(", ");
    clauses.push(`${ids} ${found.length === 1 ? "resolves" : "resolve"} to ${short(first.commit)}`);
  }
  if (none.length > 0) {
    clauses.push(
      `no commit of ${base} since the run started carries ${runId} ${none.join(", ")}${input.held ? " or has its patch id" : ""}`,
    );
  }
  const unique = [...new Set(clauses)];
  const ending =
    found.length === 0 && several.length === 0
      ? ": name a commit of the run branch or of the base branch with --commit"
      : ". Name one with --commit";
  return { kind: "refused", message: `${subject}, and ${unique.join("; ")}${ending}` };
}
