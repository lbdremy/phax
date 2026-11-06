import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  describePartialRefusal,
  parsePartialCommand,
  partialAllowPrefixes,
  type PartialCommandRefusal,
  type PartialVariant,
} from "../../src/domain/gate/partialCommand.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";

function refusalOf(command: string, variant: PartialVariant): PartialCommandRefusal | undefined {
  const parsed = parsePartialCommand(command, variant);
  return Either.isLeft(parsed) ? parsed.left : undefined;
}

function prefixesOf(command: string, variant: PartialVariant): readonly string[] {
  const parsed = parsePartialCommand(command, variant);
  if (Either.isLeft(parsed)) throw new Error(`refused: ${JSON.stringify(parsed.left)}`);
  return parsed.right.segments.map((segment) => segment.prefix);
}

const constructs: readonly [string, string, string][] = [
  ["a line break", "ls\nls", "line break"],
  ["a carriage return", "ls\rls", "line break"],
  ["a command substitution", "ls $(pwd)", "$("],
  ["a backtick", "ls `pwd`", "`"],
  ["and-and", "ls && ls", "&&"],
  ["or-or", "ls || ls", "||"],
  ["a lone ampersand", "ls & ls", "&"],
  ["an append redirection", "ls >> out", ">>"],
  ["a redirection", "ls > out", ">"],
  ["an input redirection", "ls < in", "<"],
  ["a semicolon", "ls; ls", ";"],
];

describe("parsePartialCommand refusals", () => {
  it.each(constructs)("refuses %s, naming it", (_name, command, construct) => {
    expect(refusalOf(command, "diff")).toEqual({ kind: "construct", construct });
  });

  it.each([
    ["line break before $(", "a\n$(b)", "line break"],
    ["$( before backtick", "$(a) `b`", "$("],
    ["backtick before &&", "`a` && b", "`"],
    ["&& before ||", "a || b && c", "&&"],
    ["|| before &", "a & b || c", "||"],
    ["& before >>", "a >> b & c", "&"],
    [">> before >", "a > b >> c", ">>"],
    ["> before <", "a < b > c", ">"],
    ["< before ;", "a ; b < c", "<"],
  ])("names the first construct in order: %s", (_name, command, construct) => {
    expect(refusalOf(command, "diff")).toEqual({ kind: "construct", construct });
  });

  it("does not take a placeholder for a redirection", () => {
    expect(refusalOf("pnpm exec oxlint <files>", "files")).toBeUndefined();
  });

  it("refuses a bare < or > beside a placeholder", () => {
    expect(refusalOf("cmd <files> > out", "files")).toEqual({ kind: "construct", construct: ">" });
    expect(refusalOf("cmd < <files>", "files")).toEqual({ kind: "construct", construct: "<" });
  });

  it.each([
    ["ls |", "diff"],
    ["| ls", "diff"],
    ["ls | | ls", "diff"],
  ] as const)("refuses the empty segment in %s", (command, variant) => {
    expect(refusalOf(command, variant)).toEqual({ kind: "empty-segment" });
  });

  it("refuses a segment that starts with a placeholder", () => {
    expect(refusalOf("<files>", "files")).toEqual({ kind: "leading-placeholder" });
    expect(refusalOf("ls | <files> --fix", "files")).toEqual({ kind: "leading-placeholder" });
  });

  it("refuses a files command with no placeholder", () => {
    expect(refusalOf("pnpm exec oxlint", "files")).toEqual({ kind: "needs-placeholder" });
  });

  it("refuses a diff command with a placeholder", () => {
    expect(refusalOf("xargs pnpm exec oxlint <files>", "diff")).toEqual({
      kind: "no-placeholder-allowed",
    });
  });

  it("splits or refuses a quoted metacharacter like an unquoted one", () => {
    expect(refusalOf("grep 'a;b'", "diff")).toEqual({ kind: "construct", construct: ";" });
    expect(prefixesOf("grep 'a|b'", "diff")).toEqual(["grep 'a", "b'"]);
  });

  it("words every refusal", () => {
    expect(describePartialRefusal({ kind: "construct", construct: ";" })).toBe(
      '";" is not allowed in a partial command; join commands with "|" only',
    );
    expect(describePartialRefusal({ kind: "needs-placeholder" })).toBe(
      "a files command needs a placeholder such as <files>",
    );
    expect(describePartialRefusal({ kind: "no-placeholder-allowed" })).toBe(
      "a diff command takes no placeholder",
    );
    expect(describePartialRefusal({ kind: "empty-segment" })).toContain("empty segment");
    expect(describePartialRefusal({ kind: "leading-placeholder" })).toContain("start with");
  });
});

