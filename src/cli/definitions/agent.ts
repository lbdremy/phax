// The `agent` group as the runner reads it: `models`, `resolve`, `probe` and the nested `setup`
// group (`mistral-vibe`, `providers`). Each answers one object under `--json` and prints today's
// text without it. `agent resolve` answers the routing resolution, its schema written so that
// encoding it gives exactly `JSON.stringify(resolution, null, 2)`; the setup commands answer what
// the use case did and the files it wrote (providers.json, ~/.vibe/config.toml, their backups and
// a scaffolded model-routing.json), each with an absolute path since they live outside any
// repository. A configuration that does not load, an effort outside the thinking levels and a
// failed setup exit 2 with today's sentences.
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { probeProviders } from "../../app/providerProbe.js";
import { providerSetup } from "../../app/providerSetup.js";
import { vibeSetup, VIBE_CONFIG_PATH } from "../../app/vibeSetup.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import type { ThinkingLevel } from "../../domain/routing/types.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { FileSystem } from "../../ports/fs.js";
import type { Shell } from "../../ports/shell.js";
import {
  ModelFamilySchema,
  ProviderIdSchema,
  RelationshipSchema,
  ThinkingLevelSchema,
} from "../../schemas/modelRouting.js";
import {
  defineCommand,
  defineGroup,
  reject,
  Written,
  written,
} from "../commandLibrary/contract/index.js";
import { exposeMessage, MessageFields } from "./shared.js";

/** The layers a test swaps: the program instance gets the real ones. */
export interface AgentLayers {
  readonly shell: Layer.Layer<Shell>;
  readonly fileSystem: Layer.Layer<FileSystem>;
}

/** The real adapters, which the program instance and the kept run functions use. */
export const REAL_AGENT_LAYERS: AgentLayers = {
  shell: NodeShellLayer,
  fileSystem: NodeFileSystemLayer,
};

/** The efforts `agent resolve` accepts, in the order its sentence lists them. */
const THINKING_LEVELS: readonly string[] = [
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
];

/** The routing configuration (model-routing.json or providers.json) did not load. */
class RoutingConfigError extends Data.TaggedError("RoutingConfigError")<{
  readonly message: string;
}> {}

/** `--effort` is none of the thinking levels. */
class InvalidEffortError extends Data.TaggedError("InvalidEffortError")<{
  readonly message: string;
}> {}

/** A setup use case failed. */
class AgentSetupError extends Data.TaggedError("AgentSetupError")<{
  readonly message: string;
}> {}

const configErrors = { RoutingConfigError: 2 } as const;
const configFields = { RoutingConfigError: MessageFields } as const;
const configTexts = { RoutingConfigError: (error: { readonly message: string }) => error.message };

/** Both routing configurations, or the error that refused them. */
function loadConfigs(layers: AgentLayers) {
  return Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }).pipe(
    Effect.provide(layers.fileSystem),
    Effect.mapError(
      (error) =>
        new RoutingConfigError({ message: `Failed to load routing config: ${error.message}` }),
    ),
    Effect.mapError(exposeMessage),
  );
}

/** The records of the absolute paths that exist now, each read back from the disk. */
function writtenAbsolute(
  paths: ReadonlyArray<string>,
  layers: AgentLayers,
): Effect.Effect<ReadonlyArray<Written>> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const records: Written[] = [];
    for (const path of paths) {
      if (!(yield* fs.exists(path))) continue;
      records.push(yield* written(path, yield* fs.readBytes(path)));
    }
    return records;
  }).pipe(Effect.provide(layers.fileSystem), Effect.orDie);
}

// ── agent models ────────────────────────────────────────────────────────────────

