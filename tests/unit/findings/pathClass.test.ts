import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { classifyPath, pathClassesOf } from "../../../src/domain/findings/pathClass.js";
import { PATH_CLASSES, PathClassSchema, type PathClass } from "../../../src/schemas/pathClass.js";

const TABLE: ReadonlyArray<readonly [string, PathClass]> = [
  ["phax.json", "gate-config"],
  ["sub/phax.json", "gate-config"],
  ["tsconfig.test.json", "gate-config"],
  ["vitest.config.ts", "gate-config"],
  ["vitest.e2e.config.ts", "gate-config"],
  [".eslintrc", "gate-config"],
  [".prettierrc.yaml", "gate-config"],
  [".github/workflows/ci.yml", "gate-config"],
  ["tests/gate.test.ts", "tests"],
  ["src/app/gate.spec.ts", "tests"],
  ["tests/fixtures/notes.md", "tests"],
  ["pkg/x_test.go", "tests"],
  ["tools/test_x.py", "tests"],
  ["docs/gates.md", "docs"],
  ["docs/specs/x.md", "docs"],
  ["docs/diagram.png", "docs"],
  ["README.md", "docs"],
  ["CHANGELOG.MD", "docs"],
  ["src/app/gate.ts", "code"],
  ["src/latest.ts", "code"],
  ["src/test-utils.ts", "code"],
  ["package.json", "code"],
  ["pnpm-lock.yaml", "code"],
];

describe("classifyPath", () => {
  it.each(TABLE)("%s is %s", (path, expected) => {
    expect(classifyPath(path)).toBe(expected);
  });
});

describe("pathClassesOf", () => {
  it("writes the set in PATH_CLASSES order", () => {
    expect(pathClassesOf(["tests/gate.test.ts", "src/app/gate.ts", "docs/gates.md"])).toEqual([
      "code",
      "docs",
      "tests",
    ]);
  });

  it("is empty for no path", () => {
    expect(pathClassesOf([])).toEqual([]);
  });
});

describe("PathClassSchema", () => {
  it("decodes each class", () => {
    for (const pathClass of PATH_CLASSES) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(PathClassSchema)(pathClass))).toBe(true);
    }
  });

  it("refuses test, naming the set", () => {
    const result = Schema.decodeUnknownResult(PathClassSchema)("test");
    expect(Result.isFailure(result)).toBe(true);
    const message = String(Result.isFailure(result) ? result.failure : "");
    for (const pathClass of PATH_CLASSES) expect(message).toContain(pathClass);
  });
});
