import { REGENERATED_ARTIFACTS } from "./generatedArtifacts.js";
import type {
  ConflictSeverity,
  OverlapEdge,
  PlanFileSets,
  PlanFootprint,
  PlanInput,
  PlanOverlapResult,
  SharedFile,
} from "./types.js";

export function buildFootprint(input: PlanInput): PlanFootprint {
  const create = new Set<string>();
  const edit = new Set<string>();
  const optional = new Set<string>();

  for (const phase of input.phases) {
    for (const p of phase.create) create.add(p);
    for (const p of phase.edit) edit.add(p);
    for (const p of phase.optional) optional.add(p);
  }

  const all = new Set<string>([...create, ...edit, ...optional]);

  return { id: input.id, label: input.label, create, edit, optional, all };
}

const SEVERITY_RANK: Record<ConflictSeverity, number> = { hard: 2, medium: 1, soft: 0 };

function maxSeverity(a: ConflictSeverity, b: ConflictSeverity): ConflictSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function classifyShared(path: string, a: PlanFootprint, b: PlanFootprint): SharedFile {
  if (REGENERATED_ARTIFACTS.has(path)) {
    return { path, severity: "hard", reason: "regenerated artifact — collides on merge" };
  }

  const aCreates = a.create.has(path);
  const bCreates = b.create.has(path);
  const aEdits = a.edit.has(path);
  const bEdits = b.edit.has(path);

  if (aCreates && bCreates) {
    return { path, severity: "hard", reason: "both plans create this file" };
  }

  if ((aCreates && bEdits) || (bCreates && aEdits)) {
    return { path, severity: "hard", reason: "one plan creates, the other edits" };
  }

  if (aEdits && bEdits) {
    if (path.endsWith(".md")) {
      return { path, severity: "soft", reason: "both plans edit this markdown file" };
    }
    return { path, severity: "medium", reason: "both plans edit this source file" };
  }

  // shared only via optional lists
  return { path, severity: "soft", reason: "shared optional file" };
}

export function computePlanOverlap(inputs: readonly PlanInput[]): PlanOverlapResult {
  const footprints = inputs.map(buildFootprint);

  const edges: OverlapEdge[] = [];
  const cleanPairs: (readonly [string, string])[] = [];

  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]!;
      const b = footprints[j]!;
      const shared: SharedFile[] = [];

      // Iterate in insertion order of a.all to keep output stable
      for (const path of a.all) {
        if (b.all.has(path)) {
          shared.push(classifyShared(path, a, b));
        }
      }

      if (shared.length === 0) {
        cleanPairs.push([a.id, b.id]);
      } else {
        const severity = shared.reduce<ConflictSeverity>(
          (acc, f) => maxSeverity(acc, f.severity),
          "soft",
        );
        edges.push({ a: a.id, b: b.id, shared, severity });
      }
    }
  }

  const ids = footprints.map((f) => f.id);
  const edgeSet = new Set(edges.map((e) => `${e.a}\0${e.b}`));
  const hasEdge = (a: string, b: string) => edgeSet.has(`${a}\0${b}`) || edgeSet.has(`${b}\0${a}`);

  let largestParallelSafeSet: readonly string[] = [];
  let exhaustiveSearchSkipped = false;

  if (ids.length > 16) {
    exhaustiveSearchSkipped = true;
  } else {
    const n = ids.length;
    for (let mask = (1 << n) - 1; mask >= 0; mask--) {
      const subset: string[] = [];
      for (let bit = 0; bit < n; bit++) {
        if (mask & (1 << bit)) subset.push(ids[bit]!);
      }
      if (subset.length <= largestParallelSafeSet.length) continue;
      let clean = true;
      outer: for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < subset.length; j++) {
          if (hasEdge(subset[i]!, subset[j]!)) {
            clean = false;
            break outer;
          }
        }
      }
      if (clean) largestParallelSafeSet = subset;
    }
  }

  // Greedy graph-colouring wave schedule
  const waves: string[][] = [];
  for (const id of ids) {
    let placed = false;
    for (const wave of waves) {
      const conflicts = wave.some((wid) => hasEdge(id, wid));
      if (!conflicts) {
        wave.push(id);
        placed = true;
        break;
      }
    }
    if (!placed) waves.push([id]);
  }

  return {
    footprints,
    edges,
    cleanPairs,
    largestParallelSafeSet,
    waves,
    exhaustiveSearchSkipped,
  };
}
