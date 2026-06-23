import type { PhaseFileReconciliation } from "./types.js";

export type GlobalFileStatus =
  | "matched"
  | "missing"
  | "unplanned"
  | "extra-touch"
  | "partially-matched"
  | "action-mismatch"
  | "deleted"
  | "renamed"
  | "unknown";

export interface GlobalFileEntry {
  readonly path: string;
  readonly plannedInPhases: readonly string[];
  readonly touchedInPhases: readonly string[];
  readonly expectedActions: readonly ("create" | "edit")[];
  readonly actualActions: readonly ("added" | "modified" | "deleted" | "renamed")[];
  readonly status: GlobalFileStatus;
  readonly planned: boolean;
  readonly unplanned: boolean;
  readonly missing: boolean;
  readonly extraTouch: boolean;
  readonly attention: "ok" | "review";
}

export interface GlobalFileReconciliation {
  readonly files: readonly GlobalFileEntry[];
  readonly unplanned: readonly GlobalFileEntry[];
  readonly missing: readonly GlobalFileEntry[];
  readonly attentionPoints: readonly GlobalFileEntry[];
}

type Accumulator = {
  plannedInPhases: Set<string>;
  touchedInPhases: Set<string>;
  expectedActions: Set<"create" | "edit">;
  actualActions: Set<"added" | "modified" | "deleted" | "renamed">;
};

function getAcc(map: Map<string, Accumulator>, path: string): Accumulator {
  let acc = map.get(path);
  if (!acc) {
    acc = {
      plannedInPhases: new Set(),
      touchedInPhases: new Set(),
      expectedActions: new Set(),
      actualActions: new Set(),
    };
    map.set(path, acc);
  }
  return acc;
}

// Status precedence (highest to lowest):
// renamed > deleted > unplanned > missing > action-mismatch > extra-touch > partially-matched > matched > unknown
function deriveStatus(
  isPlanned: boolean,
  isTouched: boolean,
  plannedInPhases: readonly string[],
  touchedInPhases: readonly string[],
  expectedActions: ReadonlySet<string>,
  actualActions: ReadonlySet<string>,
): GlobalFileStatus {
  if (actualActions.has("renamed")) return "renamed";
  if (actualActions.has("deleted")) return "deleted";

  if (isTouched && !isPlanned) return "unplanned";
  if (isPlanned && !isTouched) return "missing";

  if (isPlanned && isTouched) {
    const plannedSet = new Set(plannedInPhases);
    const touchedSet = new Set(touchedInPhases);
    const allPlannedTouched = plannedInPhases.every((p) => touchedSet.has(p));
    const allTouchedPlanned = touchedInPhases.every((p) => plannedSet.has(p));

    // action-mismatch: every planned phase was touched, but no (create→added) or (edit→modified)
    // pair aligns. Only applies when the same phase is both planned and touched (allPlannedTouched),
    // so cross-phase combinations (missing in one, unplanned in another) still resolve to unknown.
    if (allPlannedTouched) {
      const hasAligned =
        (expectedActions.has("create") && actualActions.has("added")) ||
        (expectedActions.has("edit") && actualActions.has("modified"));
      if (!hasAligned) return "action-mismatch";
    }

    if (allPlannedTouched && allTouchedPlanned) return "matched";
    // extra-touch: all planned phases touched, plus additional phases
    if (allPlannedTouched && !allTouchedPlanned) return "extra-touch";
    // partially-matched: planned in multiple phases, touched in a non-empty strict subset
    if (!allPlannedTouched && allTouchedPlanned && plannedInPhases.length > 1) {
      return "partially-matched";
    }
  }

  return "unknown";
}