const AgentModelsOutput = Schema.Struct({
  providerPriority: Schema.Array(ProviderIdSchema),
  allowDowngrade: Schema.Boolean,
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      enabled: Schema.Boolean,
      families: Schema.Array(
        Schema.Struct({
          family: Schema.String,
          models: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              status: Schema.Literals(["active", "deprecated"]),
              efforts: Schema.Array(ThinkingLevelSchema),
            }),
          ),
        }),
      ),
    }),
  ),
  equivalence: Schema.Array(
    Schema.Struct({
      spoke: Schema.String,
      efforts: Schema.Array(
        Schema.Struct({
          effort: Schema.String,
          claude: Schema.String,
          claudeEffort: ThinkingLevelSchema,
          relation: RelationshipSchema,
        }),
      ),
    }),
  ),
});

function makeAgentModelsCommand(layers: AgentLayers) {
  return defineCommand({
    name: "models",
    summary: "Print the routing table and provider priority",
    input: {},
    output: reject(AgentModelsOutput),
    run: () =>
      Effect.gen(function* () {
        const { routing, providerConfig } = yield* loadConfigs(layers);
        return {
          providerPriority: [...routing.providerPriority],
          allowDowngrade: routing.allowDowngrade,
          providers: Object.entries(providerConfig.providers).map(([provider, entry]) => ({
            provider,
            enabled: entry.enabled,
            families: Object.entries(entry.families ?? {}).map(([family, familyEntry]) => ({
              family,
              models: familyEntry.models.map((model) => ({
                id: model.id,
                status: model.status,
                efforts: [...model.efforts],
              })),
            })),
          })),
          equivalence: Object.entries(routing.equivalence).map(([spoke, byEffort]) => ({
            spoke,
            efforts: Object.entries(byEffort).map(([effort, edge]) => ({
              effort,
              claude: edge.claude,
              claudeEffort: edge.effort,
              relation: edge.relation,
            })),
          })),
        };
      }),
    exits: configErrors,
    errors: configFields,
    texts: configTexts,
    render: (value) => {
      const lines = [
        `Provider priority: ${value.providerPriority.join(" → ")}`,
        `Allow downgrade: ${value.allowDowngrade}`,
        "",
        "Catalog:",
      ];
      for (const provider of value.providers) {
        lines.push(`  ${provider.provider}${provider.enabled ? "" : " (disabled)"}:`);
        for (const family of provider.families) {
          lines.push(`    ${family.family}:`);
          for (const model of family.models) {
            const statusFlag = model.status === "deprecated" ? " (deprecated)" : "";
            lines.push(`      ${model.id}${statusFlag}  efforts: ${model.efforts.join(", ")}`);
          }
        }
      }
      if (value.equivalence.length > 0) {
        lines.push("", "Equivalence (spoke → Claude hub):");
        for (const spoke of value.equivalence) {
          lines.push(`  ${spoke.spoke}:`);
          for (const edge of spoke.efforts) {
            lines.push(
              `    ${edge.effort} → ${edge.claude}/${edge.claudeEffort} (${edge.relation})`,
            );
          }
        }
      }
      return lines.join("\n");
    },
  });
}

// ── agent resolve ───────────────────────────────────────────────────────────────

/** The resolution as `JSON.stringify(resolution, null, 2)` writes it: keys in the resolver's
 *  order, `thinking` and `skippedForSecurity` absent when the resolution has none. */
const AgentResolveOutput = Schema.Struct({
  requested: Schema.Struct({
    model: Schema.String,
    family: ModelFamilySchema,
    effort: ThinkingLevelSchema,
  }),
  selected: Schema.Struct({
    provider: ProviderIdSchema,
    family: ModelFamilySchema,
    thinking: Schema.optionalKey(ThinkingLevelSchema),
    concreteModel: Schema.String,
  }),
  relationship: RelationshipSchema,
  reason: Schema.String,
  skippedForSecurity: Schema.optionalKey(
    Schema.Array(Schema.Struct({ provider: ProviderIdSchema, reason: Schema.String })),
  ),
});

