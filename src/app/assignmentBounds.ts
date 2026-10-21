import { Effect } from "effect";
import type { ConfigValidationError } from "../domain/errors.js";
import {
  assignmentFindings,
  boundCatalogProblems,
  type BoundedPhase,
  type PartResolution,
} from "../domain/plan/assignmentCheck.js";
import type { LintFinding } from "../domain/plan/lint.js";
import type { PhaseHeader } from "../domain/plan/phaseHeader.js";
import type { FileSystem } from "../ports/fs.js";
import type { Shell } from "../ports/shell.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { pullArchitecture } from "./architectureProvider.js";
import { loadProviderConfig } from "./loadRouting.js";

/**
 * The parts the config's part bounds name, from one architecture provider
 * call for the whole repository (`files: null`), run from the working tree's
 * root under the provider's time limit. With no part bound, nothing runs.
 * Never fails: a missing or failing provider is an `unavailable` resolution.
 */
export function resolveBoundParts(
  config: ResolvedConfig,
): Effect.Effect<PartResolution, never, Shell> {
  return Effect.gen(function* () {
    if (!(config.assignments ?? []).some((bound) => bound.kind === "part")) {
      return { kind: "resolved", parts: new Map() } as const;
    }
    if (config.architecture === undefined) {
      return { kind: "unavailable", cause: "no architecture provider is configured" } as const;
    }
    const pulled = yield* pullArchitecture({
      command: config.architecture.command,
      root: config.repoRoot,
      cwd: config.repoRoot,
      paths: [],
    });
    switch (pulled.kind) {
      case "answered":
        return {
          kind: "resolved",
          parts: new Map(pulled.report.parts.map((part) => [part.id, part.globs])),
        } as const;
      case "failed":
        return { kind: "unavailable", cause: pulled.reason } as const;
      case "refused":
        // A call with no path is never refused; kept total all the same.
        return { kind: "unavailable", cause: pulled.message } as const;
    }
  });
}

/**
 * The `models` findings of the config's bounds over the plan's phases: lint
 * reports them all, the run preflight refuses on the errors. The reasons are
 * the plan.md headers' `assignmentReason`.
 */
export function assignmentBoundFindings(input: {
  readonly config: ResolvedConfig;
  readonly phases: readonly BoundedPhase[];
  readonly headers: readonly PhaseHeader[];
  readonly providerConfig: ProviderConfig;
}): Effect.Effect<readonly LintFinding[], never, Shell> {
  return Effect.gen(function* () {
    const parts = yield* resolveBoundParts(input.config);
    return assignmentFindings({
      bounds: input.config.assignments,
      phases: input.phases,
      headers: input.headers,
      parts,
      providerConfig: input.providerConfig,
    });
  });
}

/**
 * One message per declared bound the routing catalog does not admit, read
 * from the catalog as a run would load it; empty without bounds.
 */
export function invalidBoundMessages(
  config: ResolvedConfig,
): Effect.Effect<readonly string[], ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    if (config.assignments === undefined) return [];
    const providerConfig = yield* loadProviderConfig();
    return boundCatalogProblems(config.assignments, providerConfig);
  });
}
