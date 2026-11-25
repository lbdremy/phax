// The `finding` group as the runner reads it: `finding list <run>`, a run's findings with their
// ids and fates (spec finding-ids-and-fates §5.8). Under `--json` it answers the versioned
// `finding-list` document; without, a header and one row per finding rendered from the document
// alone. The notes (records off or unreadable, an archive folder that is gone) go to stderr as
// message lines. It reads the records branch and the run folder and builds no GitHub layer.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { fixFindings } from "../../app/findingFix.js";
import { postFindings } from "../../app/findingPost.js";
import { deferFindings, dismissFindings } from "../../app/findingSettle.js";
import { listRunFindings } from "../../app/findingList.js";
import { NodeGitLayer, makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import {
  CodeReviewFindingEntrySchema,
  ComplianceFindingEntrySchema,
  FINDING_FATES,
  FindingListFileSchema,
  type FindingListFile,
} from "../../schemas/findingList.js";
import { PATH_CLASSES, PathClassSchema } from "../../schemas/pathClass.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { RunStateSchema } from "../../schemas/status.js";
import {
  AliasAnnotationId,
  defineCommand,
  defineGroup,
  reject,
} from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import {
  configured,
  exposeMessage,
  MessageFields,
  publishedFormat,
  ShortNameArg,
} from "./shared.js";

const SEPARATOR = "  ";

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Where a finding is: a code-review finding's `<file>:<line>`, a compliance finding's
 *  `<phaseId> <dimension>`. */
function locationOf(finding: FindingListFile["findings"][number]): string {
  return finding.source === "code-review"
    ? `${finding.file}:${finding.line}`
    : `${finding.phaseId} ${finding.dimension}`;
}

/** The detail lines under a finding's row: a fixed finding's commits, a dismissed finding's
 *  reason, a deferred finding's pointer; none for open and unrecorded. */
function fateDetails(finding: FindingListFile["findings"][number]): readonly string[] {
  const latest = finding.history.at(-1);
  if (finding.fate === "fixed") {
    return finding.history.flatMap((entry) =>
      entry.fate === "fixed"
        ? [`${entry.commit.slice(0, 7)} (${entry.pathClasses.join(", ")})`]
        : [],
    );
  }
  if (finding.fate === "dismissed" && latest?.fate === "dismissed") {
    return [`${latest.verdict.by.name}: ${oneLine(latest.verdict.why)}`];
  }
  if (finding.fate === "deferred" && latest?.fate === "deferred") return [`→ ${latest.to}`];
  return [];
}

/**
 * The list as text, from the document alone: a header with the run's state and its non-zero fate
 * counts, an empty line, then one row per finding — id, severity, fate, location, message — each
 * column padded to its widest value and separated by two spaces. A fixed, dismissed or deferred
 * finding's row is followed by detail lines indented to the fate column.
 */
export function renderFindingList(file: FindingListFile): string {
  const { shortName, state } = file.run;
  const total = file.findings.length;
  if (total === 0) return `${shortName} (${state}) — no findings`;

  const counts = FINDING_FATES.flatMap((fate) => {
    const n = file.findings.filter((finding) => finding.fate === fate).length;
    return n === 0 ? [] : [`${n} ${fate}`];
  });
  const rows = file.findings.map((finding) => [
    finding.id,
    finding.severity,
    finding.fate,
    locationOf(finding),
    oneLine(finding.message),
  ]);
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  const indent = " ".repeat((widths[0] ?? 0) + (widths[1] ?? 0) + SEPARATOR.length * 2);
  const lines = rows.flatMap((row, index) => {
    const line = row
      .map((cell, column) => (column < 4 ? cell.padEnd(widths[column] ?? 0) : cell))
      .join(SEPARATOR);
    const finding = file.findings[index];
    return [line, ...(finding === undefined ? [] : fateDetails(finding).map((d) => indent + d))];
  });
  const header = `${shortName} (${state}) — ${total} ${total === 1 ? "finding" : "findings"}`;
  return [`${header}: ${counts.join(", ")}`, "", ...lines].join("\n");
}

const listCommand = defineCommand({
  name: "list",
  summary: "List a run's findings with their ids and fates",
  help: "Lists every finding of a run's code and compliance reviews: its id (F<n> for a code-review finding, C<n> for a compliance finding, numbered across the run's reviews), severity, location, message and fate. A fate is open (no fate record), fixed, dismissed, deferred, or unrecorded (the review was persisted before finding ids existed, so its ids were given by position). Earlier reviews are read from the run's records on the phax/records/v1 branch, then the unrecorded reviews kept in the run folder (<kind>.unrecorded-<NN>.json, kept when a review whose record write failed is replaced), then the run folder's own file when it differs from the newest record (its record write failed, or records were off), so a re-review drops no finding; with records off only the run folder is read, and a note on stderr says so. A fate other than open or unrecorded comes from the finding's latest fate record on phax/records/v1; the text shows a fixed finding's commits, a dismissed finding's reason and a deferred finding's pointer. When git cannot read the records branch, the run folder alone is read, the answer says records unavailable, and a note on stderr says why. An archived run is read from its archive folder; a note on stderr says when that folder is gone. With --json it prints the finding-list document: a $schema, the run, whether its records were read, and the findings, F before C, each by number. Reads local files and git only; it never calls GitHub. Exits 1 for a run that cannot be resolved, a review document or fate record that cannot be read, or a file failure, and 2 for an invalid configuration.",
  examples: ["phax finding list gate-retry", "phax finding list gate-retry --json"],
  input: { args: reject(Schema.Tuple([ShortNameArg])) },
  output: reject(FindingListFileSchema.annotate(publishedFormat("finding-list"))),
  run: ({ input, say }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const answer = yield* listRunFindings({ ref: input.args[0], config }).pipe(
        Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer)),
      );
      for (const note of answer.notes) yield* say(note);
      return withSchemaUrl("finding-list", answer.document);
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    FindingRunRefError: 1,
    FindingReviewUnreadableError: 1,
    FindingFateRecordUnreadableError: 1,
    FsError: 1,
    RegistryCorruptionError: 1,
    ConfigValidationError: 2,
  },
  errors: {
    FindingRunRefError: MessageFields,
    FindingReviewUnreadableError: MessageFields,
    FindingFateRecordUnreadableError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
    ConfigValidationError: MessageFields,
  },
  texts: {
    FindingRunRefError: (error) => error.message,
    FindingReviewUnreadableError: (error) => error.message,
    FindingFateRecordUnreadableError: (error) => error.message,
    FsError: (error) => error.message,
    RegistryCorruptionError: (error) => error.message,
    ConfigValidationError: (error) => error.message,
  },
  render: (file) => renderFindingList(file),
});

