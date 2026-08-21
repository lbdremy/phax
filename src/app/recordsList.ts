import { Effect, Either } from "effect";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { ORIGIN } from "./recordsSync.js";
import { RECORDS_BRANCH_NAME } from "./writeRecord.js";
import { RECORDS_REF } from "./recordsExplain.js";
import {
  decodeRunRecordManifest,
  type RecordPhaseOutcome,
  type RecordShape,
} from "../schemas/runRecord.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";

export interface RecordListEntry {
  readonly runId: string;
  readonly phaseId: string;
  readonly shape: RecordShape;
  readonly outcome: RecordPhaseOutcome;
  readonly recordCommitSha: string;
}

export type ListRecordsResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "listed"; readonly records: readonly RecordListEntry[] };

export interface ListRecordsInput {
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  readonly publishRemote: string;
  /** Required (and used) only when the destination is a dedicated `repo`. */
  readonly recordsClonePath?: string | undefined;
  /** Restrict the listing to one run's records. */
  readonly runId?: string | undefined;
}

/**
 * List every record reachable from the records branch (or, when there is no
 * local branch yet, its remote-tracking ref — spec §5.9 never requires a
 * checked-out local branch). Records are not cumulative (see
 * `recordsExplain.ts`), so this walks the whole history rather than reading
 * one tree: every commit on `phax/records/v1` is itself exactly one record.
 */
export function listRecords(
  input: ListRecordsInput,
): Effect.Effect<ListRecordsResult, GitError | ShellError, Git | Shell> {
  return Effect.gen(function* () {
    if (!input.records.enabled) return { kind: "disabled" } as const;

    const git = yield* Git;
    const isInRepo = input.records.destination.kind === "in-repo";
    const localPath = isInRepo ? input.repoRoot : input.recordsClonePath;
    if (localPath === undefined) return { kind: "listed", records: [] } as const;

    let tip = yield* git.resolveRef(localPath, RECORDS_REF);
    if (tip === null) {
      const remote = isInRepo ? input.publishRemote : ORIGIN;
      tip = yield* git.resolveRef(localPath, `refs/remotes/${remote}/${RECORDS_BRANCH_NAME}`);
    }
    if (tip === null) return { kind: "listed", records: [] } as const;

    const shell = yield* Shell;
    const command: readonly [string, ...string[]] =
      input.runId !== undefined
        ? ["git", "log", tip, "--format=%H", "--fixed-strings", `--grep=Run-Id: ${input.runId}`]
        : ["git", "log", tip, "--format=%H"];
    const logResult = yield* shell.run({ command, cwd: localPath });
    const shas = logResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const records: RecordListEntry[] = [];
    for (const sha of shas) {
      const entries = yield* git.readTree(localPath, sha);
      const manifestEntry = entries.find(
        (e) => e.type === "blob" && e.path.endsWith("/record.json"),
      );
      if (manifestEntry === undefined) continue;
      const bytes = yield* git.readBlob(localPath, manifestEntry.oid);
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        // A record.json that is not even valid JSON is treated the same as a
        // schema-invalid one: skip it rather than crashing the whole listing.
        continue;
      }
      const decoded = decodeRunRecordManifest(json);
      if (Either.isLeft(decoded)) continue;
      const manifest = decoded.right;
      records.push({
        runId: manifest.runId,
        phaseId: manifest.phaseId,
        shape: manifest.shape,
        outcome: manifest.outcome,
        recordCommitSha: sha,
      });
    }

    return { kind: "listed", records } as const;
  });
}
