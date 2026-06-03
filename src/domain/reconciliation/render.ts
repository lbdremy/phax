import type { PlannedFiles, ReconciliationResult } from "./types.js";

export function renderReconciliationMarkdown(
  result: ReconciliationResult,
  planned: PlannedFiles,
): string {
  const lines: string[] = [];

  lines.push("## PHAX File Reconciliation");
  lines.push("");

  // Planned creates
  if (planned.create.length > 0) {
    lines.push("### Planned to create");
    for (const f of planned.create) {
      const checked = result.createdAsPlanned.includes(f);
      lines.push(`- [${checked ? "x" : " "}] ${f}`);
    }
    lines.push("");
  }

  // Planned edits
  if (planned.edit.length > 0) {
    lines.push("### Planned to edit");
    for (const f of planned.edit) {
      const checked = result.editedAsPlanned.includes(f);
      lines.push(`- [${checked ? "x" : " "}] ${f}`);
    }
    lines.push("");
  }

  // Optional touched
  if (result.optionalTouched.length > 0) {
    lines.push("### Optional files touched");
    for (const f of result.optionalTouched) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Unplanned created
  if (result.unplannedCreated.length > 0) {
    lines.push("### Unplanned files created");
    lines.push(
      '> Deviation — agent must explain in `phase-handoff.md` under "What the next phase needs to know".',
    );
    for (const f of result.unplannedCreated) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Unplanned edited
  if (result.unplannedEdited.length > 0) {
    lines.push("### Unplanned files edited");
    lines.push(
      '> Deviation — agent must explain in `phase-handoff.md` under "What the next phase needs to know".',
    );
    for (const f of result.unplannedEdited) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Deletions
  if (result.deletions.length > 0) {
    lines.push("### Deleted files");
    for (const f of result.deletions) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Renames
  if (result.renames.length > 0) {
    lines.push("### Renamed files");
    for (const r of result.renames) {
      lines.push(`- ${r.from} → ${r.to}`);
    }
    lines.push("");
  }

  // Summary
  if (result.hasDeviations) {
    lines.push("**Summary:** Deviations detected — see sections above.");
  } else {
    lines.push("**Summary:** No deviations from the planned file lists.");
  }

  return lines.join("\n");
}
