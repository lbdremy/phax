import type { Command } from "commander";
import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import { vibeSetup, VIBE_CONFIG_PATH } from "../../app/vibeSetup.js";
import { providerSetup } from "../../app/providerSetup.js";
import { probeProviders } from "../../app/providerProbe.js";
import type { ThinkingLevel } from "../../domain/routing/types.js";
import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";

const THINKING_LEVELS: readonly string[] = [
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
];

async function loadConfigs(
  out: OutputPort,
): Promise<{ routing: ModelRouting; providerConfig: ProviderConfig } | null> {
  const result = await Effect.runPromise(
    Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  if (Either.isLeft(result)) {
    out.error(`Failed to load routing config: ${result.left.message}`);
    return null;
  }
  return result.right;
}

export async function runAgentModels(out: OutputPort): Promise<number> {
  const configs = await loadConfigs(out);
  if (configs === null) return 2;
  const { routing, providerConfig } = configs;

  out.log(`Provider priority: ${routing.providerPriority.join(" → ")}`);
  out.log("");
  out.log("Tiers:");

  const tiers = routing.tiers as Record<
    string,
    Record<string, { family: string; effort?: string; thinking?: string; relationship?: string }>
  >;

  for (const tier of Object.keys(tiers)) {
    const providers = tiers[tier];
    out.log(`  ${tier}:`);
    for (const [provider, entry] of Object.entries(providers ?? {})) {
      const parts: string[] = [`family=${entry.family}`];
      if (entry.effort !== undefined) parts.push(`effort=${entry.effort}`);
      if (entry.thinking !== undefined) parts.push(`thinking=${entry.thinking}`);
      if (entry.relationship !== undefined) parts.push(`relationship=${entry.relationship}`);
      const enabledFlag = providerConfig.providers[
        provider as keyof typeof providerConfig.providers
      ]?.enabled
        ? ""
        : " (disabled)";
      out.log(`    ${provider}: ${parts.join(", ")}${enabledFlag}`);
    }
  }

  return 0;
}

export interface AgentResolveOptions {
  readonly model: string;
  readonly effort: string;
  readonly json?: boolean;
}

export async function runAgentResolve(opts: AgentResolveOptions, out: OutputPort): Promise<number> {
  if (!THINKING_LEVELS.includes(opts.effort)) {
    out.error(
      `Invalid effort level "${opts.effort}". Must be one of: ${THINKING_LEVELS.join(", ")}`,
    );
    return 2;
  }

  const configs = await loadConfigs(out);
  if (configs === null) return 2;
  const { routing, providerConfig } = configs;

  const resolution = resolveModel(
    { model: opts.model, effort: opts.effort as ThinkingLevel },
    routing,
    providerConfig,
  );

  if (opts.json) {
    out.log(JSON.stringify(resolution, null, 2));
    return 0;
  }

  out.log(
    `Requested:        ${resolution.requested.model} (${resolution.requested.family}) @ ${resolution.requested.effort}`,
  );
  out.log(`Normalized tier:  ${resolution.normalizedTier}`);
  out.log(`Selected provider: ${resolution.selected.provider}`);
  out.log(`Selected family:  ${resolution.selected.family}`);
  if (resolution.selected.thinking !== undefined) {
    out.log(`Selected thinking: ${resolution.selected.thinking}`);
  }
  out.log(`Concrete model:   ${resolution.selected.concreteModel}`);
  out.log(`Relationship:     ${resolution.relationship}`);
  out.log(`Reason:           ${resolution.reason}`);

  return 0;
}

export async function runAgentProbe(out: OutputPort): Promise<number> {
  const configs = await loadConfigs(out);
  if (configs === null) return 2;
  const { providerConfig } = configs;

  const probeResults = await Effect.runPromise(
    probeProviders(providerConfig).pipe(Effect.provide(NodeShellLayer)),
  );

  for (const { provider, available } of probeResults) {
    const status = available ? "available" : "unavailable";
    const enabledFlag = providerConfig.providers[provider as keyof typeof providerConfig.providers]
      ?.enabled
      ? ""
      : " (disabled in config)";
    out.log(`  ${provider}: ${status}${enabledFlag}`);
  }

  return 0;
}

export interface AgentSetupMistralVibeOptions {
  readonly dryRun?: boolean;
  readonly installModelAliases?: boolean;
}

export async function runAgentSetupMistralVibe(
  opts: AgentSetupMistralVibeOptions,
  out: OutputPort,
): Promise<number> {
  const setupOpts = {
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
    ...(opts.installModelAliases !== undefined ? { install: opts.installModelAliases } : {}),
  };
  const effect = vibeSetup(setupOpts);
  const result = await Effect.runPromise(
    Effect.either(effect).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  if (Either.isLeft(result)) {
    out.error(`Setup failed: ${result.left.message}`);
    return 2;
  }

  const { aliasesAdded, aliasesSkipped, backupPath } = result.right;

  if (opts.dryRun) {
    out.log("Dry run — no changes written.");
    if (aliasesAdded.length > 0) {
      out.log(`Would append ${aliasesAdded.length} alias(es) to ${VIBE_CONFIG_PATH}:`);
      for (const alias of aliasesAdded) {
        out.log(`  + ${alias}`);
      }
    } else {
      out.log("All aliases already present — nothing to append.");
    }
    if (aliasesSkipped.length > 0) {
      out.log(`Already present (${aliasesSkipped.length}): ${aliasesSkipped.join(", ")}`);
    }
    return 0;
  }

  if (!opts.installModelAliases) {
    out.log("Dry run — no changes written (pass --install-model-aliases to apply).");
    if (aliasesAdded.length > 0) {
      out.log(`Would append ${aliasesAdded.length} alias(es) to ${VIBE_CONFIG_PATH}:`);
      for (const alias of aliasesAdded) {
        out.log(`  + ${alias}`);
      }
    } else {
      out.log("All aliases already present — nothing to append.");
    }
    return 0;
  }

  if (aliasesAdded.length === 0) {
    out.log("All aliases already present — nothing to append.");
    return 0;
  }

  out.log(`Appended ${aliasesAdded.length} alias(es) to ${VIBE_CONFIG_PATH}:`);
  for (const alias of aliasesAdded) {
    out.log(`  + ${alias}`);
  }
  if (backupPath !== undefined) {
    out.log(`Backup written to: ${backupPath}`);
  }
  return 0;
}

export interface AgentSetupProvidersOptions {
  readonly write?: boolean;
  readonly prune?: boolean;
  readonly withRouting?: boolean;
}

export async function runAgentSetupProviders(
  opts: AgentSetupProvidersOptions,
  out: OutputPort,
): Promise<number> {
  const write = opts.write ?? false;
  const prune = opts.prune ?? false;
  const withRouting = opts.withRouting ?? false;

  const effect = providerSetup({ write, prune, withRouting });
  const result = await Effect.runPromise(
    Effect.either(effect).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, NodeShellLayer))),
  );

  if (Either.isLeft(result)) {
    out.error(`Setup failed: ${result.left.message}`);
    return 2;
  }

  const { plan, written, backupPath, routingScaffolded, providerConfigPath, modelRoutingPath } =
    result.right;

  if (!write) {
    out.log("Dry run — no changes written.");
    if (plan.enabled.length > 0) {
      out.log(`Would enable (${plan.enabled.length}):`);
      for (const p of plan.enabled) out.log(`  + ${p}`);
    }
    if (plan.disabled.length > 0) {
      out.log(`Would disable (${plan.disabled.length}):`);
      for (const p of plan.disabled) out.log(`  - ${p}`);
    }
    if (plan.enabled.length === 0 && plan.disabled.length === 0) {
      out.log("All providers already up-to-date.");
    }
    if (plan.unchanged.length > 0) {
      out.log(`Unchanged (${plan.unchanged.length}): ${plan.unchanged.join(", ")}`);
    }
    return 0;
  }

  if (plan.enabled.length === 0 && plan.disabled.length === 0) {
    out.log("All providers already up-to-date.");
  } else {
    if (plan.enabled.length > 0) {
      out.log(`Enabled (${plan.enabled.length}):`);
      for (const p of plan.enabled) out.log(`  + ${p}`);
    }
    if (plan.disabled.length > 0) {
      out.log(`Disabled (${plan.disabled.length}):`);
      for (const p of plan.disabled) out.log(`  - ${p}`);
    }
  }
  out.log(`Config written to: ${providerConfigPath}`);
  if (backupPath !== undefined) {
    out.log(`Backup written to: ${backupPath}`);
  }
  if (written && withRouting) {
    if (routingScaffolded) {
      out.log(`Routing config scaffolded: ${modelRoutingPath}`);
    } else {
      out.log(`Routing config already exists, skipped: ${modelRoutingPath}`);
    }
  }
  return 0;
}

