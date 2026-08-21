import type { GateDiagnostic } from "../../schemas/gateDiagnostics.js";

export interface BuildFixPromptInput {
  readonly command: string;
  readonly exitCode: number;
  readonly attempt: number;
  readonly logContent: string;
  readonly logPath: string;
  readonly diagnostics: readonly GateDiagnostic[];
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

export function buildFixPrompt(input: BuildFixPromptInput): string {
  const { command, exitCode, attempt, logContent, logPath, diagnostics } = input;

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
    "## Required action",
    "",
    "Read each repair guide above before changing code, then fix every diagnostic.",
    "Make the minimum changes required to pass the gate.",
    "Do not change unrelated code or introduce new features.",
    "",
    "Make sure to run the failed command after your changes to verify the gate now passes.",
    "The gate run will be re-attempted automatically after your changes.",
  ].join("\n");
}