describe("parsePartialCommand accepted forms", () => {
  const accepted: readonly [string, PartialVariant, string, readonly string[]][] = [
    ["a files command", "files", "pnpm exec oxlint <files>", ["pnpm exec oxlint"]],
    [
      "a two-segment diff command",
      "diff",
      "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint",
      ["git diff --name-only --diff-filter=d", "xargs pnpm exec oxlint"],
    ],
    ["a pipe through xargs", "diff", "ls | xargs wc -l", ["ls", "xargs wc -l"]],
    [
      "a hyphenated placeholder name",
      "files",
      "pnpm exec vitest run <test-files>",
      ["pnpm exec vitest run"],
    ],
    [
      "whitespace normalization",
      "files",
      "  pnpm   exec\toxlint   <files>  ",
      ["pnpm exec oxlint"],
    ],
    ["words after a mid-segment placeholder", "files", "tool <files> --flag", ["tool"]],
    [
      "a placeholder glued inside a word (prefix stops before that word)",
      "files",
      "pnpm exec vitest run --dir=<dir>",
      ["pnpm exec vitest run"],
    ],
    [
      "a placeholder in the second segment only",
      "files",
      "ls | xargs wc <files>",
      ["ls", "xargs wc"],
    ],
  ];

  it.each(accepted)("%s", (_name, variant, command, prefixes) => {
    expect(prefixesOf(command, variant)).toEqual(prefixes);
  });

  it("normalizes segment text", () => {
    const parsed = parsePartialCommand(" ls   -l |  xargs   wc ", "diff");
    expect(Either.isRight(parsed) && parsed.right.segments).toEqual([
      { text: "ls -l", prefix: "ls -l" },
      { text: "xargs wc", prefix: "xargs wc" },
    ]);
  });

  it("never yields a prefix holding <, > or |, and each is a whole-word prefix of its segment", () => {
    for (const [, variant, command] of accepted) {
      const parsed = parsePartialCommand(command, variant);
      if (Either.isLeft(parsed)) throw new Error(command);
      for (const { text, prefix } of parsed.right.segments) {
        expect(prefix).not.toMatch(/[<>|]/);
        const words = text.split(" ");
        const prefixWords = prefix === "" ? [] : prefix.split(" ");
        expect(words.slice(0, prefixWords.length)).toEqual(prefixWords);
      }
    }
  });
});

function step(command: string, partial?: GateStep["partial"]): GateStep {
  return {
    command,
    surface: "local",
    firing: "every-phase",
    output: "log",
    ...(partial ? { partial } : {}),
  };
}

describe("partialAllowPrefixes", () => {
  it("lists prefixes in step order, files before diff, segments in order", () => {
    const steps = [
      step("pnpm lint", {
        diff: "git diff --name-only | xargs pnpm exec oxlint",
        files: "pnpm exec oxlint <files>",
      }),
      step("pnpm build"),
      step("pnpm test", { files: "pnpm exec vitest run <test-files>" }),
    ];
    expect(partialAllowPrefixes(steps)).toEqual([
      "pnpm exec oxlint",
      "git diff --name-only",
      "xargs pnpm exec oxlint",
      "pnpm exec vitest run",
    ]);
  });

  it("deduplicates across steps and variants", () => {
    const steps = [
      step("a", { files: "pnpm exec oxlint <files>" }),
      step("b", { diff: "ls | xargs pnpm exec oxlint" }),
      step("c", { files: "pnpm exec oxlint <more>" }),
    ];
    expect(partialAllowPrefixes(steps)).toEqual([
      "pnpm exec oxlint",
      "ls",
      "xargs pnpm exec oxlint",
    ]);
  });

  it("is empty when no step declares a partial", () => {
    expect(partialAllowPrefixes([step("pnpm lint")])).toEqual([]);
  });

  it("throws on a command the loader would have refused", () => {
    expect(() => partialAllowPrefixes([step("a", { diff: "ls; ls" })])).toThrow();
  });
});
