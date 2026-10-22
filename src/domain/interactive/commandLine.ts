// The one-line form of a command a person pastes into a shell:
// `cd <cwd> && [NAME=value …] <argv>`, every word POSIX single-quoted. Pure.

/** One word, POSIX single-quoted; an embedded `'` is written `'\''`. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CommandLineInput {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * `cd '<cwd>' && NAME='value' 'arg0' 'arg1' …`. Environment assignments keep
 * their name bare (a shell reads only a bare name as an assignment) and quote
 * their value; a name that is not a shell identifier is a programming error.
 */
export function renderCommandLine(input: CommandLineInput): string {
  const assignments = Object.entries(input.env).map(([name, value]) => {
    if (!ENV_NAME.test(name)) throw new Error(`Not a shell environment variable name: ${name}`);
    return `${name}=${shellQuote(value)}`;
  });
  const words = [...assignments, ...input.argv.map(shellQuote)];
  return `cd ${shellQuote(input.cwd)} && ${words.join(" ")}`;
}