export function makeAgentResolveCommand(layers: AgentLayers) {
  return defineCommand({
    name: "resolve",
    summary: "Show how a model+effort request resolves to a provider and concrete model",
    input: {
      flags: reject(
        Schema.Struct({
          model: Schema.String.annotate({
            identifier: "id",
            description: "Requested model id (e.g. claude-sonnet-4-6)",
          }),
          effort: Schema.String.annotate({
            identifier: "level",
            description:
              "Effort/thinking level (none|off|low|medium|high|xhigh|max|ultracode|ultra)",
          }),
        }),
      ),
    },
    output: reject(AgentResolveOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const { model, effort } = input.flags;
        if (!THINKING_LEVELS.includes(effort)) {
          return yield* Effect.fail(
            new InvalidEffortError({
              message: `Invalid effort level "${effort}". Must be one of: ${THINKING_LEVELS.join(", ")}`,
            }),
          );
        }
        const { routing, providerConfig } = yield* loadConfigs(layers);
        return resolveModel({ model, effort: effort as ThinkingLevel }, routing, providerConfig);
      }).pipe(Effect.mapError(exposeMessage)),
    exits: { ...configErrors, InvalidEffortError: 2 },
    errors: { ...configFields, InvalidEffortError: MessageFields },
    texts: { ...configTexts, InvalidEffortError: (error) => error.message },
    render: (value) => {
      const lines = [
        `Requested:        ${value.requested.model} (${value.requested.family}) @ ${value.requested.effort}`,
        `Selected provider: ${value.selected.provider}`,
        `Selected family:  ${value.selected.family}`,
      ];
      if (value.selected.thinking !== undefined) {
        lines.push(`Selected thinking: ${value.selected.thinking}`);
      }
      lines.push(
        `Concrete model:   ${value.selected.concreteModel}`,
        `Relationship:     ${value.relationship}`,
        `Reason:           ${value.reason}`,
      );
      return lines.join("\n");
    },
  });
}

// ── agent probe ─────────────────────────────────────────────────────────────────

const AgentProbeOutput = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      available: Schema.Boolean,
      enabled: Schema.Boolean,
    }),
  ),
});

/** `agent probe` over the shell that runs each provider's `--version`. */
function makeAgentProbeCommand(layers: AgentLayers) {
  return defineCommand({
    name: "probe",
    summary:
      "Check which provider executables are available on PATH; never throws on an unavailable provider",
    input: {},
    output: reject(AgentProbeOutput),
    run: () =>
      Effect.gen(function* () {
        const { providerConfig } = yield* loadConfigs(layers);
        const results = yield* probeProviders(providerConfig).pipe(Effect.provide(layers.shell));
        return {
          providers: results.map(({ provider, available }) => ({
            provider,
            available,
            enabled:
              providerConfig.providers[provider as keyof typeof providerConfig.providers]
                ?.enabled === true,
          })),
        };
      }),
    exits: configErrors,
    errors: configFields,
    texts: configTexts,
    render: (value) =>
      value.providers
        .map(
          ({ provider, available, enabled }) =>
            `  ${provider}: ${available ? "available" : "unavailable"}${enabled ? "" : " (disabled in config)"}`,
        )
        .join("\n"),
  });
}

// ── agent setup mistral-vibe ────────────────────────────────────────────────────

const AgentSetupMistralVibeOutput = Schema.Struct({
  dryRun: Schema.Boolean,
  installModelAliases: Schema.Boolean,
  configPath: Schema.String,
  aliasesAdded: Schema.Array(Schema.String),
  aliasesSkipped: Schema.Array(Schema.String),
  aliasesRetired: Schema.Array(Schema.String),
  backupPath: Schema.NullOr(Schema.String),
  written: Schema.Array(Written),
});

function aliasLines(added: ReadonlyArray<string>, configPath: string): string[] {
  if (added.length === 0) return ["All aliases already present — nothing to append."];
  return [
    `Would append ${added.length} alias(es) to ${configPath}:`,
    ...added.map((alias) => `  + ${alias}`),
  ];
}

