import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import type {
  ApprovalLedgerMigrationRequiredError,
  ApprovalRecordUnreadableError,
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  ArtifactSidecarDivergedError,
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  SpecApprovalUnrecordedError,
  SpecEditedSinceApprovalError,
  SpecNotApprovedError,
} from "../domain/errors.js";
import { SpecRetirementBlockedError } from "../domain/errors.js";
import {
  archivePathFor,
  classifyArtifactPath,
  validateArtifact,
} from "../domain/artifact/document.js";
import { readSourceSpec } from "../domain/artifact/lineage.js";
import { resolveDeclaredSpec, transitionArtifact } from "./artifactStatus.js";

export interface RunCompletionTransition {
  readonly kind: "plan" | "spec";
  readonly path: string;
  readonly commit?: { readonly hash: string; readonly subject: string };
  readonly alreadyComplete: boolean;
}

// Why the run left its source spec live: the chain gate found live dependent
// plans (`blocked`), or the plan says it does not complete its spec
// (`completes-spec: false` → `not-completing`).
export type RunCompletionKeptSpec =
  | {
      readonly reason: "blocked";
      readonly path: string;
      readonly blockedBy: readonly { readonly path: string; readonly status: string }[];
    }
  | { readonly reason: "not-completing"; readonly path: string };

export interface RunCompletionReport {
  readonly transitions: readonly RunCompletionTransition[];
  readonly keptSpec?: RunCompletionKeptSpec;
}

// Run-folder fragment carrying the rendered source-spec outcome from run
// completion to every later review-handoff build (generate, regenerate,
// publish). Absent when the plan has no spec outcome to state.
export const SOURCE_SPEC_OUTCOME_FILENAME = "source-spec-outcome.md";

// Renders the source-spec outcome of a run-completion report as the body of the
// review handoff's `## Source spec` section, or undefined when the report states
// no spec outcome (loose plan, spec-less plan, spec neither Approved nor Completed).
export function renderSourceSpecOutcome(report: RunCompletionReport): string | undefined {
  const spec = report.transitions.find((t) => t.kind === "spec");
  if (spec !== undefined) {
    if (spec.commit !== undefined) {
      return `\`${spec.path}\` — completed on this branch (${spec.commit.hash.slice(0, 7)})`;
    }
    return `\`${spec.path}\` — already complete`;
  }
  const kept = report.keptSpec;
  if (kept === undefined) {
    return undefined;
  }
  if (kept.reason === "not-completing") {
    return `\`${kept.path}\` — kept: this plan does not complete it (completes-spec: false)`;
  }
  const blockers = kept.blockedBy.map((b) => `${b.path}, ${b.status}`).join("; ");
  return `\`${kept.path}\` — kept: live plans remain (${blockers})`;
}

export interface CompleteRunArtifactsInput {
  readonly worktreePath: string;
  readonly planRepoRelPath: string;
  readonly nowIso: string;
}

// The full transitionArtifact error surface. SpecNotApprovedError,
// SpecApprovalUnrecordedError, SpecEditedSinceApprovalError, and (for the plan
// transition) SpecRetirementBlockedError are runtime-unreachable here — a plan
// going Completed never chain-gates — but stay in the union because
// transitionArtifact's signature carries them regardless of target. Phase-04
// turns every member into the ArtifactCompletionFailed pause.
export type RunCompletionError =
  | FsError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError
  | ArtifactValidationError
  | InvalidArtifactTransitionError
  | SpecNotApprovedError
  | SpecApprovalUnrecordedError
  | SpecEditedSinceApprovalError
  | SpecRetirementBlockedError
  | ArtifactSidecarDivergedError
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError
  | GitError;