const PullRequestPostedOutput = Schema.Struct({
  url: Schema.String,
  pushed: Schema.NullOr(
    Schema.Struct({ remote: Schema.String, branch: Schema.String, sha: Schema.String }),
  ),
  comments: Schema.Array(Schema.Struct({ finding: Schema.String, url: Schema.String })),
});

/** What a fate command did to the run's pull request: nothing (and why), or what it posted. */
const PullRequestOutcomeOutput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("not-posted"),
    reason: Schema.Literals([
      "publish-auto-off",
      "no-pull-request",
      "push-branch-off",
      "pull-request-merged",
      "pull-request-closed",
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal("posted"), ...PullRequestPostedOutput.fields }),
]);

/** The error of a push or a comment that failed after the fates were recorded. */
const PullRequestNotUpdatedFields = Schema.Struct({
  message: Schema.String,
  pullRequest: Schema.String,
  commit: Schema.NullOr(Schema.String),
  recorded: Schema.Array(Schema.String),
  pushed: Schema.Boolean,
  posted: Schema.Array(Schema.Struct({ finding: Schema.String, url: Schema.String })),
  unposted: Schema.Array(Schema.String),
  retry: Schema.String,
});

const FixOperand = Schema.String.annotate({
  identifier: "operand",
  description: "Finding ids (F2, C1), then — after -- — the paths to commit",
});

const FixArgs = reject(Schema.TupleWithRest(Schema.Tuple([ShortNameArg]), [FixOperand]));

const SettleOperand = Schema.String.annotate({
  identifier: "id",
  description: "Finding ids (F2, C1)",
});

/** `dismiss` and `defer` take finding ids only: no paths. */
const SettleArgs = reject(Schema.TupleWithRest(Schema.Tuple([ShortNameArg]), [SettleOperand]));

