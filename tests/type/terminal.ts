import type { Context, Effect } from "effect";
import type { FakeTerminalImpl } from "../../src/infra/fakes/terminal.js";
import type { StdinReadError, Terminal, TerminalOps } from "../../src/ports/terminal.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// FakeTerminalImpl must be assignable to TerminalOps
declare const fake: FakeTerminalImpl;
const assignableToOps: TerminalOps = fake;
void assignableToOps;

// stdinIsTerminal is an Effect<boolean> that never fails and needs nothing
declare const terminalOps: TerminalOps;
const stdinIsTerminal: Equals<
  typeof terminalOps.stdinIsTerminal,
  Effect.Effect<boolean, never, never>
> = true;
void stdinIsTerminal;

// readStdin is an Effect<string, StdinReadError> that needs nothing
const readStdin: Equals<
  typeof terminalOps.readStdin,
  Effect.Effect<string, StdinReadError, never>
> = true;
void readStdin;

// The Terminal tag provides exactly TerminalOps
const tagService: Equals<Context.Tag.Service<typeof Terminal>, TerminalOps> = true;
void tagService;
