import { archivePathFor } from "./document.js";
import { APPROVALS_FILE_PATH } from "./lineage.js";
import { type ArtifactKind, type ArtifactStatus, isTerminalStatus } from "./status.js";

export function transitionWriteSet(
  kind: ArtifactKind,
  repoRelPath: string,
  target: ArtifactStatus,
): readonly string[] {
  const paths = [repoRelPath];
  if (kind === "plan" && (target === "Approved" || isTerminalStatus(target))) {
    paths.push(APPROVALS_FILE_PATH);
  }
  if (isTerminalStatus(target)) {
    paths.push(archivePathFor(repoRelPath));
  }
  return paths;
}

const VERB_BY_TARGET: Record<ArtifactStatus, string> = {
  Draft: "reopen",
  Approved: "approve",
  Stale: "stale",
  Abandoned: "abandon",
  Archived: "archive",
};

function slugFor(repoRelPath: string): string {
  const fileName = repoRelPath.slice(repoRelPath.lastIndexOf("/") + 1);
  return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
}

export function transitionCommitMessage(
  kind: ArtifactKind,
  target: ArtifactStatus,
  repoRelPath: string,
): { readonly subject: string; readonly body: string } {
  const verb = VERB_BY_TARGET[target];
  const scope = kind === "plan" ? "plans" : "specs";
  const slug = slugFor(repoRelPath);
  const subject = `chore(${scope}): ${verb} ${slug}`;
  const body = `Transitions ${repoRelPath} to ${target} (${verb}).`;
  return { subject, body };
}