const FixFlags = reject(
  Schema.Struct({
    by: Schema.optionalKey(
      Schema.String.annotate({
        identifier: "arbiter",
        description: "operator or machine:<grant>; required without a terminal",
      }),
    ),
    commit: Schema.optionalKey(
      Schema.String.annotate({
        identifier: "sha",
        description: "Record this existing commit instead of making one",
      }),
    ),
    message: Schema.optionalKey(
      Schema.String.check(Schema.isNonEmpty()).annotate({
        identifier: "subject",
        description: "The commit's subject, instead of the default",
      }),
    ).annotateKey({ [AliasAnnotationId]: "m" }),
    body: Schema.optionalKey(
      Schema.String.check(Schema.isNonEmpty()).annotate({
        identifier: "text",
        description: "A body paragraph for the commit, before phax's trailers",
      }),
    ),
  }),
);

/**
 * A fix's answer (shared by dismiss and defer): the commit, the records written, the named
 * findings read again, and what reached the run's pull request.
 */
export const FindingFixOutput = Schema.Struct({
  run: Schema.Struct({
    namespace: Schema.String,
    shortName: Schema.String,
    runId: Schema.String,
    state: RunStateSchema,
  }),
  commit: Schema.NullOr(
    Schema.Struct({
      sha: Schema.String,
      made: Schema.Boolean,
      subject: Schema.NullOr(Schema.String),
      paths: Schema.Array(Schema.Struct({ path: Schema.String, pathClass: PathClassSchema })),
    }),
  ),
  recorded: Schema.Array(
    Schema.Struct({ finding: Schema.String, key: Schema.String, recordCommit: Schema.String }),
  ),
  findings: Schema.Array(
    Schema.Union([CodeReviewFindingEntrySchema, ComplianceFindingEntrySchema]),
  ),
  pullRequest: PullRequestOutcomeOutput,
});
export type FindingFixOutput = typeof FindingFixOutput.Type;

/**
 * The lines for what reached the pull request: the push, one per comment. Not posted, one line
 * when the pull request is merged or closed, none otherwise.
 */
function pullRequestLines(outcome: FindingFixOutput["pullRequest"]): readonly string[] {
  if (outcome.kind === "not-posted") {
    if (outcome.reason === "pull-request-merged") {
      return ["○ the pull request is merged: nothing pushed or commented"];
    }
    if (outcome.reason === "pull-request-closed") {
      return ["○ the pull request is closed: nothing pushed or commented"];
    }
    return [];
  }
  return [
    ...(outcome.pushed === null
      ? []
      : [`✓ pushed ${outcome.pushed.branch} to ${outcome.pushed.remote}`]),
    ...outcome.comments.map(({ finding }) => `✓ commented ${finding} on ${outcome.url}`),
  ];
}

/** The lines of a fix's answer, from the answer alone. */
export function renderFindingFix(answer: FindingFixOutput): string {
  const { commit } = answer;
  if (commit === null) return "";
  const short = commit.sha.slice(0, 7);
  const classes = PATH_CLASSES.filter((pathClass) =>
    commit.paths.some((path) => path.pathClass === pathClass),
  );
  const lines =
    commit.made && commit.subject !== null
      ? [
          `✓ committed ${short} ${commit.subject}`,
          `  paths: ${commit.paths.map((path) => `${path.path} (${path.pathClass})`).join(", ")}`,
        ]
      : [];
  for (const { finding } of answer.recorded) {
    lines.push(
      commit.made
        ? `✓ recorded ${finding} fixed on phax/records/v1`
        : `✓ recorded ${finding} fixed by ${short} (${classes.join(", ")}) on phax/records/v1`,
    );
  }
  return [...lines, ...pullRequestLines(answer.pullRequest)].join("\n");
}