export function aggregateGlobalReconciliation(
  perPhase: readonly PhaseFileReconciliation[],
): GlobalFileReconciliation {
  const accMap = new Map<string, Accumulator>();

  for (const phase of perPhase) {
    const { phaseId } = phase;

    for (const f of phase.createdAsPlanned) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.touchedInPhases.add(phaseId);
      acc.expectedActions.add("create");
      acc.actualActions.add("added");
    }

    for (const f of phase.missingPlannedCreate) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.expectedActions.add("create");
    }

    for (const f of phase.editedAsPlanned) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.touchedInPhases.add(phaseId);
      acc.expectedActions.add("edit");
      acc.actualActions.add("modified");
    }

    for (const f of phase.missingPlannedEdit) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.expectedActions.add("edit");
    }

    for (const f of phase.createdButPlannedEdit) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.touchedInPhases.add(phaseId);
      acc.expectedActions.add("edit");
      acc.actualActions.add("added");
    }

    for (const f of phase.editedButPlannedCreate) {
      const acc = getAcc(accMap, f);
      acc.plannedInPhases.add(phaseId);
      acc.touchedInPhases.add(phaseId);
      acc.expectedActions.add("create");
      acc.actualActions.add("modified");
    }

    for (const f of phase.unplannedCreated) {
      const acc = getAcc(accMap, f);
      acc.touchedInPhases.add(phaseId);
      acc.actualActions.add("added");
    }

    for (const f of phase.unplannedEdited) {
      const acc = getAcc(accMap, f);
      acc.touchedInPhases.add(phaseId);
      acc.actualActions.add("modified");
    }

    for (const f of phase.optionalTouched) {
      const acc = getAcc(accMap, f);
      acc.touchedInPhases.add(phaseId);
      // optional files may be added or modified; ReconciliationResult doesn't distinguish
      acc.actualActions.add("modified");
    }

    for (const f of phase.deletions) {
      const acc = getAcc(accMap, f);
      acc.touchedInPhases.add(phaseId);
      acc.actualActions.add("deleted");
    }

    for (const r of phase.renames) {
      const acc = getAcc(accMap, r.to);
      acc.touchedInPhases.add(phaseId);
      acc.actualActions.add("renamed");
    }
  }

  const entries: GlobalFileEntry[] = [];

  for (const [path, acc] of accMap) {
    const plannedInPhases = [...acc.plannedInPhases].toSorted();
    const touchedInPhases = [...acc.touchedInPhases].toSorted();
    const expectedActions = [...acc.expectedActions].toSorted() as ("create" | "edit")[];
    const actualActions = [...acc.actualActions].toSorted() as (
      | "added"
      | "modified"
      | "deleted"
      | "renamed"
    )[];

    const isPlanned = plannedInPhases.length > 0;
    const isTouched = touchedInPhases.length > 0;

    const status = deriveStatus(
      isPlanned,
      isTouched,
      plannedInPhases,
      touchedInPhases,
      acc.expectedActions,
      acc.actualActions,
    );

    entries.push({
      path,
      plannedInPhases,
      touchedInPhases,
      expectedActions,
      actualActions,
      status,
      planned: isPlanned,
      unplanned: isTouched && !isPlanned,
      missing: isPlanned && !isTouched,
      extraTouch: status === "extra-touch",
      attention: status === "matched" ? "ok" : "review",
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files: entries,
    unplanned: entries.filter((e) => e.unplanned),
    missing: entries.filter((e) => e.missing),
    attentionPoints: entries.filter((e) => e.attention === "review"),
  };
}

export function renderGlobalReconciliationMarkdown(
  global: GlobalFileReconciliation,
  qualifiedRunName: string,
): string {
  const lines: string[] = [];

  lines.push("## Global File Reconciliation");
  lines.push("");
  lines.push(`**Run**: ${qualifiedRunName}`);
  lines.push("");
  lines.push("| File | Planned in | Touched in | Status | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const entry of global.files) {
    const plannedIn = entry.plannedInPhases.length > 0 ? entry.plannedInPhases.join(", ") : "—";
    const touchedIn = entry.touchedInPhases.length > 0 ? entry.touchedInPhases.join(", ") : "—";
    const notes = deriveNotes(entry);
    lines.push(`| ${entry.path} | ${plannedIn} | ${touchedIn} | ${entry.status} | ${notes} |`);
  }

  return lines.join("\n");
}

function deriveNotes(entry: GlobalFileEntry): string {
  switch (entry.status) {
    case "matched":
      return "—";
    case "missing":
      return `not touched in: ${entry.plannedInPhases.join(", ")}`;
    case "unplanned":
      return `unplanned in: ${entry.touchedInPhases.join(", ")}`;
    case "extra-touch":
      return `extra touch in: ${entry.touchedInPhases.filter((p) => !entry.plannedInPhases.includes(p)).join(", ")}`;
    case "partially-matched":
      return `not touched in: ${entry.plannedInPhases.filter((p) => !entry.touchedInPhases.includes(p)).join(", ")}`;
    case "action-mismatch":
      return `action mismatch: planned ${entry.expectedActions.join(", ")}, got ${entry.actualActions.join(", ")}`;
    case "deleted":
      return `deleted in: ${entry.touchedInPhases.join(", ")}`;
    case "renamed":
      return `renamed in: ${entry.touchedInPhases.join(", ")}`;
    case "unknown":
      return "—";
  }
}
