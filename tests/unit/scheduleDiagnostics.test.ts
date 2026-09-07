import { describe, expect, it } from "vitest";
import {
  scheduleDiagnostics,
  type PendingDiagnostic,
  type ScopeClosure,
} from "../../src/domain/gate/scheduleDiagnostics.js";
import type { CompletionDiagnostic, GateDiagnostic } from "../../src/schemas/gateDiagnostics.js";

const invariant: GateDiagnostic = {
  class: "invariant",
  rule: "no-any",
  location: { file: "src/a.ts" },
  message: "uses any",
  repair: "add a type",
};

function completion(scopes: readonly [string, ...string[]]): CompletionDiagnostic {
  return {
    class: "completion",
    scopes,
    rule: "wired",
    location: { file: "src/a.ts" },
    message: "not wired yet",
    repair: "wire it up",
  };
}

const all: ScopeClosure = { kind: "all" };
const unavailable: ScopeClosure = { kind: "unavailable" };
function closed(...scopes: string[]): ScopeClosure {
  return { kind: "closed", closed: new Set(scopes) };
}

describe("scheduleDiagnostics", () => {
  it.each([
    ["all", all] as const,
    ["closed", closed()] as const,
    ["unavailable", unavailable] as const,
  ])("fails an invariant under closure kind %s", (_label, closure) => {
    const result = scheduleDiagnostics([invariant], closure);
    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      expect(result.failing).toEqual([invariant]);
      expect(result.pending).toEqual([]);
    }
  });

  it("marks a completion pending when a named scope is still open", () => {
    const diagnostic = completion(["core", "adapters"]);
    const result = scheduleDiagnostics([diagnostic], closed("core"));

    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      const expectedPending: PendingDiagnostic[] = [{ diagnostic, openScopes: ["adapters"] }];
      expect(result.failing).toEqual([]);
      expect(result.pending).toEqual(expectedPending);
    }
  });

  it("fails a completion once every named scope is closed", () => {
    const diagnostic = completion(["core", "adapters"]);
    const result = scheduleDiagnostics([diagnostic], closed("core", "adapters"));

    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      expect(result.failing).toEqual([diagnostic]);
      expect(result.pending).toEqual([]);
    }
  });

  it("fails a completion at the terminal phase regardless of closed scopes", () => {
    const diagnostic = completion(["core"]);
    const result = scheduleDiagnostics([diagnostic], all);

    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      expect(result.failing).toEqual([diagnostic]);
      expect(result.pending).toEqual([]);
    }
  });

  it("is a missing-provider outcome when unavailable and a completion is present", () => {
    const diagnostic = completion(["core"]);
    const result = scheduleDiagnostics([diagnostic], unavailable);

    expect(result.kind).toBe("missing-provider");
    if (result.kind === "missing-provider") {
      expect(result.completion).toEqual([diagnostic]);
    }
  });

  it("schedules invariants as failing when unavailable and there is no completion", () => {
    const result = scheduleDiagnostics([invariant], unavailable);

    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      expect(result.failing).toEqual([invariant]);
      expect(result.pending).toEqual([]);
    }
  });

  it("splits a mixed document into failing invariants and pending completions", () => {
    const pendingCompletion = completion(["adapters"]);
    const result = scheduleDiagnostics([invariant, pendingCompletion], closed());

    expect(result.kind).toBe("scheduled");
    if (result.kind === "scheduled") {
      expect(result.failing).toEqual([invariant]);
      expect(result.pending).toEqual([{ diagnostic: pendingCompletion, openScopes: ["adapters"] }]);
    }
  });
});
