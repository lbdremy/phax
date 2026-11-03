// How a command's input reads (the names, helps, defaults and choices of its positionals and
// options) is the contract library's: the catalogue, the usage spec and Commander's help all
// read it from there, and so can never differ.
export {
  argShapes,
  flagShapes,
  kebabCase,
  type ArgShape,
  type FlagShape,
} from "@steme-lab/cli-command";