export function registerAgentCommand(program: Command, out: OutputPort): void {
  const agentCmd = program
    .command("agent")
    .description("Inspect and manage model routing and provider configuration");

  agentCmd
    .command("models")
    .description("Print the routing table and provider priority")
    .action(async () => {
      const exitCode = await runAgentModels(out);
      process.exit(exitCode);
    });

  agentCmd
    .command("resolve")
    .description("Show how a model+effort request resolves to a provider and concrete model")
    .requiredOption("--model <id>", "Requested model id (e.g. claude-sonnet-5)")
    .requiredOption(
      "--effort <level>",
      "Effort/thinking level (none|off|low|medium|high|xhigh|max|ultracode)",
    )
    .option("--json", "Output the resolution as JSON")
    .action(async (opts: { model: string; effort: string; json?: boolean }) => {
      const exitCode = await runAgentResolve(opts, out);
      process.exit(exitCode);
    });

  agentCmd
    .command("probe")
    .description(
      "Check which provider executables are available on PATH; never throws on an unavailable provider",
    )
    .action(async () => {
      const exitCode = await runAgentProbe(out);
      process.exit(exitCode);
    });

  const setupCmd = agentCmd.command("setup").description("Set up provider integrations");

  setupCmd
    .command("mistral-vibe")
    .description(
      "Append PHAX-owned Mistral Vibe model aliases to ~/.vibe/config.toml (append-only, atomic)",
    )
    .option("--dry-run", "Preview what would be appended without writing anything")
    .option("--install-model-aliases", "Actually append the missing aliases and write the backup")
    .action(async (opts: { dryRun?: boolean; installModelAliases?: boolean }) => {
      const exitCode = await runAgentSetupMistralVibe(opts, out);
      process.exit(exitCode);
    });

  setupCmd
    .command("providers")
    .description(
      "Reconcile ~/.phax/providers.json enabled flags from live executable probes (dry-run by default)",
    )
    .option("--write", "Persist the reconciled config (writes a timestamped backup first)")
    .option("--prune", "Also disable providers whose executable is unavailable")
    .option(
      "--with-routing",
      "Scaffold ~/.phax/model-routing.json from defaults when absent (never overwrites)",
    )
    .action(async (opts: { write?: boolean; prune?: boolean; withRouting?: boolean }) => {
      const exitCode = await runAgentSetupProviders(opts, out);
      process.exit(exitCode);
    });
}
