import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { upgradeConfigSchema } from "../../app/initProject.js";

export function runSchemaUpgrade(out: OutputPort): number {
  const result = upgradeConfigSchema(process.cwd());
  switch (result.kind) {
    case "no_config":
      out.error("No phax.json found. Run `phax init` first.");
      return 1;
    case "updated":
      out.log(`Updated ${result.schemaPath}`);
      out.log(`Updated ${result.userSchemaPath}`);
      return 0;
    case "current":
      out.log(`${result.schemaPath} is already up to date`);
      out.log(`${result.userSchemaPath} is already up to date`);
      return 0;
  }
}

export function registerSchemaCommand(program: Command, out: OutputPort): void {
  const schemaCmd = program.command("schema").description("Manage the local phax.schema.json");

  schemaCmd
    .command("upgrade")
    .description(
      "Regenerate phax.schema.json from the installed binary's config contract; never modifies phax.json",
    )
    .action(() => {
      const exitCode = runSchemaUpgrade(out);
      process.exit(exitCode);
    });
}
