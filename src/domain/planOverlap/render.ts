import type { PlanOverlapResult } from "./types.js";

export function renderPlanOverlap(result: PlanOverlapResult): string {
  const lines: string[] = [];

  lines.push("=== Plan Overlap Analysis ===");
  lines.push("");

  // Footprint summary
  lines.push("Footprints:");
  for (const fp of result.footprints) {
    lines.push(`  ${fp.label}: ${fp.all.size} file(s)`);
  }
  lines.push("");

  // Pairwise matrix
  lines.push("Pairwise matrix:");
  const allPairs: { a: string; b: string }[] = [];
  for (let i = 0; i < result.footprints.length; i++) {
    for (let j = i + 1; j < result.footprints.length; j++) {
      allPairs.push({ a: result.footprints[i]!.id, b: result.footprints[j]!.id });
    }
  }

  const labelById = new Map(result.footprints.map((fp) => [fp.id, fp.label]));
  const edgeIndex = new Map(result.edges.map((e) => [`${e.a}\0${e.b}`, e]));

  for (const { a, b } of allPairs) {
    const aLabel = labelById.get(a) ?? a;
    const bLabel = labelById.get(b) ?? b;
    const edge = edgeIndex.get(`${a}\0${b}`);
    if (!edge) {
      lines.push(`  ${aLabel} <-> ${bLabel}: clean`);
    } else {
      const files = edge.shared.map((f) => f.path).join(", ");
      lines.push(`  ${aLabel} <-> ${bLabel}: ${edge.severity} -> ${files}`);
    }
  }
  lines.push("");

  // Clean pairs
  if (result.cleanPairs.length === 0) {
    lines.push("Clean pairs: none");
  } else {
    lines.push("Clean pairs:");
    for (const [a, b] of result.cleanPairs) {
      const aLabel = labelById.get(a) ?? a;
      const bLabel = labelById.get(b) ?? b;
      lines.push(`  ${aLabel} <-> ${bLabel}`);
    }
  }
  lines.push("");

  // Largest parallel-safe set
  if (result.exhaustiveSearchSkipped) {
    lines.push(
      "Largest parallel-safe set: search skipped (more than 16 plans — use wave schedule below)",
    );
  } else if (result.largestParallelSafeSet.length === 0) {
    lines.push("Largest parallel-safe set: none");
  } else {
    const setLabels = result.largestParallelSafeSet.map((id) => labelById.get(id) ?? id).join(", ");
    lines.push(`Largest parallel-safe set: ${setLabels}`);
  }
  lines.push("");

  // Greedy wave schedule
  lines.push("Wave schedule (greedy):");
  for (let i = 0; i < result.waves.length; i++) {
    const waveLabels = result.waves[i]!.map((id) => labelById.get(id) ?? id).join(", ");
    lines.push(`  Wave ${i + 1}: ${waveLabels}`);
  }
  lines.push("");

  // Caveat block
  lines.push("---");
  lines.push("Caveats:");
  lines.push(
    "  Declared, not guaranteed: this report reflects each plan's declared file intentions,",
  );
  lines.push(
    "  not what agents will actually touch. phax reconciles declared vs actual after each phase.",
  );
  lines.push(
    "  File-level, not hunk-level: two plans editing different regions of the same file are",
  );
  lines.push("  flagged as a conflict even though git may auto-merge them.");
  lines.push("  Regenerated artifacts (phax.usage.kdl, docs/cli/reference.md) are a hard-conflict");
  lines.push(
    "  class: two plans that both regenerate them will collide on merge even when neither",
  );
  lines.push("  lists them as a manual edit.");

  return lines.join("\n");
}
