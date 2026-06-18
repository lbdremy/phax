import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getPhaxConfigJsonSchema } from "../schemas/phaxConfig.js";
import { locatePhaxConfig } from "./loadConfig.js";

export type InitResult =
  | { kind: "already_initialized"; configPath: string }
  | { kind: "created"; configPath: string; schemaPath: string; schemaReference: string };

export type UpgradeResult =
  | { kind: "no_config" }
  | { kind: "updated"; schemaPath: string }
  | { kind: "current"; schemaPath: string };

export function writeConfigSchemaFile(targetPath: string): { changed: boolean } {
  const serialized = JSON.stringify(getPhaxConfigJsonSchema(), null, 2) + "\n";
  if (existsSync(targetPath) && readFileSync(targetPath, "utf8") === serialized) {
    return { changed: false };
  }
  writeFileSync(targetPath, serialized, "utf8");
  return { changed: true };
}

export function upgradeConfigSchema(cwd: string): UpgradeResult {
  const configPath = locatePhaxConfig(cwd);
  if (!configPath) return { kind: "no_config" };
  const schemaPath = join(dirname(configPath), "phax.schema.json");
  const { changed } = writeConfigSchemaFile(schemaPath);
  return changed ? { kind: "updated", schemaPath } : { kind: "current", schemaPath };
}

export function initProject(input: { cwd: string; force?: boolean }): InitResult {
  const { cwd, force } = input;
  const configPath = join(cwd, "phax.json");
  const schemaPath = join(cwd, "phax.schema.json");
  const schemaReference = "./phax.schema.json";

  if (existsSync(configPath) && !force) {
    return { kind: "already_initialized", configPath };
  }

  const name = basename(cwd) || "project";
  const config = {
    $schema: schemaReference,
    version: 1,
    project: { name, type: "single-package" },
    state: { root: "~/.phax" },
    gateProfiles: {
      fast: ["echo 'replace with your gate commands in phax.json'"],
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  writeConfigSchemaFile(schemaPath);

  return { kind: "created", configPath, schemaPath, schemaReference };
}
