// The `finding` group as the runner reads it: `finding list <run>`, a run's findings with their
// ids and fates (spec finding-ids-and-fates §5.8). Under `--json` it answers the versioned
// `finding-list` document; without, a header and one row per finding rendered from the document
// alone. The notes (records off or unreadable, an archive folder that is gone) go to stderr as
// message lines. It reads the records branch and the run folder and builds no GitHub layer.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { listRunFindings } from "../../app/findingList.js";
import { NodeGitLayer } from "../../infra/git.js";
import {
  FINDING_FATES,
  FindingListFileSchema,
  type FindingListFile,
} from "../../schemas/findingList.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { defineCommand, defineGroup, reject } from "../commandLibrary/contract/index.js";
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

/**
 * The list as text, from the document alone: a header with the run's state and its non-zero fate
 * counts, an empty line, then one row per finding — id, severity, fate, location, message — each
 * column padded to its widest value and separated by two spaces.
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
  const lines = rows.map((row) =>
    row
      .map((cell, column) => (column < 4 ? cell.padEnd(widths[column] ?? 0) : cell))
      .join(SEPARATOR),
  );
  const header = `${shortName} (${state}) — ${total} ${total === 1 ? "finding" : "findings"}`;
  return [`${header}: ${counts.join(", ")}`, "", ...lines].join("\n");
}

const listCommand = defineCommand({
  name: "list",
  summary: "List a run's findings with their ids and fates",
  help: "Lists every finding of a run's code and compliance reviews: its id (F<n> for a code-review finding, C<n> for a compliance finding, numbered across the run's reviews), severity, location, message and fate. A fate is open (no fate record), fixed, dismissed, deferred, or unrecorded (the review was persisted before finding ids existed, so its ids were given by position). Earlier reviews are read from the run's records on the phax/records/v1 branch, then the unrecorded reviews kept in the run folder (<kind>.unrecorded-<NN>.json, kept when a review whose record write failed is replaced), then the run folder's own file when it differs from the newest record (its record write failed, or records were off), so a re-review drops no finding; with records off only the run folder is read, and a note on stderr says so. When git cannot read the records branch, the run folder alone is read, the answer says records unavailable, and a note on stderr says why. An archived run is read from its archive folder; a note on stderr says when that folder is gone. With --json it prints the finding-list document: a $schema, the run, whether its records were read, and the findings, F before C, each by number. Reads local files and git only; it never calls GitHub. Exits 1 for a run that cannot be resolved, a review document that cannot be read, or a file failure, and 2 for an invalid configuration.",
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
    FsError: 1,
    RegistryCorruptionError: 1,
    ConfigValidationError: 2,
  },
  errors: {
    FindingRunRefError: MessageFields,
    FindingReviewUnreadableError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
    ConfigValidationError: MessageFields,
  },
  texts: {
    FindingRunRefError: (error) => error.message,
    FindingReviewUnreadableError: (error) => error.message,
    FsError: (error) => error.message,
    RegistryCorruptionError: (error) => error.message,
    ConfigValidationError: (error) => error.message,
  },
  render: (file) => renderFindingList(file),
});

export const findingGroup = defineGroup({
  name: "finding",
  summary: "Read the findings of a run's reviews and their fates",
  commands: [listCommand],
});
