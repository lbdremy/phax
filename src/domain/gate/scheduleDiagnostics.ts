import type { CompletionDiagnostic, GateDiagnostic } from "../../schemas/gateDiagnostics.js";

export type ScopeClosure =
  | { readonly kind: "all" }
  | { readonly kind: "closed"; readonly closed: ReadonlySet<string> }
  | { readonly kind: "unavailable" };

export interface PendingDiagnostic {
  readonly diagnostic: CompletionDiagnostic;
  readonly openScopes: readonly string[];
}

export type ScheduleResult =
  | {
      readonly kind: "scheduled";
      readonly failing: readonly GateDiagnostic[];
      readonly pending: readonly PendingDiagnostic[];
    }
  | {
      readonly kind: "missing-provider";
      readonly completion: readonly CompletionDiagnostic[];
    };

export function scheduleDiagnostics(
  diagnostics: readonly GateDiagnostic[],
  closure: ScopeClosure,
): ScheduleResult {
  if (closure.kind === "unavailable") {
    const completion = diagnostics.filter(
      (diagnostic): diagnostic is CompletionDiagnostic => diagnostic.class === "completion",
    );
    if (completion.length > 0) {
      return { kind: "missing-provider", completion };
    }
    return { kind: "scheduled", failing: diagnostics, pending: [] };
  }

  const failing: GateDiagnostic[] = [];
  const pending: PendingDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.class === "invariant") {
      failing.push(diagnostic);
      continue;
    }

    if (closure.kind === "all") {
      failing.push(diagnostic);
      continue;
    }

    const openScopes = diagnostic.scopes.filter((scope) => !closure.closed.has(scope));
    if (openScopes.length === 0) {
      failing.push(diagnostic);
    } else {
      pending.push({ diagnostic, openScopes });
    }
  }

  return { kind: "scheduled", failing, pending };
}
