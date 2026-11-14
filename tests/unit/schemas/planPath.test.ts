import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { isCanonicalPlanPath } from "../../../src/domain/plan/planPath.js";
import { PLAN_PATH_PATTERN, PlanPath, PlanPathFromWritten } from "../../../src/schemas/planPath.js";
import { refusalsOf } from "../../../src/schemas/refusal/adapter.js";
import { renderPublishedJsonSchema } from "../../../src/schemas/publishedJsonSchema.js";

// (written, canonical form or undefined, refusal reason or undefined)
const CASES: ReadonlyArray<readonly [string, string | undefined, string | undefined]> = [
  ["src/widget.ts", "src/widget.ts", undefined],
  ["./src/x.ts", "src/x.ts", undefined],
  ["src//x.ts", "src/x.ts", undefined],
  ["src/a/../x.ts", "src/x.ts", undefined],
  ["", undefined, "is empty"],
  [".", undefined, "is empty"],
  ["./", undefined, "is empty"],
  ["a/..", undefined, "is empty"],
  ["/src/x.ts", undefined, "is absolute"],
  ["../x.ts", undefined, "leaves the repository"],
  ["src/../../x.ts", undefined, "leaves the repository"],
  ["src/", undefined, "names a directory"],
  ["src\\x.ts", undefined, "contains a backslash"],
  ["x", "x", undefined],
  ["..a/b", "..a/b", undefined],
  ["a/.b", "a/.b", undefined],
  ["...", "...", undefined],
  ["/", undefined, "is absolute"],
  ["a//", undefined, "names a directory"],
  ["a/b/..", "a", undefined],
  ["src/*.ts", "src/*.ts", undefined],
];

const decodePlanPath = Schema.decodeUnknownResult(PlanPath, { reportInput: true });
const decodeWritten = Schema.decodeUnknownResult(PlanPathFromWritten, { reportInput: true });
const encodeWritten = Schema.encodeUnknownResult(PlanPathFromWritten);

function messageOf(result: ReturnType<typeof decodePlanPath>): string | null | undefined {
  if (!Result.isFailure(result)) return undefined;
  const refusal = refusalsOf(result.failure)[0];
  return refusal !== undefined && "message" in refusal ? refusal.message : undefined;
}

describe("PlanPath", () => {
  it.each(CASES)("reads %j", (written, canonical, reason) => {
    const result = decodePlanPath(written);
    if (canonical === written) {
      expect(Result.isSuccess(result) && result.success).toBe(written);
      return;
    }
    expect(Result.isFailure(result)).toBe(true);
    expect(messageOf(result)).toBe(
      canonical === undefined ? reason : `is not canonical: write ${JSON.stringify(canonical)}`,
    );
  });

  it("refuses a non-string", () => {
    expect(Result.isFailure(decodePlanPath(3))).toBe(true);
  });
});

describe("PlanPathFromWritten", () => {
  it.each(CASES)("reads %j", (written, canonical, reason) => {
    const result = decodeWritten(written);
    if (canonical !== undefined) {
      expect(Result.isSuccess(result) && result.success).toBe(canonical);
      return;
    }
    expect(Result.isFailure(result)).toBe(true);
    expect(messageOf(result)).toBe(reason);
  });

  it("encodes as the identity", () => {
    const result = encodeWritten("src/x.ts");
    expect(Result.isSuccess(result) && result.success).toBe("src/x.ts");
  });
});

describe("JSON Schemas", () => {
  const plan = renderPublishedJsonSchema({ schema: PlanPath, title: "t", excess: "error" });
  const written = renderPublishedJsonSchema({
    schema: Schema.toEncoded(PlanPathFromWritten),
    title: "t",
    excess: "error",
  });

  it("states the rule and carries a pattern matching exactly the canonical paths", () => {
    expect(plan["description"]).toContain("canonical form");
    expect(plan["pattern"]).toBe(PLAN_PATH_PATTERN);
    expect(PLAN_PATH_PATTERN).not.toMatch(/\(\?[=!<]/);
    const pattern = new RegExp(PLAN_PATH_PATTERN);
    for (const [path] of CASES) {
      expect(pattern.test(path), path).toBe(isCanonicalPlanPath(path));
    }
  });

  it("admits ./src/x.ts on the written side, with no pattern", () => {
    expect(written["description"]).toContain("rewrites");
    expect(written["pattern"]).toBeUndefined();
  });
});
