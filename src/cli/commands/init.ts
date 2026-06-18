import type { OutputPort } from "../../ports/output.js";
import { initProject } from "../../app/initProject.js";

export function runInit(opts: { force?: boolean }, out: OutputPort): number {
  const input: { cwd: string; force?: boolean } = { cwd: process.cwd() };
  if (opts.force) input.force = opts.force;
  const result = initProject(input);

  if (result.kind === "already_initialized") {
    out.error(`PHAX is already initialized: ${result.configPath}`);
    out.error("Use --force to overwrite the existing phax.json.");
    return 1;
  }

  out.log(`Created PHAX config: ${result.configPath}`);
  out.log(`Created JSON Schema: ${result.schemaPath}`);
  out.log(`Schema: local generated schema (${result.schemaReference})`);
  out.log("Next: set your gate commands in phax.json, then run `phax validate` or `phax run`.");
  return 0;
}