const fixCommand = defineCommand({
  name: "fix",
  summary: "Commit a fix for findings and record them fixed",
  help: "Commits exactly the paths named after -- in the run's final worktree, while the run is open for review (review_open), and records each named finding as fixed on the phax/records/v1 branch. Other staged or unstaged changes stay where they are. The commit's subject is fix(review): <ids> of <short-name>, or -m; --body adds a paragraph. Its last paragraph holds phax's trailers: Short-Name: <short-name>, then one Finding: <id> per id, in the order named, and never a Run-Id. Each record holds the commit, its path classes (code, docs, gate-config or tests, from the paths the commit changed) and who fixed it: --by operator, or no --by from a terminal, names the operator as git commits; --by machine:<grant> declares a machine. Without a terminal and without --by the call is refused. The ids come first (F2 F5), every operand from the first one not spelled like an id is a path, relative to the current directory when it is inside the worktree and to the worktree's root otherwise; a path spelled like an id must follow another path or be written ./F2. A named directory commits every change under it.\n\n--commit <sha> records an existing commit and makes none: it takes no path, -m or --body. The commit must be on the run's final-phase branch or on the base branch (publish.baseBranch, else main). It works on a run that is no longer open for review and on an archived run, and is the retry when a record failed after the commit landed. Every refusal comes before anything is written: no id, no path, an unchanged path, a path outside the worktree, an id the run does not have, a run not open for review, records off, a records clone that is missing, and an unknown or unreachable commit. A record that fails after the commit landed keeps the commit, exits 1, names the ids not recorded and the --commit retry, and pushes and posts nothing. When publication.json in the run folder names a pull request (the one phax publish-pr opened, or found on the run branch and recorded) and publish.auto is on, the command then pushes the run's branch to publish.remote (never forced; not with publish.pushBranch off, and not for an archived run) and posts one comment per finding on the pull request, naming the commit. Before that it asks GitHub the pull request's state: a merged or closed pull request gets no push and no comment, since the commit is not in its base branch; the commit and the fates stay, a line says so, and the command exits 0. With publish.auto off, or no pull request yet, nothing leaves the machine. A state query, a push or a comment that fails keeps the commit and the fates, exits 1 and names the phax finding post retry; a refused push also says to bring the remote's commits in with git pull --no-rebase. The records branch is never pushed. With --json it prints { run, commit, recorded, findings, pullRequest }: the named findings as phax finding list reads them after the write, and pullRequest either { kind: not-posted, reason } or { kind: posted, url, pushed, comments }. Exits 1 for a refusal, a git or file failure, a fate not recorded and a pull request not updated, and 2 for an invalid configuration.",
  examples: [
    "phax finding fix gate-retry F2 -- tests/gate.test.ts",
    'phax finding fix gate-retry F2 F5 -m "fix(gate): keep the exit code" -- src/app/gate.ts',
    "phax finding fix gate-retry F3 --commit 9f8e7d6 --by operator",
  ],
  input: { args: FixArgs, flags: FixFlags },
  output: reject(FindingFixOutput),
  // Without `--by` a terminal stands for the operator: a person's gesture, not a program's.
  prompts: (input) => input.flags.by === undefined,
  unprompted: "pass --by",
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [ref, ...operands] = input.args;
      return yield* fixFindings({
        ref,
        operands,
        commit: input.flags.commit,
        subject: input.flags.message,
        body: input.flags.body,
        by: input.flags.by,
        cwd: process.cwd(),
        nowIso: new Date().toISOString(),
        config,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRepoRootedFileSystemLayer(config),
            // Rooted: the fix commit is made in the run's worktree.
            makeNodeGitLayer({ repoRoot: config.repoRoot }),
            NodeGitHubLayer,
            NodeTerminalLayer,
          ),
        ),
      );
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    FindingFixRefusedError: 1,
    FindingRecordsOffError: 1,
    FindingRecordsUnavailableError: 1,
    FindingFateNotRecordedError: 1,
    FindingPullRequestNotUpdatedError: 1,
    FindingRunRefError: 1,
    FindingReviewUnreadableError: 1,
    FindingFateRecordUnreadableError: 1,
    GitError: 1,
    FsError: 1,
    RegistryCorruptionError: 1,
    ConfigValidationError: 2,
  },
  errors: {
    FindingFixRefusedError: MessageFields,
    FindingRecordsOffError: MessageFields,
    FindingRecordsUnavailableError: MessageFields,
    FindingFateNotRecordedError: Schema.Struct({
      message: Schema.String,
      commit: Schema.NullOr(Schema.String),
      recorded: Schema.Array(Schema.String),
      unrecorded: Schema.Array(Schema.String),
      retry: Schema.String,
    }),
    FindingPullRequestNotUpdatedError: PullRequestNotUpdatedFields,
    FindingRunRefError: MessageFields,
    FindingReviewUnreadableError: MessageFields,
    FindingFateRecordUnreadableError: MessageFields,
    GitError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
    ConfigValidationError: MessageFields,
  },
  texts: {
    FindingFixRefusedError: (error) => `✗ fix refused: ${error.message}`,
    FindingRecordsOffError: (error) => `✗ fix refused: ${error.message}`,
    FindingRecordsUnavailableError: (error) => `✗ fix refused: ${error.message}`,
    FindingFateNotRecordedError: (error) => error.message,
    FindingPullRequestNotUpdatedError: (error) => error.message,
    FindingRunRefError: (error) => `✗ fix refused: ${error.message}`,
    FindingReviewUnreadableError: (error) => `✗ fix refused: ${error.message}`,
    FindingFateRecordUnreadableError: (error) => `✗ fix refused: ${error.message}`,
    GitError: (error) => `✗ fix refused: ${error.message}`,
    FsError: (error) => `✗ fix refused: ${error.message}`,
    RegistryCorruptionError: (error) => `✗ fix refused: ${error.message}`,
    ConfigValidationError: (error) => error.message,
  },
  render: renderFindingFix,
});

