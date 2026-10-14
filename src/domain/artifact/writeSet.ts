import { approvalRecordPathFor } from "./approvalRecordFile.js";
import { describeArbiter, type ResolvedArbiter } from "./arbiter.js";
import { archivePathFor } from "./document.js";
import { parseArtifactName } from "./name.js";
import { sidecarPathFor } from "./sidecar.js";
import { type ArtifactKind, type ArtifactStatus, isTerminalStatus } from "./status.js";

// A headless-authored artifact's sidecar travels with it: it joins the
// write-set beside the `.md`, and on a terminal target its archived path joins
// beside the archived `.md`.
//
// The artifact's own record file joins only when it exists before or after the
// transition: commitPaths stages with a pathspec that must match something.
// Approve writes it, so it always joins; reopen (of a spec or a plan),
// complete and abandon delete it, so it joins only when `hasRecordFile` says it
// exists beforehand. No transition lists another artifact's record file.
export function transitionWriteSet(
  kind: ArtifactKind,
  repoRelPath: string,
  target: ArtifactStatus,
  { hasSidecar, hasRecordFile }: { readonly hasSidecar: boolean; readonly hasRecordFile: boolean },
): readonly string[] {
  const paths = [repoRelPath];
  if (hasSidecar) paths.push(sidecarPathFor(repoRelPath));
  const recordPath = approvalRecordPathFor(kind, repoRelPath);
  const deletesRecord = target === "Draft" || isTerminalStatus(target);
  if (recordPath !== null && (target === "Approved" || (deletesRecord && hasRecordFile))) {
    paths.push(recordPath);
  }
  if (isTerminalStatus(target)) {
    paths.push(archivePathFor(repoRelPath));
    if (hasSidecar) paths.push(sidecarPathFor(archivePathFor(repoRelPath)));
  }
  return paths;
}

const VERB_BY_TARGET: Record<ArtifactStatus, string> = {
  Draft: "reopen",
  Approved: "approve",
  Stale: "stale",
  Abandoned: "abandon",
  Completed: "complete",
};

// Artifacts are referred to by slug, never by stamp. validateArtifact has
// accepted the name before any transition commits, so the basename fallback
// is unreachable in practice.
function slugFor(kind: ArtifactKind, repoRelPath: string): string {
  const fileName = repoRelPath.slice(repoRelPath.lastIndexOf("/") + 1);
  const parsed = parseArtifactName(kind, fileName);
  if (parsed !== null) return parsed.slug;
  return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
}

// A reopen names who performed it in a `Reopened-By:` trailer. An approval's
// approver is in its record file, so no other message carries a trailer.
export function transitionCommitMessage(
  kind: ArtifactKind,
  target: ArtifactStatus,
  repoRelPath: string,
  reopenedBy?: ResolvedArbiter,
): { readonly subject: string; readonly body: string } {
  const verb = VERB_BY_TARGET[target];
  const scope = kind === "plan" ? "plans" : "specs";
  const slug = slugFor(kind, repoRelPath);
  const subject = `chore(${scope}): ${verb} ${slug}`;
  const transitions = `Transitions ${repoRelPath} to ${target} (${verb}).`;
  const body =
    target === "Draft" && reopenedBy !== undefined
      ? `${transitions}\n\nReopened-By: ${describeArbiter(reopenedBy)}`
      : transitions;
  return { subject, body };
}
