/** A declared option as the reading step sees it: its kebab-case name, and whether it takes a value. */
export interface DeclaredOption {
  readonly option: string;
  readonly takesValue: boolean;
}

/** The words after a command's name, read once, before Commander sees any of them. */
export interface Words {
  /** The declared options, each valued one with its value, and the positional arguments, in
   *  order, with the `--` that ends the options when one is given: the words Commander parses. */
  readonly kept: ReadonlyArray<string>;
  /** The positional arguments, in order. */
  readonly operands: ReadonlyArray<string>;
  /** The options that name no declared field, each alone, in order: the word after a bare one is
   *  read as what it is, never as its value, so no option's arity is guessed. */
  readonly undeclared: ReadonlyArray<string>;
  /** The help option, `--help` or `-h`, is among the words. */
  readonly help: boolean;
  /** The version option, `--version`, is among the words. */
  readonly version: boolean;
  /** The first declared valued option given no value: the last word, or followed by an option
   *  or by `--`. */
  readonly valueMissing: string | undefined;
}

/** The help option, in its two forms (§5.31). */
export const HELP: ReadonlyArray<string> = ["--help", "-h"];

/** The version option, which only this form names (§5.32). */
export const VERSION = "--version";

/** The word that ends the options (POSIX guideline 10). */
export const END_OF_OPTIONS = "--";

/** Before `--`, every word that starts with `-` is an option (§4): `-5` and `-` with the others.
 *  Only a word that does not is a positional argument. */
export const isOption = (word: string): boolean => word.startsWith("-");

/** Reads the words after a command's name: each option declared, help, the version or
 *  undeclared, and every other word a positional argument. A declared valued option written
 *  without `=` takes the next word as its value only when that word is not an option; written
 *  with `=`, its value is what follows, even a word that starts with `-`. The first `--` ends the
 *  options, as POSIX guideline 10 and clap have it: it is kept for Commander, and every word after
 *  it, a dash-word or another `--`, is a positional argument. */
export function readWords(
  words: ReadonlyArray<string>,
  declared: ReadonlyArray<DeclaredOption>,
): Words {
  const kept: string[] = [];
  const operands: string[] = [];
  const undeclared: string[] = [];
  let help = false;
  let version = false;
  let valueMissing: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === END_OF_OPTIONS) {
      const after = words.slice(index + 1);
      kept.push(word, ...after);
      operands.push(...after);
      break;
    }
    if (!isOption(word)) {
      kept.push(word);
      operands.push(word);
      continue;
    }
    if (HELP.includes(word)) {
      help = true;
      continue;
    }
    if (word === VERSION) {
      version = true;
      continue;
    }
    const equals = word.indexOf("=");
    const name = equals === -1 ? word : word.slice(0, equals);
    const option = declared.find(
      (candidate) => name === `--${candidate.option}`,
    );
    if (option === undefined) {
      undeclared.push(word);
      continue;
    }
    kept.push(word);
    if (!option.takesValue || equals !== -1) continue;
    const next = words[index + 1];
    if (next === undefined || isOption(next)) {
      valueMissing ??= word;
      continue;
    }
    index += 1;
    kept.push(next);
  }
  return { kept, operands, undeclared, help, version, valueMissing };
}
