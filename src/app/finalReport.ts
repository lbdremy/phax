import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import { isPhaseTerminal } from "../domain/state.js";
import { TURN_STREAM_PATTERN } from "../domain/records/stopArtifacts.js";
import { formatParseError } from "../schemas/formatError.js";
import type { PublicationRecord } from "../domain/publish/types.js";
import type { RunReviewInfo } from "./resolveRunInfo.js";
import type { PhaseStatus } from "../schemas/status.js";
import { readSecurityPosture, type SecurityPosture } from "../schemas/securityPosture.js";
import type { RecordedSurface } from "../schemas/surface.js";
import { aggregateVerifiedSurfaces } from "./gateAttribution.js";

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isPhaseSuccessful(p: PhaseStatus): boolean {
  return isPhaseTerminal(p.state) && p.state !== "skipped";
}

/** What reading a phase's `security.json` gave: no file, a posture, or a file that does not decode. */
type PostureRead =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly posture: SecurityPosture }
  | { readonly kind: "unreadable"; readonly file: string; readonly violation: string };

function readPostureOf(
  runPath: string,
  phaseId: string,
): Effect.Effect<PostureRead, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const file = join(runPath, phaseId, "security.json");
    if (!(yield* fs.exists(file))) return { kind: "absent" } as const;
    const text = yield* fs.readText(file);
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return { kind: "unreadable", file, violation: "not valid JSON" } as const;
    }
    const decoded = readSecurityPosture(raw);
    if (Either.isLeft(decoded)) {
      const first = formatParseError(decoded.left).split("\n")[0]?.trim() ?? "does not decode";
      return { kind: "unreadable", file, violation: first } as const;
    }
    return { kind: "read", posture: decoded.right } as const;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        kind: "unreadable",
        file: join(runPath, phaseId, "security.json"),
        violation: error.message,
      } as const),
    ),
  );
}

// An interactive phase's first-turn and closing-turn streams, first turns first.
function turnStreams(names: readonly string[]): string[] {
  // A turn's stream sorts before its `-retry` stream.
  const streams = names
    .filter((entry) => TURN_STREAM_PATTERN.test(entry))
    .toSorted((a, b) => a.replace(".jsonl", "").localeCompare(b.replace(".jsonl", "")));
  return [
    ...streams.filter((s) => s.startsWith("first-")),
    ...streams.filter((s) => s.startsWith("closing-")),
  ];
}

function formatSecurityPosture(phaseId: string, posture: SecurityPosture): string {
  const readPaths =
    posture.filesystem.allowRead.length > 0 ? posture.filesystem.allowRead.join(", ") : "(none)";
  const writePaths =
    posture.filesystem.allowWrite.length > 0 ? posture.filesystem.allowWrite.join(", ") : "(none)";
  const mcpAllow = posture.mcp.allow.length > 0 ? posture.mcp.allow.join(", ") : "(none)";
  const marks = posture.marks.length > 0 ? posture.marks.join(", ") : "none";
  const skipped =
    posture.providerSkippedForSecurity.length > 0
      ? posture.providerSkippedForSecurity.map((s) => `${s.provider}: ${s.reason}`).join("; ")
      : "none";

  return `| ${phaseId} | ${posture.mode} | ${posture.provider} | ${posture.sandboxEnabled} | ${posture.network.profile} | ${posture.mcp.mode} | ${readPaths} | ${writePaths} | ${mcpAllow} | ${posture.downgraded} | ${marks} | ${skipped} |`;
}

function buildEntrySection(info: RunReviewInfo): string {
  const resumeSnippet =
    info.claudeSessionId !== undefined
      ? `cd ${info.worktreePath}\nclaude --resume ${info.claudeSessionId}`
      : `cd ${info.worktreePath}\n# no session id captured`;

  return `## Entry & Resume

### Entry Commands

\`\`\`bash
# Resume the Claude session interactively
phax enter ${info.shortName}

# Open a shell in the final worktree
phax shell ${info.shortName}

# Print the worktree path (for scripting)
phax path ${info.shortName}

# Open in editor
phax open ${info.shortName}
\`\`\`

### Resume Claude Session Manually

\`\`\`bash
${resumeSnippet}
\`\`\`

### Conductor Handoff

Base Branch: \`${info.branch}\`
Final Phase Branch: \`${info.finalPhaseBranch}\`
Worktree: \`${info.worktreePath}\`

The full commit chain is on \`${info.finalPhaseBranch}\` (\`${info.branch}\` stays at the run-start commit).
Open the worktree directory in Conductor or point a new workspace at branch \`${info.finalPhaseBranch}\`.

### Archive Instructions

When you are done reviewing, finalize this run:

\`\`\`bash
phax archive ${info.shortName}
\`\`\`
`;
}

