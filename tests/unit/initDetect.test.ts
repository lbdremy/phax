import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeNamespace } from "../../src/domain/branded.js";
import {
  detectName,
  detectPackageManager,
  slugify,
  suggestGateCommands,
} from "../../src/domain/init/detect.js";
import { decodePackageJson } from "../../src/schemas/packageJson.js";

describe("slugify", () => {
  it("strips @scope/ prefix", () => {
    expect(slugify("@org/foo")).toBe("foo");
    expect(slugify("@my-org/my-package")).toBe("my-package");
  });

  it("lowercases and replaces invalid chars with hyphens", () => {
    expect(slugify("MyProject")).toBe("myproject");
    expect(slugify("my project")).toBe("my-project");
    expect(slugify("my.project")).toBe("my-project");
    expect(slugify("my_project")).toBe("my-project");
    expect(slugify("My.Cool_Project")).toBe("my-cool-project");
  });

  it("collapses runs of invalid chars into a single hyphen", () => {
    expect(slugify("a...b")).toBe("a-b");
    expect(slugify("a   b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-foo-")).toBe("foo");
    expect(slugify("...foo...")).toBe("foo");
  });

  it("prefixes p- when result starts with a digit", () => {
    expect(slugify("123project")).toBe("p-123project");
    expect(slugify("1foo")).toBe("p-1foo");
    expect(slugify("@scope/2bar")).toBe("p-2bar");
  });

  it("output always satisfies the Namespace brand", () => {
    const cases = ["@org/foo", "MyProject", "my project", "1foo", "@scope/2bar", "a...b"];
    for (const raw of cases) {
      const s = slugify(raw);
      if (s) {
        expect(Either.isRight(decodeNamespace(s))).toBe(true);
      }
    }
  });
});

describe("detectName", () => {
  it("returns slugified pkg.name when present", () => {
    expect(detectName({ name: "my-app" }, "fallback")).toBe("my-app");
    expect(detectName({ name: "@org/my-lib" }, "fallback")).toBe("my-lib");
  });

  it("falls back to slugified cwdBasename when pkg.name is empty", () => {
    expect(detectName({ name: "" }, "my-dir")).toBe("my-dir");
    expect(detectName({}, "my-dir")).toBe("my-dir");
  });

  it("falls back to 'project' when both are empty/invalid", () => {
    expect(detectName({}, "")).toBe("project");
    expect(detectName({ name: "" }, "")).toBe("project");
  });

  it("output satisfies the Namespace brand", () => {
    const name = detectName({ name: "My App" }, "fallback");
    expect(Either.isRight(decodeNamespace(name))).toBe(true);
  });
});

describe("detectPackageManager", () => {
  it("returns pnpm when packageManager starts with pnpm", () => {
    expect(detectPackageManager({ packageManager: "pnpm@10.0.0" })).toBe("pnpm");
    expect(detectPackageManager({ packageManager: "pnpm" })).toBe("pnpm");
  });

  it("returns npm when packageManager starts with npm", () => {
    expect(detectPackageManager({ packageManager: "npm@9.0.0" })).toBe("npm");
  });

  it("returns yarn when packageManager starts with yarn", () => {
    expect(detectPackageManager({ packageManager: "yarn@3.0.0" })).toBe("yarn");
  });

  it("falls back to pnpm when packageManager is missing", () => {
    expect(detectPackageManager({})).toBe("pnpm");
    expect(detectPackageManager({ packageManager: undefined })).toBe("pnpm");
  });

  it("falls back to pnpm for unknown package manager", () => {
    expect(detectPackageManager({ packageManager: "bun@1.0.0" })).toBe("pnpm");
  });
});