// Applies the plan's Approved → Completed transition inside the run worktree,
// then — only when the plan says `completes-spec: true` — rides the source
// spec's transition along where the chain gate allows, reporting a kept spec
// (blocked, or not completed by this plan) rather than a failure. Transitions run
// through transitionArtifact unchanged, against a `rootedAt` view of the
// FileSystem so the filesystem and git sides agree on the worktree tree.
export function completeRunArtifacts(
  input: CompleteRunArtifactsInput,
): Effect.Effect<RunCompletionReport, RunCompletionError, FileSystem | Git> {
  return Effect.gen(function* () {
    // A plan run from a loose path is not a lifecycle artifact — nothing to complete.
    if (classifyArtifactPath(input.planRepoRelPath) === null) {
      return { transitions: [] };
    }
    const fs = yield* FileSystem;
    const rooted = fs.rootedAt(input.worktreePath);
    return yield* completeInWorktree(input).pipe(Effect.provideService(FileSystem, rooted));
  });
}

function completeInWorktree(
  input: CompleteRunArtifactsInput,
): Effect.Effect<RunCompletionReport, RunCompletionError, FileSystem | Git> {
  return Effect.gen(function* () {
    const { worktreePath, planRepoRelPath, nowIso } = input;
    const fs = yield* FileSystem;
    const opts = { repoRoot: worktreePath, nowIso, commit: true };
    const transitions: RunCompletionTransition[] = [];

    // The plan. Its markdown is read before any move so the ride-along can read
    // the source-spec declaration from the pre-transition content.
    let planMd: string;
    const planAtSource = yield* fs.exists(planRepoRelPath);
    if (planAtSource) {
      planMd = yield* fs.readText(planRepoRelPath);
      const result = yield* transitionArtifact(planRepoRelPath, "Completed", opts);
      transitions.push({
        kind: "plan",
        path: result.path,
        ...(result.commit !== undefined ? { commit: result.commit } : {}),
        alreadyComplete: false,
      });
    } else {
      // Idempotent re-entry: the plan already moved to its archive location.
      const planArchive = archivePathFor(planRepoRelPath);
      planMd = yield* fs.readText(planArchive);
      transitions.push({ kind: "plan", path: planArchive, alreadyComplete: true });
    }

    // The ride-along spec. Order is load-bearing: the chain gate only clears
    // once the plan itself is terminal, so the plan transition runs first.
    const declaration = readSourceSpec(planMd);
    if (declaration === null || declaration.kind !== "spec") {
      return { transitions };
    }
    // A plan that is not its spec's last leaves the spec wholly untouched: no
    // resolve, read, validation or transition.
    if (!declaration.completesSpec) {
      return { transitions, keptSpec: { reason: "not-completing", path: declaration.path } };
    }
    const specPath = yield* resolveDeclaredSpec(declaration.path);
    if (specPath === null) {
      return { transitions };
    }
    const specMd = yield* fs.readText(specPath);
    const specValidated = validateArtifact(specPath, specMd);
    if (Either.isLeft(specValidated)) {
      return yield* Effect.fail(specValidated.left);
    }
    const specStatus = specValidated.right.status;
    if (specStatus === "Completed") {
      transitions.push({ kind: "spec", path: specPath, alreadyComplete: true });
      return { transitions };
    }
    if (specStatus !== "Approved") {
      return { transitions };
    }

    // The chain gate is evaluated by transitionArtifact itself; a live dependent
    // surfaces as SpecRetirementBlockedError, which becomes a kept-spec report.
    const specResult = yield* Effect.either(transitionArtifact(specPath, "Completed", opts));
    if (Either.isLeft(specResult)) {
      if (specResult.left instanceof SpecRetirementBlockedError) {
        return {
          transitions,
          keptSpec: { reason: "blocked", path: specPath, blockedBy: specResult.left.dependents },
        };
      }
      return yield* Effect.fail(specResult.left);
    }
    transitions.push({
      kind: "spec",
      path: specResult.right.path,
      ...(specResult.right.commit !== undefined ? { commit: specResult.right.commit } : {}),
      alreadyComplete: false,
    });
    return { transitions };
  });
}
