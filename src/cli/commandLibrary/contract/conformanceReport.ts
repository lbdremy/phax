/** What `conformance(runner)` answers: one entry per behaviour a runner owes. */
export interface ConformanceReport {
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly held: boolean;
    /** Present only when the case did not hold: what was expected and what came. */
    readonly why?: string;
  }>;
  readonly held: number;
  readonly failed: number;
}