const SettleReason = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "reason",
  description: "Why the finding is settled this way",
});

const SettleBy = Schema.optionalKey(
  Schema.String.annotate({
    identifier: "arbiter",
    description: "operator; required without a terminal",
  }),
);

const DismissFlags = reject(Schema.Struct({ why: SettleReason, by: SettleBy }));
const DeferFlags = reject(
  Schema.Struct({
    to: Schema.String.check(Schema.isNonEmpty()).annotate({
      identifier: "path",
      description: "The tracked file that takes the finding over",
    }),
    why: SettleReason,
    by: SettleBy,
  }),
);

/** The lines of a dismissal's answer, from the answer alone. */
export function renderFindingDismiss(answer: FindingFixOutput): string {
  const recorded = answer.findings.map((finding) => {
    const last = finding.history[finding.history.length - 1];
    const name =
      last?.fate === "dismissed" && last.verdict.by.kind === "operator"
        ? last.verdict.by.name
        : "operator";
    return `✓ recorded ${finding.id} dismissed on phax/records/v1 (by ${name})`;
  });
  return [...recorded, ...pullRequestLines(answer.pullRequest)].join("\n");
}

/** The lines of a deferral's answer, from the answer alone. */
export function renderFindingDefer(answer: FindingFixOutput): string {
  const recorded = answer.findings.map((finding) => {
    const last = finding.history[finding.history.length - 1];
    const to = last?.fate === "deferred" ? last.to : "";
    return `✓ recorded ${finding.id} deferred → ${to} on phax/records/v1`;
  });
  return [...recorded, ...pullRequestLines(answer.pullRequest)].join("\n");
}

const settleExits = {
  FindingSettleRefusedError: 1,
  FindingRecordsOffError: 1,
  FindingRecordsUnavailableError: 1,
  FindingFateNotRecordedError: 1,
  FindingPullRequestNotUpdatedError: 1,
  FindingRunRefError: 1,
  FindingReviewUnreadableError: 1,
  FindingFateRecordUnreadableError: 1,
  GitError: 1,
  FsError: 1,
  RegistryCorruptionError: 1,
  ConfigValidationError: 2,
} as const;

const settleErrors = {
  FindingSettleRefusedError: MessageFields,
  FindingRecordsOffError: MessageFields,
  FindingRecordsUnavailableError: MessageFields,
  FindingFateNotRecordedError: Schema.Struct({
    message: Schema.String,
    commit: Schema.NullOr(Schema.String),
    recorded: Schema.Array(Schema.String),
    unrecorded: Schema.Array(Schema.String),
    retry: Schema.String,
  }),
  FindingPullRequestNotUpdatedError: PullRequestNotUpdatedFields,
  FindingRunRefError: MessageFields,
  FindingReviewUnreadableError: MessageFields,
  FindingFateRecordUnreadableError: MessageFields,
  GitError: MessageFields,
  FsError: MessageFields,
  RegistryCorruptionError: MessageFields,
  ConfigValidationError: MessageFields,
};

