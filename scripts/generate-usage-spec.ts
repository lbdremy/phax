// Generates phax.usage.kdl from the live Commander program tree.
// Commander is the source of truth; the KDL is a derived shareable contract.
// Run with: pnpm gen:usage-spec
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { Command, Option, Argument } from "commander";
import { buildProgram } from "../src/cli/program.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  name: string;
  version: string;
  license?: string;
};

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Extract the value placeholder from a flag definition string.
// "--config <path>" → "<path>", "--profile [profile]" → "[profile]", "--verbose" → null
function flagArgPlaceholder(option: Option): string | null {
  const m = /([<[][^>\]]+[>\]])/.exec(option.flags);
  return m ? m[1] : null;
}

function isAutoAdded(option: Option): boolean {
  return option.long === "--help" || option.long === "--version";
}

function emitFlag(option: Option, indent: string, isGlobal: boolean): string {
  const longFlag = option.long ?? "";
  const flagName = option.short ? `"${longFlag} ${option.short}"` : `"${longFlag}"`;

  const body: string[] = [];
  if (isGlobal) body.push(`${indent}    global #true`);

  const placeholder = flagArgPlaceholder(option);
  if (placeholder) body.push(`${indent}    arg "${placeholder}"`);
  if (option.mandatory) body.push(`${indent}    required #true`);
  if (option.defaultValue !== undefined) {
    const dv = option.defaultValue;
    const dvStr = typeof dv === "string" ? `"${esc(dv)}"` : String(dv);
    body.push(`${indent}    default ${dvStr}`);
  }
  if (option.description) body.push(`${indent}    help "${esc(option.description)}"`);

  if (body.length === 0) return `${indent}flag ${flagName}`;
  return [`${indent}flag ${flagName} {`, ...body, `${indent}}`].join("\n");
}

function emitArg(arg: Argument, indent: string): string {
  const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
  return `${indent}arg "${name}"`;
}

function emitCommand(cmd: Command, indent: string): string[] {
  const lines: string[] = [`${indent}cmd "${cmd.name()}" {`];
  const inner = `${indent}    `;

  const desc = cmd.description();
  if (desc) lines.push(`${inner}help "${esc(desc)}"`);

  for (const arg of cmd.registeredArguments) {
    lines.push(emitArg(arg, inner));
  }

  for (const opt of cmd.options) {
    if (isAutoAdded(opt)) continue;
    lines.push(emitFlag(opt, inner, false));
  }

  for (const sub of cmd.commands) {
    lines.push("");
    lines.push(...emitCommand(sub, inner));
  }

  lines.push(`${indent}}`);
  return lines;
}

export function generateUsageSpec(): string {
  const program = buildProgram();

  const lines: string[] = [
    `// Generated from the Commander.js program tree — do not edit by hand.`,
    `// Regenerate with: pnpm gen:usage-spec`,
    `//`,
    `// Commander (src/cli/) is the source of truth for commands, flags, and`,
    `// arguments. phax.usage.kdl is a derived shareable CLI contract.`,
    ``,
    `name "${esc(pkg.name)}"`,
    `bin "${esc(pkg.name)}"`,
    `version "${esc(pkg.version)}"`,
  ];
  if (pkg.license) lines.push(`license "${esc(pkg.license)}"`);
  lines.push(`min_usage_version "1.0.0"`);
  lines.push(``);

  // Root-level options become global flags in the spec.
  for (const opt of program.options) {
    if (isAutoAdded(opt)) continue;
    lines.push(emitFlag(opt, "", true));
  }
  lines.push(``);

  // All top-level commands.
  for (const cmd of program.commands) {
    lines.push(...emitCommand(cmd, ""));
    lines.push(``);
  }

  return lines.join("\n");
}

const output = generateUsageSpec();
const outPath = join(repoRoot, "phax.usage.kdl");
writeFileSync(outPath, output, "utf8");
console.log(`Written: ${outPath}`);
