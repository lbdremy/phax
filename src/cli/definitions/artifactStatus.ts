// `phax artifact status <path>` as the runner reads it: the artifact-status document, built from
// inspectArtifact's report, and today's lines as its text, rendered from the document alone. An
// orphan approval record is a progress note: the document does not carry it.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { type ArtifactReport, inspectArtifact } from "../../app/artifactStatus.js";
import { describeArbiter } from "../../domain/artifact/arbiter.js";
import { renderOrphanRecordWarning, renderQuestionCounts } from "../../domain/artifact/render.js";
import { describeStampedShape } from "../../domain/artifact/sidecar.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { ApprovedBy } from "../../schemas/approvedBy.js";
import {
  type ArtifactStatusDocument,
  type ArtifactStatusFile,
  ArtifactStatusFileSchema,
} from "../../schemas/artifactStatusDocument.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { exposeMessage, findGitRoot, MessageFields, publishedFormat, repoPaths } from "./shared.js";

type Authoring = ArtifactStatusDocument["authoring"];
type Questions = ArtifactStatusDocument["questions"];

function authoringOf(authoring: ArtifactReport["authoring"]): Authoring {
  if (authoring.kind === "interactive") return { kind: "interactive" };
  const { agreement } = authoring;
  return {
    kind: "headless",
    sidecar: authoring.sidecarPath,
    agreement:
      typeof agreement === "string"
        ? agreement
        : agreement.kind === "invalid"
          ? { kind: "invalid", message: agreement.message }
          : { kind: "stamped", format: agreement.format, shape: agreement.shape },
  };
}

function questionsOf(questions: ArtifactReport["questions"]): Questions {
  if (questions.kind === "none") return { kind: "none" };
  if (questions.kind === "departs") {
    return { kind: "departs", line: questions.line, text: questions.text };
  }
  return {
    kind: "parsed",
    open: questions.summary.open,
    arbitrated: questions.arbitrated,
    lifted: questions.lifted,
  };
}

/** The artifact-status document of the artifact at `path`, from inspectArtifact's report. */
function artifactStatusDocument(path: string, report: ArtifactReport): ArtifactStatusDocument {
  const { approval } = report;
  return {
    path,
    kind: report.kind,
    status: report.status,
    legalTransitions: report.legalTargets,
    approval:
      approval.kind === "recorded"
        ? {
            kind: "recorded",
            date: approval.date,
            baseline: approval.baseline,
            approver: approval.approvedBy,
            editedSinceApproval: approval.editedSinceApproval,
          }
        : { kind: approval.kind },
    authoring: authoringOf(report.authoring),
    questions: questionsOf(report.questions),
  };
}

function authoringText(authoring: Authoring): string {
  if (authoring.kind === "interactive") return "interactive (no sidecar)";
  const { agreement, sidecar } = authoring;
  const state =
    agreement === "in-sync"
      ? "in sync"
      : agreement === "diverged"
        ? "diverged — body differs from the sidecar's rendering"
        : agreement.kind === "invalid"
          ? `invalid sidecar — ${agreement.message}`
          : `${describeStampedShape(agreement.format, agreement.shape)} — migrate with \`phax artifact migrate-documents\``;
  return `headless — sidecar ${sidecar} (${state})`;
}

// `<n> — open <k> (<ids>) · arbitrated <m> (<l> lifted)`, or the departing line.
function questionsText(questions: Questions): string | null {
  if (questions.kind === "none") return null;
  if (questions.kind === "departs") {
    return `does not parse — line ${String(questions.line)} departs from the §9 format: ${questions.text}`;
  }
  const summary = {
    open: questions.open,
    arbitrated: questions.arbitrated.length,
    lifted: questions.lifted.length,
  };
  return `${String(summary.open.length + summary.arbitrated)} — ${renderQuestionCounts(summary)}`;
}

// `by machine (<grant>)`, `by operator (<name>)`, or `unattributed`.
function approverText(approver: ApprovedBy): string {
  const described = describeArbiter(approver);
  return approver.kind === "unattributed" ? described : `by ${described}`;
}

