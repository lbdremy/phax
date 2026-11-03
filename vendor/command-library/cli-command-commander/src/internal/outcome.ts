import { Cause, Formatter, Result } from "effect";
import type { Command, ExitCode, Program } from "@steme-lab/cli-command";

/** What the runner writes to `err` and the code it ends with. */
export interface Outcome {
  readonly text: string;
  readonly code: ExitCode;
  /** The declared error that ended the run: its tag and its own fields. Absent for a defect. */
  readonly declared?: {
    readonly tag: string;
    readonly fields: Readonly<Record<string, unknown>>;
  };
}

const line = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;

function tagOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const tag: unknown = Reflect.get(error, "_tag");
  return typeof tag === "string" ? tag : undefined;
}

/** The error's own enumerable fields, without its tag. */
function fieldsOf(error: object): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(error).filter(([key]) => key !== "_tag"),
  );
}

/** A defect's description, for `err`. */
export function defectText(why: string): string {
  return line(`defect: ${why}`);
}

/** The outcome of a failed `run`: a declared error answers its code, anything else the defect code. */
export function outcomeOf(
  program: Program<unknown>,
  command: Command<unknown>,
  cause: Cause.Cause<unknown>,
): Outcome {
  const found = Cause.findError(cause);
  if (Result.isSuccess(found)) {
    const error = found.success;
    const tag = tagOf(error);
    const exits: Readonly<Record<string, ExitCode>> = command.exits;
    if (
      tag !== undefined &&
      typeof error === "object" &&
      error !== null &&
      Object.hasOwn(exits, tag)
    ) {
      const fields = fieldsOf(error);
      return {
        // Formatter never throws: a bigint or a circular field is rendered, and the code stands.
        text: line(`${tag} ${Formatter.format(fields)}`),
        code: exits[tag] ?? program.exits.defect,
        declared: { tag, fields },
      };
    }
  }
  return {
    text: defectText(Cause.pretty(cause)),
    code: program.exits.defect,
  };
}
