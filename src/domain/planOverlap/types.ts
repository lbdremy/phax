export interface PlanFileSets {
  readonly create: readonly string[];
  readonly edit: readonly string[];
  readonly optional: readonly string[];
}

export interface PlanInput {
  readonly id: string;
  readonly label: string;
  readonly phases: readonly PlanFileSets[];
}

export interface PlanFootprint {
  readonly id: string;
  readonly label: string;
  readonly create: ReadonlySet<string>;
  readonly edit: ReadonlySet<string>;
  readonly optional: ReadonlySet<string>;
  readonly all: ReadonlySet<string>;
}

export type ConflictSeverity = "hard" | "medium" | "soft";

export interface SharedFile {
  readonly path: string;
  readonly severity: ConflictSeverity;
  readonly reason: string;
}

export interface OverlapEdge {
  readonly a: string;
  readonly b: string;
  readonly shared: readonly SharedFile[];
  readonly severity: ConflictSeverity;
}

export interface PlanOverlapResult {
  readonly footprints: readonly PlanFootprint[];
  readonly edges: readonly OverlapEdge[];
  readonly cleanPairs: readonly (readonly [string, string])[];
  readonly largestParallelSafeSet: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly exhaustiveSearchSkipped: boolean;
}