describe("suggestGateCommands", () => {
  it("returns empty array when no scripts present", () => {
    expect(suggestGateCommands({}, "pnpm")).toEqual([]);
    expect(suggestGateCommands({ scripts: {} }, "pnpm")).toEqual([]);
  });

  it("includes only known scripts that are present", () => {
    const result = suggestGateCommands(
      { scripts: { typecheck: "tsc", build: "tsc -b", start: "node dist/main.js" } },
      "pnpm",
    );
    expect(result.map((r) => r.script)).toEqual(["typecheck", "build"]);
  });

  it("prefixes command with the package manager", () => {
    const result = suggestGateCommands({ scripts: { typecheck: "tsc" } }, "npm");
    expect(result[0]?.command).toBe("npm typecheck");
  });

  it("marks typecheck and lint as recommended", () => {
    const result = suggestGateCommands({ scripts: { typecheck: "tsc", lint: "eslint ." } }, "pnpm");
    expect(result.find((r) => r.script === "typecheck")?.recommended).toBe(true);
    expect(result.find((r) => r.script === "lint")?.recommended).toBe(true);
  });

  it("marks test as recommended when test:unit is absent", () => {
    const result = suggestGateCommands({ scripts: { test: "vitest run" } }, "pnpm");
    expect(result.find((r) => r.script === "test")?.recommended).toBe(true);
  });

  it("marks test:unit recommended and test not recommended when both present", () => {
    const result = suggestGateCommands(
      { scripts: { test: "vitest run", "test:unit": "vitest run unit" } },
      "pnpm",
    );
    expect(result.find((r) => r.script === "test:unit")?.recommended).toBe(true);
    expect(result.find((r) => r.script === "test")?.recommended).toBe(false);
  });

  it("orders test:unit before test", () => {
    const result = suggestGateCommands(
      { scripts: { test: "vitest run", "test:unit": "vitest run unit" } },
      "pnpm",
    );
    const testUnitIdx = result.findIndex((r) => r.script === "test:unit");
    const testIdx = result.findIndex((r) => r.script === "test");
    expect(testUnitIdx).toBeLessThan(testIdx);
  });

  it("marks format, format:check, build as not recommended", () => {
    const result = suggestGateCommands(
      {
        scripts: {
          format: "prettier --write .",
          "format:check": "prettier --check .",
          build: "tsc -b",
        },
      },
      "pnpm",
    );
    for (const r of result) {
      expect(r.recommended).toBe(false);
    }
  });

  it("produces stable ordering across full script set", () => {
    const result = suggestGateCommands(
      {
        scripts: {
          build: "tsc -b",
          "format:check": "prettier --check .",
          format: "prettier --write .",
          test: "vitest run",
          "test:unit": "vitest run unit",
          lint: "eslint .",
          typecheck: "tsc",
        },
      },
      "pnpm",
    );
    expect(result.map((r) => r.script)).toEqual([
      "typecheck",
      "lint",
      "test:unit",
      "test",
      "format",
      "format:check",
      "build",
    ]);
  });
});

describe("decodePackageJson", () => {
  it("decodes a realistic package.json with extra unrelated keys", () => {
    const raw = {
      name: "@my-org/my-app",
      version: "1.2.3",
      description: "A cool app",
      main: "dist/index.js",
      license: "MIT",
      private: true,
      scripts: {
        build: "tsc -b",
        test: "vitest run",
        typecheck: "tsc --noEmit",
        start: "node dist/index.js",
      },
      packageManager: "pnpm@10.0.0",
      dependencies: { effect: "^3.0.0" },
      devDependencies: { vitest: "^2.0.0" },
      keywords: ["cli", "ai"],
      author: "Alice",
    };
    const result = decodePackageJson(raw);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.name).toBe("@my-org/my-app");
      expect(result.right.packageManager).toBe("pnpm@10.0.0");
      expect(result.right.scripts?.["typecheck"]).toBe("tsc --noEmit");
    }
  });

  it("decodes a minimal package.json with no relevant fields", () => {
    const result = decodePackageJson({ name: "bare", version: "0.0.1", private: true });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes an empty object", () => {
    const result = decodePackageJson({});
    expect(Either.isRight(result)).toBe(true);
  });
});
