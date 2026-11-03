import { describe, expect, it } from "vitest";
import { readWords, type Words } from "../../../../src/cli/commandLibrary/commander/undeclared.js";

const declared = [
  { option: "to", takesValue: true },
  { option: "dry-run", takesValue: false },
];

const none: Words = {
  kept: [],
  operands: [],
  undeclared: [],
  help: false,
  version: false,
  valueMissing: undefined,
};

describe("the reading step", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly words: ReadonlyArray<string>;
    readonly read: Partial<Words>;
  }> = [
    {
      name: "sets a bare undeclared option apart, alone",
      words: ["t1", "--x", "--to", "one"],
      read: {
        kept: ["t1", "--to", "one"],
        operands: ["t1"],
        undeclared: ["--x"],
      },
    },
    {
      name: "reads the word after a bare undeclared option as what it is",
      words: ["--x", "yes", "--to", "one"],
      read: {
        kept: ["yes", "--to", "one"],
        operands: ["yes"],
        undeclared: ["--x"],
      },
    },
    {
      name: "sets an undeclared option with its value apart, whole",
      words: ["t1", "--x=v", "--to", "one"],
      read: {
        kept: ["t1", "--to", "one"],
        operands: ["t1"],
        undeclared: ["--x=v"],
      },
    },
    {
      name: "sets a short option apart, alone",
      words: ["-x", "t1", "--to", "one"],
      read: {
        kept: ["t1", "--to", "one"],
        operands: ["t1"],
        undeclared: ["-x"],
      },
    },
    {
      name: "sets a short cluster apart as one option",
      words: ["-abc", "t1"],
      read: { kept: ["t1"], operands: ["t1"], undeclared: ["-abc"] },
    },
    {
      name: "reads a negative number as an option",
      words: ["-5", "t1", "-1.5"],
      read: { kept: ["t1"], operands: ["t1"], undeclared: ["-5", "-1.5"] },
    },
    {
      name: "reads a lone dash as an option",
      words: ["-", "t1"],
      read: { kept: ["t1"], operands: ["t1"], undeclared: ["-"] },
    },
    {
      name: "reads every word after -- as a positional argument, a dash-word too",
      words: ["t1", "--", "-x", "--y"],
      read: {
        kept: ["t1", "--", "-x", "--y"],
        operands: ["t1", "-x", "--y"],
      },
    },
    {
      name: "reads the options before -- and none after it",
      words: ["--to", "one", "--", "--to", "-h", "--version"],
      read: {
        kept: ["--to", "one", "--", "--to", "-h", "--version"],
        operands: ["--to", "-h", "--version"],
      },
    },
    {
      name: "consumes a bare -- with nothing after it",
      words: ["t1", "--"],
      read: { kept: ["t1", "--"], operands: ["t1"] },
    },
    {
      name: "reads a second -- as a positional argument",
      words: ["--", "--", "-x"],
      read: { kept: ["--", "--", "-x"], operands: ["--", "-x"] },
    },
    {
      name: "never takes -- as a declared option's value: it ends the options",
      words: ["--to", "--", "-x"],
      read: {
        kept: ["--to", "--", "-x"],
        operands: ["-x"],
        valueMissing: "--to",
      },
    },
    {
      name: "keeps a declared valued option and its value",
      words: ["--to", "one", "--dry-run"],
      read: { kept: ["--to", "one", "--dry-run"] },
    },
    {
      name: "never takes an option as a declared option's value",
      words: ["--to", "--x", "--dry-run"],
      read: {
        kept: ["--to", "--dry-run"],
        undeclared: ["--x"],
        valueMissing: "--to",
      },
    },
    {
      name: "never takes a negative number as a declared option's value",
      words: ["t1", "--to", "-5"],
      read: {
        kept: ["t1", "--to"],
        operands: ["t1"],
        undeclared: ["-5"],
        valueMissing: "--to",
      },
    },
    {
      name: "says a declared valued option at the end has no value",
      words: ["t1", "--to"],
      read: { kept: ["t1", "--to"], operands: ["t1"], valueMissing: "--to" },
    },
    {
      name: "keeps a declared valued option written with =",
      words: ["--to=-5", "t1"],
      read: { kept: ["--to=-5", "t1"], operands: ["t1"] },
    },
    {
      name: "keeps the word after a declared switch, and reads it",
      words: ["--dry-run", "t1", "--x"],
      read: {
        kept: ["--dry-run", "t1"],
        operands: ["t1"],
        undeclared: ["--x"],
      },
    },
    {
      name: "notes help, in either form",
      words: ["t1", "-h"],
      read: { kept: ["t1"], operands: ["t1"], help: true },
    },
    {
      name: "notes the version, which only --version names",
      words: ["--version", "-V"],
      read: { undeclared: ["-V"], version: true },
    },
    {
      name: "keeps every other word",
      words: ["t1", "t2"],
      read: { kept: ["t1", "t2"], operands: ["t1", "t2"] },
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      expect(readWords(row.words, declared)).toEqual({ ...none, ...row.read });
    });
  }
});
