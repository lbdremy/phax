// The path-class rule (spec finding-ids-and-fates §5.13). This module is the one
// place it lives. It reads a repository-relative path alone; the first rule that
// matches wins:
//
//   | class       | a path is in it when                                              |
//   | ----------- | ----------------------------------------------------------------- |
//   | gate-config | under `.github/workflows/`, or its basename names a gate tool's   |
//   |             | config (phax.json, tsconfig*.json, vitest.config.*, ...)          |
//   | tests       | a directory segment is test, tests, __tests__, __snapshots__ or   |
//   |             | e2e, or the basename is *.test.*, *.spec.*, *_test.* or test_*.py |
//   | docs        | the first segment is `docs`, or the extension is .md, .mdx,       |
//   |             | .markdown, .rst, .adoc or .txt (case-insensitive)                 |
//   | code        | everything else, package.json and lockfiles included              |
import { PATH_CLASSES, type PathClass } from "../../schemas/pathClass.js";

const GATE_CONFIG_NAMES: ReadonlySet<string> = new Set([
  "phax.json",
  "phax.local.json",
  "knip.json",
  "knip.jsonc",
  "tsconfig.json",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  ".oxfmtrc.jsonc",
  "biome.json",
  "biome.jsonc",
  "deno.json",
  "deno.jsonc",
  ".markdownlint.json",
  ".markdownlint.jsonc",
  ".markdownlint.yaml",
  ".eslintrc",
  ".prettierrc",
]);

const GATE_CONFIG_PATTERNS: readonly RegExp[] = [
  /^tsconfig\..+\.json$/,
  /^knip\.config\..+$/,
  /^vitest\.config\..+$/,
  /^vitest\..+\.config\..+$/,
  /^vitest\.workspace\..+$/,
  /^jest\.config\..+$/,
  /^playwright\.config\..+$/,
  /^eslint\.config\..+$/,
  /^\.eslintrc\..+$/,
  /^prettier\.config\..+$/,
  /^\.prettierrc\..+$/,
];

const TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  "test",
  "tests",
  "__tests__",
  "__snapshots__",
  "e2e",
]);

const TEST_BASENAMES: readonly RegExp[] = [
  /^.+\.test\..+$/,
  /^.+\.spec\..+$/,
  /^.+_test\..+$/,
  /^test_.*\.py$/,
];

const DOC_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".rst",
  ".adoc",
  ".txt",
]);

/** The class of one repository-relative path (`/` separators). Total: never throws. */
export function classifyPath(path: string): PathClass {
  const segments = path.split("/");
  const basename = segments.at(-1) ?? "";
  const directories = segments.slice(0, -1);

  if (
    path.startsWith(".github/workflows/") ||
    GATE_CONFIG_NAMES.has(basename) ||
    GATE_CONFIG_PATTERNS.some((pattern) => pattern.test(basename))
  ) {
    return "gate-config";
  }
  if (
    directories.some((segment) => TEST_DIRECTORIES.has(segment)) ||
    TEST_BASENAMES.some((pattern) => pattern.test(basename))
  ) {
    return "tests";
  }
  const dot = basename.lastIndexOf(".");
  const extension = dot === -1 ? "" : basename.slice(dot).toLowerCase();
  if (segments[0] === "docs" || DOC_EXTENSIONS.has(extension)) return "docs";
  return "code";
}

/** The classes of `paths` as a set, in `PATH_CLASSES` order, each at most once. */
export function pathClassesOf(paths: readonly string[]): readonly PathClass[] {
  const seen = new Set<PathClass>(paths.map(classifyPath));
  return PATH_CLASSES.filter((pathClass) => seen.has(pathClass));
}
