import { Effect } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { RevisionRequester } from "../domain/revise/revision.js";
import type { Backend } from "../ports/backend.js";
import type { FileSystem } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import type { Terminal } from "../ports/terminal.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import type { Effort } from "../schemas/phaxConfig.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import type { DecideVerdictsError } from "./decideVerdicts.js";
import type { RevisionRecordPush, RevisionRecordStatus } from "./writeRevisionRecord.js";

// The entry of `phax artifact revise`. Phase-05 freezes its input and result
// here and its acceptance tests against a body that dies; phase-06 replaces the
// body. The two interfaces are the contract: phase-06 does not change a field.

/** Where the revision's model or effort came from: the flag, or phax.json's `authoring.<kind>`. */
export type ReviseSource = "flag" | "authoring.spec" | "authoring.plan";

export interface ReviseArtifactInput {
  /** Repo-relative POSIX path of the spec or plan. */
  readonly path: string;
  /** The amendment's text, and how it reads in messages: the path as given, or `stdin`. */
  readonly amendment: { readonly text: string; readonly label: string };
  /** `--by`, as given (undefined when absent). */
  readonly by: string | undefined;
  /** `--model` and `--effort`, as given (undefined when absent). */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** phax.json's resolved `authoring.spec` and `authoring.plan`. */
  readonly authoring: Readonly<Record<ArtifactKind, { model: string; effort: Effort }>>;
  /** The loaded model routing and provider catalog the writer's model is routed through. */
  readonly routing: ModelRouting;
  readonly providerConfig: ProviderConfig;
  /** The bundled `phax-spec` and `phax-planning` `SKILL.md` texts, verbatim. */
  readonly skills: Readonly<Record<ArtifactKind, string>>;
  readonly security: ResolvedSecurityConfig;
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** The plan-extraction model/effort a plan's cache seed is keyed on (`phax run`'s). */
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  /** The command's clock: the cache seed. */
  readonly nowIso: string;
  readonly records: ResolvedRecordsConfig;
  /** The local records clone, required for a dedicated `repo` records destination. */
  readonly recordsClonePath?: string | undefined;
  /** `publish.remote` from `phax.json`: the push target for an in-repo records destination. */
  readonly publishRemote: string;
  /** Progress lines, the retry warning and a failed revision's record warnings. */
  readonly output: Pick<OutputPort, "log" | "warn">;
}

/** A revision that ran its writer to its end: a commit, or no change. The artifact stays Draft. */
export interface ReviseArtifactResult {
  readonly kind: "committed" | "unchanged";
  readonly path: string;
  /** The repo-relative paths the commit holds: the artifact, then its sidecar. Empty when unchanged. */
  readonly paths: readonly string[];
  readonly status: "Draft";
  readonly session: "new" | "resumed-authoring";
  /** The provider routing selected, which the writer ran on. */
  readonly provider: ProviderId;
  /** The concrete model the writer ran. */
  readonly model: string;
  /** The model asked for, by flag or configuration. */
  readonly requestedModel: string;
  readonly effort: Effort;
  readonly modelSource: ReviseSource;
  readonly effortSource: ReviseSource;
  readonly requester: RevisionRequester;
  /** The open questions the revision appended, in order. */
  readonly newQuestions: ReadonlyArray<{ readonly id: string; readonly question: string }>;
  /** The body diff, as `git diff --no-index` prints it (empty when unchanged). */
  readonly diff: string;
  /** The revision's commit; null when the answer changed nothing. */
  readonly commit: { readonly hash: string; readonly subject: string } | null;
  /** `<authoringId>/<NN>`: the `Revision-Id` trailer and the record's key tail. */
  readonly revisionId: string;
  readonly record: RevisionRecordStatus;
  readonly recordPush: RevisionRecordPush;
}

/** The errors decide's verdicts mode ends with; phase-06 may widen it. */
export type ReviseArtifactError = DecideVerdictsError;

/** The stub: dies until phase-06 implements the use case. */
export function reviseArtifact(
  _input: ReviseArtifactInput,
): Effect.Effect<
  ReviseArtifactResult,
  ReviseArtifactError,
  FileSystem | Git | GitHub | Backend | Terminal
> {
  return Effect.die(new Error("not implemented: reviseArtifact (phase-06)"));
}