function makeAgentSetupMistralVibeCommand(layers: AgentLayers) {
  return defineCommand({
    name: "mistral-vibe",
    summary:
      "Append PHAX-owned Mistral Vibe model aliases to ~/.vibe/config.toml (append-only, atomic)",
    input: {
      flags: reject(
        Schema.Struct({
          dryRun: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Preview what would be appended without writing anything",
            }),
          ),
          installModelAliases: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Actually append the missing aliases and write the backup",
            }),
          ),
        }),
      ),
    },
    output: reject(AgentSetupMistralVibeOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const { dryRun, installModelAliases } = input.flags;
        const result = yield* vibeSetup({
          ...(dryRun !== undefined ? { dryRun } : {}),
          ...(installModelAliases !== undefined ? { install: installModelAliases } : {}),
        }).pipe(
          Effect.provide(layers.fileSystem),
          Effect.mapError(
            (error) => new AgentSetupError({ message: `Setup failed: ${error.message}` }),
          ),
        );
        const { aliasesAdded, aliasesSkipped, aliasesRetired, backupPath } = result;
        return {
          dryRun: dryRun === true,
          installModelAliases: installModelAliases === true,
          configPath: VIBE_CONFIG_PATH,
          aliasesAdded: [...aliasesAdded],
          aliasesSkipped: [...aliasesSkipped],
          aliasesRetired: [...aliasesRetired],
          backupPath: backupPath ?? null,
          // The config is rewritten only together with its backup.
          written: yield* writtenAbsolute(
            backupPath === undefined ? [] : [VIBE_CONFIG_PATH, backupPath],
            layers,
          ),
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: { AgentSetupError: 2 },
    errors: { AgentSetupError: MessageFields },
    texts: { AgentSetupError: (error) => error.message },
    render: (value) => {
      const lines: string[] = [];
      if (value.aliasesRetired.length > 0) {
        lines.push(
          `No longer used, left in ${value.configPath} (Mistral refuses their reasoning level): ${value.aliasesRetired.join(", ")}`,
        );
      }
      if (value.dryRun) {
        lines.push("Dry run — no changes written.");
        lines.push(...aliasLines(value.aliasesAdded, value.configPath));
        if (value.aliasesSkipped.length > 0) {
          lines.push(
            `Already present (${value.aliasesSkipped.length}): ${value.aliasesSkipped.join(", ")}`,
          );
        }
        return lines.join("\n");
      }
      if (!value.installModelAliases) {
        lines.push("Dry run — no changes written (pass --install-model-aliases to apply).");
        lines.push(...aliasLines(value.aliasesAdded, value.configPath));
        return lines.join("\n");
      }
      if (value.aliasesAdded.length === 0) {
        lines.push("All aliases already present — nothing to append.");
        return lines.join("\n");
      }
      lines.push(
        `Appended ${value.aliasesAdded.length} alias(es) to ${value.configPath}:`,
        ...value.aliasesAdded.map((alias) => `  + ${alias}`),
      );
      if (value.backupPath !== null) lines.push(`Backup written to: ${value.backupPath}`);
      return lines.join("\n");
    },
  });
}

// ── agent setup providers ───────────────────────────────────────────────────────

const AgentSetupProvidersOutput = Schema.Struct({
  write: Schema.Boolean,
  withRouting: Schema.Boolean,
  retiredRemoved: Schema.Array(Schema.String),
  enabled: Schema.Array(Schema.String),
  disabled: Schema.Array(Schema.String),
  unchanged: Schema.Array(Schema.String),
  providerConfigPath: Schema.String,
  backupPath: Schema.NullOr(Schema.String),
  modelRoutingPath: Schema.String,
  routingScaffolded: Schema.Boolean,
  written: Schema.Array(Written),
});

