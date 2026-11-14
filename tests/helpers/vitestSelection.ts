// The test files a `[NAME=value…] pnpm <script> <args…>` command runs, as vitest selects them:
// the package script's words, then the command's own; `--project` keeps that project of
// vitest.config.ts; and every other bare word is a file filter. Vitest ORs its file filters, so a filter in the script
// (`vitest run tests/unit`) widens whatever filter the command adds.
import { readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import config from "../../vitest.config.js";

// The flags these commands pass that take a value.
const VALUE_FLAGS = new Set(["--project", "-t", "--testNamePattern", "--reporter", "--outputFile"]);

interface Project {
  readonly test?: { readonly name?: string; readonly include?: ReadonlyArray<string> };
}

// A command line's words as a POSIX shell splits them: blanks separate words, single quotes and a
// backslash keep what they quote, and leading `NAME=value` assignments are the command's
// environment, not its words.
const shellWords = (command: string): ReadonlyArray<string> => {
  const words: Array<string> = [];
  let word: string | undefined;
  for (const token of command.matchAll(/'([^']*)'|\\(.)|(\s+)|(.)/g)) {
    const [, quoted, escaped, blank, plain] = token;
    if (blank !== undefined) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? "") + (quoted ?? escaped ?? plain ?? "");
    }
  }
  if (word !== undefined) words.push(word);
  return words.slice(words.findIndex((each) => !/^[A-Z_][A-Z0-9_]*=/.test(each)));
};

export const vitestSelection = (command: string, root: string): ReadonlyArray<string> => {
  const [runner, script = "", ...args] = shellWords(command);
  if (runner !== "pnpm") throw new Error(`not a pnpm command: ${command}`);
  const scripts = (
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    }
  ).scripts;
  const words = [...(scripts[script] ?? script).split(/\s+/), ...args];
  if (words[0] !== "vitest" || words[1] !== "run") {
    throw new Error(`not a vitest run: ${words.join(" ")}`);
  }

  const projectNames: Array<string> = [];
  const filters: Array<string> = [];
  for (let i = 2; i < words.length; i += 1) {
    const word = words[i]!;
    if (VALUE_FLAGS.has(word)) {
      if (word === "--project") projectNames.push(words[i + 1]!);
      i += 1;
    } else if (!word.startsWith("-")) {
      filters.push(word);
    }
  }

  const projects = ((config.test?.projects ?? []) as ReadonlyArray<Project>).filter(
    (project) => projectNames.length === 0 || projectNames.includes(project.test?.name ?? ""),
  );
  const include = projects.flatMap((project) => project.test?.include ?? []);
  return (readdirSync(join(root, "tests"), { recursive: true }) as Array<string>)
    .map((file) => `tests/${file.replaceAll("\\", "/")}`)
    .filter((file) => include.some((glob) => matchesGlob(file, glob)))
    .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
    .toSorted();
};