type Msg = { readonly message: string };
const plain = (error: Msg) => error.message;
const settleTexts = (verb: string) => {
  const refused = (error: Msg) => `✗ ${verb} refused: ${error.message}`;
  return {
    FindingSettleRefusedError: refused,
    FindingRecordsOffError: refused,
    FindingRecordsUnavailableError: refused,
    FindingFateNotRecordedError: plain,
    FindingPullRequestNotUpdatedError: plain,
    FindingRunRefError: refused,
    FindingReviewUnreadableError: refused,
    FindingFateRecordUnreadableError: refused,
    GitError: refused,
    FsError: refused,
    RegistryCorruptionError: refused,
    ConfigValidationError: plain,
  };
};

const settleLayer = (config: Parameters<typeof makeRepoRootedFileSystemLayer>[0]) =>
  Layer.mergeAll(
    makeRepoRootedFileSystemLayer(config),
    // Rooted: the settle reads the tree of the cwd, which may be a phase worktree.
    makeNodeGitLayer({ repoRoot: config.repoRoot }),
    NodeGitHubLayer,
    NodeTerminalLayer,
  );

const SETTLE_TAIL =
  "Only an operator may do this: --by operator, or no --by from a terminal, names the operator as git commits; --by machine:<grant> is refused, and without a terminal and without --by the call is refused. It runs on any run whose records exist, an archived run and an unrecorded finding included. A later fate record supersedes it. Every refusal comes before anything is written. A record that fails names the ids not recorded; running the same command again records them. When publication.json in the run folder names a pull request (the one phax publish-pr opened, or found on the run branch and recorded) and publish.auto is on, it then posts one comment per finding on the pull request, with the reason or the pointer; it pushes nothing. With publish.auto off, or no pull request yet, nothing leaves the machine. A comment that fails keeps the fates, exits 1 and names the phax finding post retry. The records branch is never pushed. With --json it prints { run, commit, recorded, findings, pullRequest }, commit being null and pullRequest either { kind: not-posted, reason } or { kind: posted, url, pushed, comments }. Exits 1 for a refusal, a git or file failure, a fate not recorded and a pull request not updated, and 2 for an invalid configuration.";

const dismissCommand = defineCommand({
  name: "dismiss",
  summary: "Record findings as dismissed",
  help: `Records each named finding as dismissed on the phax/records/v1 branch, with --why as the reason: a decided verdict that chooses dismiss and abandons fix and defer, whose case for fixing is the finding's suggestion (a code-review finding) or its message (a compliance finding). One record per id, in the order named. ${SETTLE_TAIL}`,
  examples: ['phax finding dismiss gate-retry F3 --why "the second check guards --resume"'],
  input: { args: SettleArgs, flags: DismissFlags },
  output: reject(FindingFixOutput),
  prompts: (input) => input.flags.by === undefined,
  unprompted: "pass --by",
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [ref, ...operands] = input.args;
      return yield* dismissFindings({
        ref,
        operands,
        why: input.flags.why,
        by: input.flags.by,
        nowIso: new Date().toISOString(),
        config,
      }).pipe(Effect.provide(settleLayer(config)));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: settleExits,
  errors: settleErrors,
  texts: settleTexts("dismiss"),
  render: renderFindingDismiss,
});

const deferCommand = defineCommand({
  name: "defer",
  summary: "Record findings as deferred to a file",
  help: `Records each named finding as deferred on the phax/records/v1 branch, to the tracked file --to names (a brief, a spec, NEXT_STEPS.md), with --why as the reason. The path is read relative to the current directory within its checkout, must be a file tracked at HEAD, and is recorded relative to the repository root. One record per id, in the order named. ${SETTLE_TAIL}`,
  examples: [
    'phax finding defer gate-retry F5 --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"',
  ],
  input: { args: SettleArgs, flags: DeferFlags },
  output: reject(FindingFixOutput),
  prompts: (input) => input.flags.by === undefined,
  unprompted: "pass --by",
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [ref, ...operands] = input.args;
      return yield* deferFindings({
        ref,
        operands,
        to: input.flags.to,
        why: input.flags.why,
        by: input.flags.by,
        cwd: process.cwd(),
        nowIso: new Date().toISOString(),
        config,
      }).pipe(Effect.provide(settleLayer(config)));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: settleExits,
  errors: settleErrors,
  texts: settleTexts("defer"),
  render: renderFindingDefer,
});