/** Today's `phax artifact status` text, from the document alone. */
export function renderArtifactStatus(document: ArtifactStatusFile): string {
  const { path, kind, status, approval, authoring, questions, legalTransitions } = document;
  const lines = [
    `Path:              ${path}`,
    `Kind:              ${kind}`,
    `Status:            ${status}`,
    `Authored:          ${authoringText(authoring)}`,
  ];
  const questionsLine = questionsText(questions);
  if (questionsLine !== null) lines.push(`Questions:         ${questionsLine}`);
  const anyOpen = questions.kind === "parsed" && questions.open.length > 0;
  if (anyOpen) lines.push(`  decide with \`phax artifact decide ${path}\``);
  if (approval.kind === "recorded") {
    lines.push(
      `Approved:          ${approval.date} @ ${approval.baseline} ${approverText(approval.approver)}`,
      `Edited since:      ${approval.editedSinceApproval ? "yes" : "no"}`,
    );
  } else if (approval.kind === "unrecorded") {
    lines.push(`Approved:          (unrecorded — run phax artifact approve to record)`);
  }
  // Approval waits for a §9 that parses with no open question: the lock in transitionArtifact.
  const approvalCondition =
    questions.kind === "departs"
      ? " (once §9 parses and no question is open)"
      : anyOpen
        ? " (once no question is open)"
        : "";
  const targets = legalTransitions.map((t) => (t === "Approved" ? `${t}${approvalCondition}` : t));
  lines.push(`Legal transitions: ${targets.length > 0 ? targets.join(", ") : "(none — terminal)"}`);
  return lines.join("\n");
}

export const artifactStatusCommand = defineCommand({
  name: "status",
  summary: "Report an artifact's kind, current status, and legal transitions",
  help: "Reports an artifact's kind (spec or plan), current status, and the legal transitions from that status (an Approved spec or plan lists Draft, reached with phax artifact reopen). For an approved spec or plan, also reports the approval date and baseline, its approver (by machine (<grant>), by operator (<name>), or unattributed for an approval recorded before phax named the approver), and whether the artifact has been edited since that approval (recorded) or has no approval record (unrecorded). Also reports how the artifact was authored: interactive (no sidecar), or headless with its JSON document sidecar and whether the body is still the sidecar's rendering (in sync), differs from it (diverged — the body was edited by hand), or the sidecar is not a valid document (invalid). Frontmatter changes never count as divergence. A sidecar stamped below its document format's current shape, or written before $schema, is not compared: status names its stamped shape and `phax artifact migrate-documents` instead.\n\nAn artifact with question sections also prints a Questions line: the number of questions, the open ones with their ids, and the arbitrated ones with how many are lifted (`Questions: 4 — open 2 (Q3, Q4) · arbitrated 2 (1 lifted)`). A headless artifact's questions come from its sidecar, lifted when it is older; a valid spec sidecar always prints the line, a plan's only when it has questions. A hand-authored artifact's come from its `## 9. Open questions` and `## 9b. Arbitrated questions` sections (a plan's `## Open questions` and `## Arbitrated questions`); one that departs from the §9 format prints the first departing line instead, and status still exits 0. Read-only — no side effects.",
  examples: [
    "phax artifact status docs/plans/2607101056-typescript-7-migration-plan.md",
    "phax artifact status docs/specs/2609030749-spec-approval-ground.md",
  ],
  input: {
    args: reject(
      Schema.Tuple([
        Schema.String.annotate({
          identifier: "path",
          description: "Path to a spec or plan file under docs/specs/ or docs/plans/",
        }),
      ]),
    ),
  },
  output: reject(ArtifactStatusFileSchema.annotate(publishedFormat("artifact-status"))),
  run: ({ input, progress }) =>
    Effect.gen(function* () {
      const repoRoot = findGitRoot(process.cwd());
      const { repoRelPath } = repoPaths(input.args[0], repoRoot);
      const report = yield* inspectArtifact(repoRelPath).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRootedNodeFileSystemLayer(repoRoot),
            makeNodeGitLayer(),
            NodeTerminalLayer,
          ),
        ),
      );
      for (const orphan of report.orphanRecords) {
        yield* progress(renderOrphanRecordWarning(orphan));
      }
      return withSchemaUrl("artifact-status", artifactStatusDocument(repoRelPath, report));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    FsError: 1,
    ArtifactValidationError: 12,
    ApprovalRecordUnreadableError: 12,
    ApprovalLedgerMigrationRequiredError: 12,
  },
  errors: {
    FsError: MessageFields,
    ArtifactValidationError: MessageFields,
    ApprovalRecordUnreadableError: MessageFields,
    ApprovalLedgerMigrationRequiredError: MessageFields,
  },
  texts: {
    FsError: (error) => error.message,
    ArtifactValidationError: (error) => error.message,
    ApprovalRecordUnreadableError: (error) => error.message,
    ApprovalLedgerMigrationRequiredError: (error) => error.message,
  },
  render: (document) => renderArtifactStatus(document),
});
