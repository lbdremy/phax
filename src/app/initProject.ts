import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getPhaxConfigJsonSchema, getPhaxUserOverlayJsonSchema } from "../schemas/phaxConfig.js";
import { locatePhaxConfig } from "./loadConfig.js";

export type InitResult =
  | { kind: "already_initialized"; configPath: string }
  | {
      kind: "created";
      configPath: string;
      schemaPath: string;
      userSchemaPath: string;
      schemaReference: string;
    };

export type UpgradeResult =
  | { kind: "no_config" }
  | { kind: "updated"; schemaPath: string; userSchemaPath: string }
  | { kind: "current"; schemaPath: string; userSchemaPath: string };

function writeSchemaFile(targetPath: string, getSchema: () => object): { changed: boolean } {
  const serialized = JSON.stringify(getSchema(), null, 2) + "\n";
  if (existsSync(targetPath) && readFileSync(targetPath, "utf8") === serialized) {
    return { changed: false };
  }
  writeFileSync(targetPath, serialized, "utf8");
  return { changed: true };
}

export function writeConfigSchemaFile(targetPath: string): { changed: boolean } {
  return writeSchemaFile(targetPath, getPhaxConfigJsonSchema);
}

export function serializePhaxConfigSchema(): string {
  return JSON.stringify(getPhaxConfigJsonSchema(), null, 2) + "\n";
}

export function serializePhaxUserOverlaySchema(): string {
  return JSON.stringify(getPhaxUserOverlayJsonSchema(), null, 2) + "\n";
}

export function upgradeConfigSchema(cwd: string): UpgradeResult {
  const configPath = locatePhaxConfig(cwd);
  if (!configPath) return { kind: "no_config" };
  const dir = dirname(configPath);
  const schemaPath = join(dir, "phax.schema.json");
  const userSchemaPath = join(dir, "phax.user.schema.json");
  const projectChanged = writeConfigSchemaFile(schemaPath).changed;
  const userChanged = writeSchemaFile(userSchemaPath, getPhaxUserOverlayJsonSchema).changed;
  return projectChanged || userChanged
    ? { kind: "updated", schemaPath, userSchemaPath }
    : { kind: "current", schemaPath, userSchemaPath };
}

export function initProject(input: { cwd: string; force?: boolean }): InitResult {
  const { cwd, force } = input;
  const configPath = join(cwd, "phax.json");
  const schemaPath = join(cwd, "phax.schema.json");
  const userSchemaPath = join(cwd, "phax.user.schema.json");
  const schemaReference = "./phax.schema.json";

  if (existsSync(configPath) && !force) {
    return { kind: "already_initialized", configPath };
  }

  const name = basename(cwd) || "project";
  const config = {
    $schema: schemaReference,
    version: 1,
    name,
    gateProfiles: {
      fast: ["echo 'replace with your gate commands in phax.json'"],
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  writeConfigSchemaFile(schemaPath);
  writeSchemaFile(userSchemaPath, getPhaxUserOverlayJsonSchema);

  return { kind: "created", configPath, schemaPath, userSchemaPath, schemaReference };
}
