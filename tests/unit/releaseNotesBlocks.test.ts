// What the release notes oracles do not pin: the helpers of scripts/releaseNotes.ts.
import { describe, expect, it } from "vitest";

import {
  absolutizeLinks,
  commitType,
  escapeSubject,
  fenced,
  surfaceName,
} from "../../scripts/releaseNotes.js";

const REPOSITORY = "https://github.com/acme/tool";
const BASE = `${REPOSITORY}/blob/v4.2.0`;

describe("commitType", () => {
  it.each([
    ["fix: one", "fix"],
    ["fix(scope): one", "fix"],
    ["feat!: one", "feat"],
    ["feat(scope)!: one", "feat"],
    ["FIX: one", "fix"],
    ["Chore(Plans): one", "chore"],
    ["fix:one", null],
    [": one", null],
    ["(scope): one", null],
    ["Tidy things up", null],
    ["fix2: one", null],
  ])("reads the type of %j as %j", (subject, type) => {
    expect(commitType(subject)).toBe(type);
  });
});

describe("absolutizeLinks", () => {
  const upgrading = (text: string): { text: string; warnings: string[] } => {
    const warnings: string[] = [];
    return {
      text: absolutizeLinks(text, "docs/upgrading.md", REPOSITORY, "4.2.0", warnings),
      warnings,
    };
  };

  it.each([
    ["[a](mailto:me@example.com)", "[a](mailto:me@example.com)"],
    ["[a](https://example.com/x#y)", "[a](https://example.com/x#y)"],
    ["[a](/docs/x.md#y)", `[a](${BASE}/docs/x.md#y)`],
    ["[a](//docs/x.md)", `[a](${BASE}/docs/x.md)`],
    ["[a](#x)", `[a](${BASE}/docs/upgrading.md#x)`],
    ["[a](../README.md#x)", `[a](${BASE}/README.md#x)`],
    ["[a](./bounds.md)", `[a](${BASE}/docs/bounds.md)`],
    ['[a]: bounds.md "Title"', `[a]: ${BASE}/docs/bounds.md "Title"`],
  ])("rewrites %j", (input, expected) => {
    const result = upgrading(input);
    expect(result.text).toBe(expected);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a destination that leaves the repository and warns", () => {
    const result = upgrading("[a](../../x.md) and [b](/../y.md)");
    expect(result.text).toBe("[a](../../x.md) and [b](/../y.md)");
    expect(result.warnings).toEqual([
      "docs/upgrading.md: the link ../../x.md leaves the repository and is kept as written",
      "docs/upgrading.md: the link /../y.md leaves the repository and is kept as written",
    ]);
  });

  it("resolves a plan's links from docs/plans/archive", () => {
    const warnings: string[] = [];
    const text = absolutizeLinks(
      "[a](../specs/x.md), [b](#c), [d](/README.md), [e](https://example.com)",
      "docs/plans/archive/p.md",
      REPOSITORY,
      "4.2.0",
      warnings,
    );
    expect(text).toBe(
      `[a](${BASE}/docs/plans/specs/x.md), [b](${BASE}/docs/plans/archive/p.md#c), [d](${BASE}/README.md), [e](https://example.com)`,
    );
    expect(warnings).toEqual([]);
  });
});

describe("escapeSubject", () => {
  it.each(["\\", "`", "*", "_", "[", "]", "<", ">", "&", "~", "|"])("escapes %j", (char) => {
    expect(escapeSubject(`a${char}b`)).toBe(`a\\${char}b`);
  });

  it("leaves a subject with no active character as written", () => {
    expect(escapeSubject("fix(scope): plain words, 1.2 (ok)!")).toBe(
      "fix(scope): plain words, 1.2 (ok)!",
    );
  });
});

describe("fenced", () => {
  it.each([
    [0, "```"],
    [2, "```"],
    [3, "````"],
    [5, "``````"],
  ])("fences content with a backtick run of %i with %j", (run, fence) => {
    const content = `a ${"`".repeat(run)} b`;
    expect(fenced(content)).toBe(`${fence}text\n${content}\n${fence}`);
  });
});

describe("surfaceName", () => {
  it.each([
    ["cli: tool run <name>", "tool run <name>"],
    ["cli:tool run", "tool run"],
    ["config: tool.json key run", "tool.json key run"],
    ["config:tool.json", "tool.json"],
    ["file: tool.log", "tool.log"],
    ["file:tool.log", "tool.log"],
    [
      "file: plan sidecar `docs/plans/<stamp>-<slug>-plan.json`, phase `testStrategy`",
      "plan sidecar docs/plans/<stamp>-<slug>-plan.json, phase testStrategy",
    ],
    ["config: tool.json key `ship`", "tool.json key ship"],
    ["file: ends with a `tick`", "ends with a tick"],
    ["file: the key ends with `", "the key ends with"],
    ["api: shipThing(`name`)", "api: shipThing(name)"],
    ["  bare `name`  ", "bare name"],
  ])("shows %j as %j", (surface, name) => {
    expect(surfaceName(surface)).toBe(name);
  });
});