/** A post's answer: the run, what reached its pull request, and the named findings. */
export const FindingPostOutput = Schema.Struct({
  run: Schema.Struct({
    namespace: Schema.String,
    shortName: Schema.String,
    runId: Schema.String,
    state: RunStateSchema,
  }),
  pullRequest: PullRequestPostedOutput,
  findings: Schema.Array(
    Schema.Union([CodeReviewFindingEntrySchema, ComplianceFindingEntrySchema]),
  ),
});
export type FindingPostOutput = typeof FindingPostOutput.Type;

/** The lines of a post's answer, from the answer alone. */
export function renderFindingPost(answer: FindingPostOutput): string {
  const { pushed, comments, url } = answer.pullRequest;
  return [
    ...(pushed === null ? [] : [`✓ pushed ${pushed.branch} to ${pushed.remote}`]),
    ...comments.map(({ finding }) => `✓ commented ${finding} on ${url}`),
  ].join("\n");
}

const postCommand = defineCommand({
  name: "post",
  summary: "Post the comments of settled findings on the run's pull request",
  help: "Posts, on the run's pull request, one comment per named finding of an already settled fate, in the order named: the finding's id, fate, location and message, then the commit that fixed it, the reason it was dismissed, or the file that takes it over. For a fixed finding it first pushes the run's branch to publish.remote from the run's final worktree, so the commit the comment names is visible on the pull request; with publish.pushBranch off it pushes nothing. A call naming a fixed finding first asks GitHub the pull request's state and is refused when it is merged or closed, pushing and posting nothing: name only the dismissed and deferred findings to post theirs, which reach a merged or closed pull request too. It writes no record, so it never records a fate twice, and it ignores publish.auto: it is an explicit request to post. It is the retry that phax finding fix, dismiss and defer name when they could not update the pull request. The pull request is the one publication.json in the run folder names: the one phax publish-pr opened, or found on the run branch and recorded, a pull request opened by hand included. A run whose publication.json names none has nothing to post. Every refusal comes before any push or comment: an id the run does not have, a finding that is open or unrecorded (it has no fate to post), a run without a pull request, and a fixed finding on a merged or closed pull request. A state query, a push or a comment that fails exits 1, names the ids left and the phax finding post retry; a refused push also says to bring the remote's commits in with git pull --no-rebase. With --json it prints { run, pullRequest, findings }, pullRequest being { url, pushed, comments }. Exits 1 for a refusal, a git, gh or file failure and a pull request not updated, and 2 for an invalid configuration.",
  examples: ["phax finding post gate-retry F2", "phax finding post gate-retry F3 F5"],
  input: { args: SettleArgs },
  output: reject(FindingPostOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [ref, ...operands] = input.args;
      return yield* postFindings({ ref, operands, config }).pipe(
        Effect.provide(
          Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer, NodeGitHubLayer),
        ),
      );
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    FindingPostRefusedError: 1,
    FindingPullRequestNotUpdatedError: 1,
    FindingRunRefError: 1,
    FindingReviewUnreadableError: 1,
    FindingFateRecordUnreadableError: 1,
    GitError: 1,
    FsError: 1,
    RegistryCorruptionError: 1,
    ConfigValidationError: 2,
  },
  errors: {
    FindingPostRefusedError: MessageFields,
    FindingPullRequestNotUpdatedError: PullRequestNotUpdatedFields,
    FindingRunRefError: MessageFields,
    FindingReviewUnreadableError: MessageFields,
    FindingFateRecordUnreadableError: MessageFields,
    GitError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
    ConfigValidationError: MessageFields,
  },
  texts: {
    FindingPostRefusedError: (error) => `✗ post refused: ${error.message}`,
    FindingPullRequestNotUpdatedError: (error) => error.message,
    FindingRunRefError: (error) => `✗ post refused: ${error.message}`,
    FindingReviewUnreadableError: (error) => `✗ post refused: ${error.message}`,
    FindingFateRecordUnreadableError: (error) => `✗ post refused: ${error.message}`,
    GitError: (error) => `✗ post refused: ${error.message}`,
    FsError: (error) => `✗ post refused: ${error.message}`,
    RegistryCorruptionError: (error) => `✗ post refused: ${error.message}`,
    ConfigValidationError: (error) => error.message,
  },
  render: renderFindingPost,
});

export const findingGroup = defineGroup({
  name: "finding",
  summary: "Read the findings of a run's reviews and their fates",
  commands: [listCommand, fixCommand, dismissCommand, deferCommand, postCommand],
});