export function renderPublicationSection(record: PublicationRecord): string {
  const lines: string[] = ["## Pull request", ""];

  lines.push(`- **Provider**: ${record.provider}`);
  lines.push(`- **Remote**: ${record.remote}`);
  lines.push(`- **Branch**: \`${record.remote}/${record.branch}\``);
  if (record.baseBranch !== undefined) {
    lines.push(`- **Base branch**: \`${record.baseBranch}\``);
  }
  lines.push(`- **Push status**: ${record.pushStatus}`);
  lines.push(`- **PR status**: ${record.prStatus}`);

  if (record.pullRequestUrl !== undefined) {
    lines.push(`- **Pull request URL**: ${record.pullRequestUrl}`);
  }

  const succeeded =
    record.prStatus === "created" ||
    record.prStatus === "exists" ||
    (record.pushStatus === "pushed" && record.prStatus === "not_attempted");

  if (succeeded && record.failureReason === undefined) {
    lines.push("");
    if (record.prStatus === "created") {
      lines.push("Pull request created successfully.");
    } else if (record.prStatus === "exists") {
      lines.push("Pull request already existed; reused without creating a duplicate.");
    } else {
      lines.push("Branch pushed; PR creation was disabled.");
    }
  } else {
    lines.push("");
    if (record.failureReason !== undefined) {
      lines.push(`**Publication failed**: ${record.failureReason}`);
      lines.push("");
    }
    lines.push("Re-run publication once the issue is resolved:");
    lines.push("");
    lines.push("```bash");
    lines.push("phax publish-pr <short-name>");
    lines.push("```");
  }

  return lines.join("\n") + "\n";
}

interface PhaseFiles {
  readonly posture: PostureRead;
  /** The names in the phase folder: an interactive phase's turn streams come from them. */
  readonly names: readonly string[];
}