function makeAgentSetupProvidersCommand(layers: AgentLayers) {
  return defineCommand({
    name: "providers",
    summary:
      "Reconcile ~/.phax/providers.json enabled flags from live executable probes (dry-run by default)",
    input: {
      flags: reject(
        Schema.Struct({
          write: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Persist the reconciled config (writes a timestamped backup first)",
            }),
          ),
          prune: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Also disable providers whose executable is unavailable",
            }),
          ),
          withRouting: Schema.optionalKey(
            Schema.Boolean.annotate({
              description:
                "Scaffold ~/.phax/model-routing.json from defaults when absent (never overwrites)",
            }),
          ),
        }),
      ),
    },
    output: reject(AgentSetupProvidersOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const write = input.flags.write ?? false;
        const withRouting = input.flags.withRouting ?? false;
        const result = yield* providerSetup({
          write,
          prune: input.flags.prune ?? false,
          withRouting,
        }).pipe(
          Effect.provide(Layer.merge(layers.fileSystem, layers.shell)),
          Effect.mapError(
            (error) => new AgentSetupError({ message: `Setup failed: ${error.message}` }),
          ),
        );
        const { plan, backupPath, routingScaffolded, providerConfigPath, modelRoutingPath } =
          result;
        return {
          write,
          withRouting,
          retiredRemoved: [...plan.retiredRemoved],
          enabled: [...plan.enabled],
          disabled: [...plan.disabled],
          unchanged: [...plan.unchanged],
          providerConfigPath,
          backupPath: backupPath ?? null,
          modelRoutingPath,
          routingScaffolded,
          written: yield* writtenAbsolute(
            [
              ...(write ? [providerConfigPath] : []),
              ...(backupPath === undefined ? [] : [backupPath]),
              ...(routingScaffolded ? [modelRoutingPath] : []),
            ],
            layers,
          ),
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: { AgentSetupError: 2 },
    errors: { AgentSetupError: MessageFields },
    texts: { AgentSetupError: (error) => error.message },
    render: (value) => {
      const lines: string[] = [];
      if (value.retiredRemoved.length > 0) {
        lines.push(
          `${value.write ? "Dropped" : "Would drop"} models phax no longer routes to (${value.retiredRemoved.length}): ${value.retiredRemoved.join(", ")}`,
        );
      }
      const upToDate = value.enabled.length === 0 && value.disabled.length === 0;
      if (!value.write) {
        lines.push("Dry run — no changes written.");
        if (value.enabled.length > 0) {
          lines.push(`Would enable (${value.enabled.length}):`);
          for (const p of value.enabled) lines.push(`  + ${p}`);
        }
        if (value.disabled.length > 0) {
          lines.push(`Would disable (${value.disabled.length}):`);
          for (const p of value.disabled) lines.push(`  - ${p}`);
        }
        if (upToDate) lines.push("All providers already up-to-date.");
        if (value.unchanged.length > 0) {
          lines.push(`Unchanged (${value.unchanged.length}): ${value.unchanged.join(", ")}`);
        }
        return lines.join("\n");
      }
      if (upToDate) {
        lines.push("All providers already up-to-date.");
      } else {
        if (value.enabled.length > 0) {
          lines.push(`Enabled (${value.enabled.length}):`);
          for (const p of value.enabled) lines.push(`  + ${p}`);
        }
        if (value.disabled.length > 0) {
          lines.push(`Disabled (${value.disabled.length}):`);
          for (const p of value.disabled) lines.push(`  - ${p}`);
        }
      }
      lines.push(`Config written to: ${value.providerConfigPath}`);
      if (value.backupPath !== null) lines.push(`Backup written to: ${value.backupPath}`);
      if (value.withRouting) {
        lines.push(
          value.routingScaffolded
            ? `Routing config scaffolded: ${value.modelRoutingPath}`
            : `Routing config already exists, skipped: ${value.modelRoutingPath}`,
        );
      }
      return lines.join("\n");
    },
  });
}

// ── The group ───────────────────────────────────────────────────────────────────

/** The `agent` group over these layers; the program instance uses the real adapters. */
export function makeAgentGroup(layers: AgentLayers = REAL_AGENT_LAYERS) {
  return defineGroup({
    name: "agent",
    summary: "Inspect and manage model routing and provider configuration",
    commands: [
      makeAgentModelsCommand(layers),
      makeAgentResolveCommand(layers),
      makeAgentProbeCommand(layers),
      defineGroup({
        name: "setup",
        summary: "Set up provider integrations",
        commands: [
          makeAgentSetupMistralVibeCommand(layers),
          makeAgentSetupProvidersCommand(layers),
        ],
      }),
    ],
  });
}

export const agentGroup = makeAgentGroup();
