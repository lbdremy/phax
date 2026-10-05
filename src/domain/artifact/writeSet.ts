import { approvalRecordPathFor } from "./approvalRecordFile.js";
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
// Approve writes it, so it always joins; reopen, complete and abandon delete
// it, so it joins only when `hasRecordFile` says it exists beforehand. No
// transition lists another artifact's record file.
export function transitionWriteSet(
  kind: ArtifactKind,
  repoRelPath: string,
  target: ArtifactStatus,
  { hasSidecar, hasRecordFile }: { readonly hasSidecar: boolean; readonly hasRecordFile: boolean },
): readonly string[] {
  const paths = [repoRelPath];
  if (hasSidecar) paths.push(sidecarPathFor(repoRelPath));
  const recordPath = approvalRecordPathFor(kind, repoRelPath);
  const deletesRecord = (kind === "plan" && target === "Draft") || isTerminalStatus(target);
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

export function transitionCommitMessage(
  kind: ArtifactKind,
  target: ArtifactStatus,
  repoRelPath: string,
): { readonly subject: string; readonly body: string } {
  const verb = VERB_BY_TARGET[target];
  const scope = kind === "plan" ? "plans" : "specs";
  const slug = slugFor(kind, repoRelPath);
  const subject = `chore(${scope}): ${verb} ${slug}`;
  const body = `Transitions ${repoRelPath} to ${target} (${verb}).`;
  return { subject, body };
}
