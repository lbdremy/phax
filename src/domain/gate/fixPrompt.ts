import type { GateDiagnostic } from "../../schemas/gateDiagnostics.js";
import type { PendingStep } from "../errors.js";
import type { PendingDiagnostic } from "./scheduleDiagnostics.js";

export interface BuildFixPromptInput {
  readonly command: string;
  readonly exitCode: number;
  readonly attempt: number;
  readonly logContent: string;
  readonly logPath: string;
  readonly diagnostics: readonly GateDiagnostic[];
  readonly pending: readonly PendingStep[];
}

function renderDiagnostic(diagnostic: GateDiagnostic): string {
  const location =
    diagnostic.location.line === undefined
      ? diagnostic.location.file
      : `${diagnostic.location.file}:${diagnostic.location.line}`;
  return [
    `- ${diagnostic.rule} at ${location} — ${diagnostic.message}`,
    `  repair guide: ${diagnostic.repair}`,
  ].join("\n");
}

function renderPendingDiagnostic(pending: PendingDiagnostic): string {
  const diagnostic = pending.diagnostic;
  const location =
    diagnostic.location.line === undefined
      ? diagnostic.location.file
      : `${diagnostic.location.file}:${diagnostic.location.line}`;
  return [
    `- ${diagnostic.rule} at ${location} — ${diagnostic.message} (scopes still open: ${pending.openScopes.join(", ")})`,
    `  repair guide: ${diagnostic.repair}`,
  ].join("\n");
}

function renderPendingSection(pending: readonly PendingStep[]): string[] {
  const flattened = pending.flatMap((step) => step.pending);
  if (flattened.length === 0) {
    return [];
  }
  return [
    "## Pending (optional — not required to pass this gate)",
    "",
    "These completion diagnostics name scopes a later phase is planned to close.",
    "You may address them now if it is cheap; the gate does not require it.",
    "",
    flattened.map(renderPendingDiagnostic).join("\n"),
    "",
  ];
}

export function buildFixPrompt(input: BuildFixPromptInput): string {
  const { command, exitCode, attempt, logContent, logPath, diagnostics, pending } = input;
  const pendingSection = renderPendingSection(pending);

  if (diagnostics.length === 0) {
    return [
      "# Gate checks failed — fix required",
      "",
      `Gate run (attempt ${attempt}) failed.`,
      "",
      `**Failed command:** \`${command}\``,
      `**Exit code:** ${exitCode}`,
      "",
      "## Gate output",
      "",
      "```",
      logContent,
      "```",
      "",
      ...pendingSection,
      "## Required action",
      "",
      "Fix all issues revealed by the gate output above.",
      "Make the minimum changes required to pass the gate.",
      "Do not change unrelated code or introduce new features.",
      "",
      "Make sure to run the failed command after your changes to verify the gate now passes.",
      "The gate run will be re-attempted automatically after your changes.",
    ].join("\n");
  }

  return [
    "# Gate checks failed — fix required",
    "",
    `Gate run (attempt ${attempt}) failed.`,
    "",
    `**Failed step:** \`${command}\` (${diagnostics.length} diagnostic(s))`,
    "",
    "## Diagnostics",
    "",
    diagnostics.map(renderDiagnostic).join("\n"),
    "",
    `Full output: ${logPath}`,
    "",
    ...pendingSection,
    "## Required action",
    "",
    "Read each repair guide above before changing code, then fix every diagnostic listed under **Diagnostics**.",
    "Make the minimum changes required to pass the gate.",
    "Do not change unrelated code or introduce new features.",
    "",
    "Make sure to run the failed command after your changes to verify the gate now passes.",
    "The gate run will be re-attempted automatically after your changes.",
  ].join("\n");
}