function buildFinalReportMarkdown(
  info: RunReviewInfo,
  verifiedSurfaces: readonly RecordedSurface[],
  files: ReadonlyMap<string, PhaseFiles>,
  publication?: PublicationRecord,
): string {
  const passed = info.phaseStatuses.filter(isPhaseSuccessful).length;
  const failed = info.phaseStatuses.filter((p) => p.state === "failed").length;
  const total = info.phaseStatuses.length;

  const phaseRows = info.phaseStatuses
    .map((p) => {
      const planPhase = info.planPhases.find((pp) => pp.id === p.phaseId);
      const planTitle = planPhase?.title ?? p.phaseId;
      // No agent session built an interactive phase: its row names no session.
      const interactive = p.mode === "interactive";
      const title = interactive ? `${planTitle} (interactive)` : planTitle;
      const commit = p.commitHash ? p.commitHash.slice(0, 8) : "-";
      const session = !interactive && p.claudeSessionId ? `${p.claudeSessionId.slice(0, 8)}…` : "-";
      const duration = formatDuration(p.createdAt, p.updatedAt);
      return `| ${p.phaseId} | ${title} | ${p.state} | ${p.model} | ${p.effort} | ${commit} | ${session} | ${duration} |`;
    })
    .join("\n");

  const artifactLinks = info.phaseStatuses
    .map((p) => {
      const base = `${info.runPath}/${p.phaseId}`;
      if (p.mode === "interactive") {
        const turns = turnStreams(files.get(p.phaseId)?.names ?? []);
        return [
          `### ${p.phaseId}`,
          `- Status: \`${base}/status.json\``,
          ...(turns.length > 0
            ? turns.map((stream) => `- Turn: \`${base}/${stream}\``)
            : ["- Turns: (none)"]),
          `- Security: \`${base}/security.json\``,
        ].join("\n");
      }
      return [
        `### ${p.phaseId}`,
        `- Status: \`${base}/status.json\``,
        `- Output: \`${base}/output.jsonl\``,
        `- Prompt: \`${base}/prompt.md\``,
        `- Security: \`${base}/security.json\``,
      ].join("\n");
    })
    .join("\n\n");

  // Build Security section from security.json artifacts
  const securityPosturePairs = info.phaseStatuses
    .map((p) => ({ phaseId: p.phaseId, read: files.get(p.phaseId)?.posture }))
    .flatMap((pair) =>
      pair.read?.kind === "read" ? [{ phaseId: pair.phaseId, posture: pair.read.posture }] : [],
    );
  // A file that exists but does not decode is named, never taken for an absent one.
  const unreadableSection = info.phaseStatuses
    .flatMap((p) => {
      const read = files.get(p.phaseId)?.posture;
      return read?.kind === "unreadable"
        ? [`- ${p.phaseId}: \`${read.file}\` is unreadable: ${read.violation}`]
        : [];
    })
    .join("\n");

  const hasSecurityData = securityPosturePairs.length > 0;
  const runSecurityMode =
    hasSecurityData && securityPosturePairs.length === info.phaseStatuses.length
      ? securityPosturePairs[0]?.posture.mode
      : "(mixed)";

  const securityRows = hasSecurityData
    ? securityPosturePairs
        .map((pair) => formatSecurityPosture(pair.phaseId, pair.posture))
        .join("\n")
    : "| (no security data) | | | | | | | | | | | |";

  const agentCommandsSection = securityPosturePairs
    .filter((pair) => pair.posture.agentCommands.length > 0)
    .map((pair) => {
      const rows = pair.posture.agentCommands
        .map(
          (r) =>
            `| \`${r.command}\` | ${r.source} | ${r.explicit} | ${r.requiredByPlan} | ${r.enforcement} | ${r.degraded} |`,
        )
        .join("\n");
      return `### ${pair.phaseId}\n\n| Command | Source | Explicit | Required | Enforcement | Degraded |\n|---------|--------|----------|----------|-------------|----------|\n${rows}`;
    })
    .join("\n\n");

  // Declared `.claude/skills/**` files each phase was granted (--allow-skill-edits),
  // so a reviewer sees which protected skill files the agent could write.
  const skillEditGrantRows = securityPosturePairs
    .filter((pair) => pair.posture.skillEditGrants.length > 0)
    .map(
      (pair) =>
        `| ${pair.phaseId} | ${pair.posture.skillEditGrants.map((f) => `\`${f}\``).join(", ")} |`,
    )
    .join("\n");
  const skillEditGrantsSection =
    skillEditGrantRows.length > 0
      ? `\n### Skill Edit Grants\n\n| Phase | Files |\n|-------|-------|\n${skillEditGrantRows}\n`
      : "";

  const publicationSection =
    publication !== undefined ? `\n${renderPublicationSection(publication)}` : "";

  return `# Final Report: ${info.shortName}

## Run Summary

- **Run ID**: ${info.runId}
- **Short Name**: ${info.shortName}
- **Base Branch**: ${info.branch}
- **Final Phase Branch (review here)**: \`${info.finalPhaseBranch}\`
- **State**: ${info.runState}
- **Gate Profile**: ${info.gateProfileId ?? "(none)"}
- **Surfaces Verified**: ${verifiedSurfaces.length > 0 ? verifiedSurfaces.join(", ") : "(none)"}
- **Total Phases**: ${total}
- **Passed**: ${passed}
- **Failed**: ${failed}

${buildEntrySection(info)}

## Phase Details

| Phase | Title | State | Model | Effort | Commit | Session | Duration |
|-------|-------|-------|-------|--------|--------|---------|----------|
${phaseRows}

## Security

- **Run Security Mode**: ${runSecurityMode}

| Phase | Mode | Provider | Sandbox | Network Profile | MCP Mode | Allow Read | Allow Write | MCP Allow | Downgraded | Marks | Skipped for Security |
|-------|------|----------|---------|----------------|----------|------------|-------------|-----------|------------|-------|---------------------|
${securityRows}
${unreadableSection.length > 0 ? `\n### Unreadable Security Files\n\n${unreadableSection}\n` : ""}${agentCommandsSection.length > 0 ? `\n### Agent Commands\n\n${agentCommandsSection}\n` : ""}${skillEditGrantsSection}
## Per-Phase Artifacts

${artifactLinks}
${publicationSection}`;
}

export function writeFinalReport(
  info: RunReviewInfo,
  publication?: PublicationRecord,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const verifiedSurfaces = yield* aggregateVerifiedSurfaces(
      info.runPath,
      info.phaseStatuses.map((p) => p.phaseId),
    );
    const files = new Map<string, PhaseFiles>();
    for (const status of info.phaseStatuses) {
      // A phase folder that cannot be listed has no turn streams to name.
      const names = yield* fs
        .list(join(info.runPath, status.phaseId))
        .pipe(Effect.orElseSucceed((): readonly string[] => []));
      files.set(status.phaseId, {
        posture: yield* readPostureOf(info.runPath, status.phaseId),
        names,
      });
    }
    const content = buildFinalReportMarkdown(info, verifiedSurfaces, files, publication);
    yield* fs.writeAtomic(join(info.runPath, "final-report.md"), content);
  });
}
