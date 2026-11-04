// The command library's contract (`@steme-lab/cli-command` 0.x), ported to Effect 3: what a
// command is, what a program is, what a runner does with them. Types, functions that return what
// they are given, for the inference, and the two policies a source declares; no runner — the
// runner is src/cli/commandLibrary/commander/, proved by the conformance suite under
// ./conformance/ to apply what each source declares. The names are the library's, so that
// swapping in the published package is an import change; the gains the port carries for
// upstream are the names after the library's (`AliasAnnotationId`, `Completer`,
// `CompleterAnnotationId`, `ProgramUsage`, `Refused`, `RunContext`, `StdinDocument`).
export type {
  Command,
  CommandDef,
  Document,
  ErrorText,
  ExitCode,
  Group,
  Grouping,
  Inputs,
  Io,
  Parsed,
  Program,
  ProgramExits,
  ProgramUsage,
  RunContext,
  Runner,
  Source,
  StdinDocument,
  Tagged,
  Terminal,
  Undeclared,
} from "./command.js";
export type { Binding } from "./define.js";
export {
  defineCommand,
  defineGroup,
  defineProgram,
  document,
  DocumentOutput,
  Refused,
  reject,
  strip,
} from "./define.js";
export { Written, written } from "./written.js";
export type { Catalogue, CommandContract, ErrorContract, StdinContract } from "./catalogue.js";
export { catalogue, commandContract } from "./catalogue.js";
export type { ArgShape, Completer, FlagShape } from "./shapes.js";
export {
  AliasAnnotationId,
  argShapes,
  CompleterAnnotationId,
  flagShapes,
  fullName,
  kebabCase,
  stdinFlagHelp,
} from "./shapes.js";
export { OPTION_HELP, usageSpec } from "./usage.js";
export type { JsonSchema, RefusalSource } from "./messages.js";
export { encodedText, messages } from "./messages.js";
