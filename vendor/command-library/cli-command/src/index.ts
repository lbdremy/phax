// @steme-lab/cli-command 0.x, the contract (decision 34): what a command is, what a program is,
// what a runner does with them. Types, functions that return what they are given, for the
// inference, and the two policies a source declares; no runner — a runner is its own library,
// `@steme-lab/cli-command-commander` first, proved by the conformance suite this package ships
// (`@steme-lab/cli-command/conformance`) to apply what each source declares.
export type {
  Command,
  CommandDef,
  Document,
  ExitCode,
  Group,
  Grouping,
  Inputs,
  Io,
  Parsed,
  Program,
  ProgramExits,
  Runner,
  Source,
  Tagged,
  Terminal,
  Undeclared,
} from "./contracts/command.ts";
export type { Binding } from "./internal/define.ts";
export {
  defineCommand,
  defineGroup,
  defineProgram,
  document,
  DocumentOutput,
  reject,
  strip,
} from "./internal/define.ts";
export { Written, written } from "./internal/written.ts";
export type {
  Catalogue,
  CommandContract,
  ErrorContract,
  StdinContract,
} from "./internal/catalogue.ts";
export { catalogue, commandContract } from "./internal/catalogue.ts";
export type { ArgShape, FlagShape } from "./internal/shapes.ts";
export {
  argShapes,
  flagShapes,
  fullName,
  kebabCase,
} from "./internal/shapes.ts";
export { OPTION_HELP, usageSpec } from "./internal/usage.ts";
export type { JsonSchema, RefusalSource } from "./internal/messages.ts";
export { encodedText, messages } from "./internal/messages.ts";
