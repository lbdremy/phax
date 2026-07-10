// Generates the model-catalog Markdown table from DEFAULT_PROVIDER_CONFIG and
// rewrites the marker-delimited region in the phax-planning skill files.
// Run with: pnpm gen:model-catalog
// Check for drift: pnpm gen:model-catalog -- --check
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PROVIDER_CONFIG } from "../src/domain/routing/defaults.js";
import type { ProviderConfig } from "../src/schemas/providerConfig.js";

export const BEGIN_MARKER = "<!-- BEGIN generated: model-catalog -->";
export const END_MARKER = "<!-- END generated: model-catalog -->";

const SKILL_FILES = [
  ".claude/skills/phax-planning/SKILL.md",
  ".agents/skills/phax-planning/SKILL.md",
];

/**
 * Render the catalog table from a ProviderConfig. Rows are grouped in the
 * order providers and families appear in the config — no sorting applied so
 * the output is stable and reproducible.
 */
export function renderCatalogTable(providerConfig: ProviderConfig): string {
  const rows: string[] = ["| ID | Family | Status | Efforts |", "| --- | --- | --- | --- |"];

  for (const providerEntry of Object.values(providerConfig.providers)) {
    const families = providerEntry.families;
    if (!families) continue;
    for (const [family, familyEntry] of Object.entries(families)) {
      for (const entry of familyEntry.models) {
        const effortsStr = entry.efforts.map((e) => `\`${e}\``).join(" \\| ");
        rows.push(`| \`${entry.id}\` | \`${family}\` | ${entry.status} | ${effortsStr} |`);
      }
    }
  }

  return rows.join("\n");
}

/**
 * Rewrite the region between BEGIN_MARKER and END_MARKER in `content` with
 * `tableContent`. Throws when either marker is absent.
 */
export function rewriteMarkerRegion(content: string, tableContent: string): string {
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Model catalog markers not found — add ${BEGIN_MARKER} / ${END_MARKER} to the file first`,
    );
  }
  const before = content.slice(0, beginIdx + BEGIN_MARKER.length);
  const after = content.slice(endIdx);
  return `${before}\n${tableContent}\n${after}`;
}

/**
 * Returns true when the committed region between markers does not match
 * `tableContent` (i.e. the file is stale and needs regenerating).
 */
export function hasStaleRegion(content: string, tableContent: string): boolean {
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) return true;
  const current = content.slice(beginIdx + BEGIN_MARKER.length, endIdx);
  return current !== `\n${tableContent}\n`;
}

// Anchor used when the file has not yet been migrated to the marker format.
// The generator replaces the entire block from this heading through the end of
// the "## Effort values" section with the marker-delimited catalog section.
const LEGACY_START = "## Model IDs\n";
const LEGACY_END = "\n\n## Required commands declaration";
const CATALOG_HEADING = "## Model catalog\n\n";

/**
 * Apply the catalog table to `content`. If markers already exist, delegates to
 * `rewriteMarkerRegion`. When the file still has the legacy hand-maintained
 * sections (## Model IDs / ## Effort values), replaces those with the
 * marker-delimited catalog block. Throws when neither the markers nor the
 * legacy anchor are found.
 */
export function applyToContent(content: string, tableContent: string): string {
  if (content.includes(BEGIN_MARKER)) {
    return rewriteMarkerRegion(content, tableContent);
  }
  const startIdx = content.indexOf(LEGACY_START);
  const endIdx = content.indexOf(LEGACY_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Cannot locate model catalog section in file — add ${BEGIN_MARKER} / ${END_MARKER} markers or restore the legacy ## Model IDs heading`,
    );
  }
  const markerBlock = `${CATALOG_HEADING}${BEGIN_MARKER}\n${tableContent}\n${END_MARKER}`;
  return content.slice(0, startIdx) + markerBlock + content.slice(endIdx);
}

// ─── Phase-04 prose patches ──────────────────────────────────────────────────
// These one-time prose updates are applied (idempotently) when running without
// --check. They wire the model-routing skill and phax-planning prose to the
// catalog/equivalence model that replaced the tier scale.

const PLANNING_SKILL_CATALOG_INTRO =
  `## Model catalog\n\n` +
  `Each entry below is a versioned model id from the provider catalog with its effort set and status. ` +
  `Plan phases reference concrete model ids (e.g. \`claude-sonnet-4-6\`); phax resolves them natively ` +
  `when the execution provider serves the same family, or translates through the Claude-hub equivalence ` +
  `table otherwise. The catalog is the source of truth — the run-start preflight rejects any phase ` +
  `whose id or effort is not listed here.\n\n`;

const OLD_PLANNING_CATALOG_HEADING = `## Model catalog\n\n<!-- BEGIN generated: model-catalog -->`;
const NEW_PLANNING_CATALOG_SECTION =
  PLANNING_SKILL_CATALOG_INTRO + `<!-- BEGIN generated: model-catalog -->`;

function applyPlanningSkillProse(content: string): string {
  if (!content.includes(OLD_PLANNING_CATALOG_HEADING)) return content;
  return content.replace(OLD_PLANNING_CATALOG_HEADING, NEW_PLANNING_CATALOG_SECTION);
}

const MODEL_ROUTING_SKILL_CONTENT = `---
name: model-routing
description: Extend the routing layer, add provider adapters, change the resolution algorithm, or add new model families in src/domain/routing/.
---

# model-routing skill

Use this skill when extending the routing layer, adding provider adapters, changing the resolution algorithm, or adding new model families.

## Architecture overview

\`\`\`
src/domain/routing/         ← PURE — no IO, no Effect, no infra imports
  types.ts                  ← ProviderId, ModelFamily, EffortLevel, ThinkingLevel, Relationship literals
  defaults.ts               ← DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG constants
  catalog.ts                ← pure catalog helpers: familyOfId, entryFor, effortsFor, isDeprecated, nearestEfforts, equivalentFor, isClaudeFamily
  resolve.ts                ← resolveModel(request, routing, providerCfg, securityFilter?): RoutingResolution (total, pure)
  preflight.ts              ← preflightPhaseModels(phases, routing, providerConfig): { failures } (pure)

src/schemas/
  modelRouting.ts           ← Effect Schema for ~/.phax/model-routing.json (version 2); re-exports literal schemas
  providerConfig.ts         ← Effect Schema for ~/.phax/providers.json (versioned catalog with per-entry efforts and status)
  vibeConfig.ts             ← VibeBaseModel schema + extractBaseModel + renderPhaxAliasBlocks

src/app/
  loadRouting.ts            ← FileSystem-port loaders; falls back to defaults when files absent
  vibeSetup.ts              ← append-only Vibe alias installer (atomic write + backup)

src/infra/providers/        ← ONLY place that may spawn provider binaries
  claudeCode.ts             ← claude spawn logic
  mistralVibe.ts            ← vibe spawn logic (VIBE_ACTIVE_MODEL env)
  codexCli.ts               ← codex spawn logic
  sessionWriter.ts          ← shared atomic session-id writer
  dispatcher.ts             ← makeNodeBackendLayer(providerConfig) — selects adapter by options.provider

src/cli/commands/agent.ts   ← phax agent models|resolve|probe|setup commands
\`\`\`

## Key invariants

**Domain stays pure**: nothing under \`src/domain/routing/\` may import Effect, \`@opentelemetry/*\`, the FileSystem port, or any \`infra/\` module. \`resolveModel\` is a total pure function — it never throws. An architectural guard in \`tests/unit/architecturalGuards.test.ts\` enforces this.

**Only \`src/infra/providers/\` may spawn**: the \`spawn("claude"…)\`, \`spawn("vibe"…)\`, \`spawn("codex"…)\` calls live exclusively in the corresponding adapter files. The architectural guard forbids these patterns anywhere else in \`src/\`.

**Schemas use \`onExcessProperty: "error"\`**: config files are validated strictly. Config version 2 rejects \`tiers\`, \`normalization\`, and \`defaultTier\` fields — there is no back-compat shim. New fields must be added to the schema first.

**No back-compat shims**: new required fields are required, not optional for legacy files.

**\`allowDowngrade\` is the sole policy knob**: cross-family substitutions with \`downgrade\` or \`no_equivalent\` relation are skipped when \`allowDowngrade: false\`. Same-family resolution is always permitted.

**Efforts are per catalog entry**: each versioned model id has its own \`efforts\` array. There is no family-wide effort set. The preflight validates that a phase's effort is in its entry's supported set before any agent spawns.

**Terminal \`claude-code\` fallback**: \`resolveModel\` is total. If no provider in \`providerPriority\` resolves, the function falls through to \`claude-code\` — natively for Claude families, via the equivalence hub for non-Claude families.

**Telemetry never fails a run**: the \`agent.model.resolved\` event is emitted via \`telemetry.recordEvent\` and errors are swallowed.

**Atomic writes + backup**: \`vibeSetup.ts\` and the session writer use temp + rename; \`vibeSetup.ts\` backs up \`~/.vibe/config.toml\` before appending.

## Catalog helpers (\`catalog.ts\`)

| Export           | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| \`familyOfId\`     | Look up the \`ModelFamily\` for a versioned id; \`undefined\` if not in catalog  |
| \`entryFor\`       | \`CatalogLocation\` (provider + family + entry) for a versioned id             |
| \`effortsFor\`     | The efforts array for a versioned id                                         |
| \`isDeprecated\`   | True when the entry's status is \`"deprecated"\`                               |
| \`nearestEfforts\` | Efforts sorted by proximity to a requested effort; used by preflight         |
| \`equivalentFor\`  | Star-lookup through the Claude hub (hub→spoke, spoke→hub, spoke→spoke)       |
| \`isClaudeFamily\` | True for \`claude-haiku\`, \`claude-sonnet\`, \`claude-opus\`                      |

\`equivalentFor\` semantics: equivalence table edges are stated hub-centric. Hub → spoke uses the stored relation directly; spoke → hub inverts it (\`downgrade ↔ upgrade\`); spoke → spoke composes two hops.

## Resolution pipeline

1. Derive plan family from \`request.model\`: catalog lookup → \`requestedModelNormalization\` → substring heuristic → default \`claude-sonnet\`.
2. Walk \`routing.providerPriority\`; skip disabled providers and security-filtered providers.
3. If the provider serves the plan family, resolve natively from its catalog (relationship \`exact\` or \`equivalent\` if effort is clamped).
4. Otherwise translate through the Claude hub via \`equivalentFor\`; skip when \`allowDowngrade: false\` and relation is \`downgrade\` or \`no_equivalent\`.
5. Terminal \`claude-code\`: same-family natively, or spoke → hub via equivalence table. Relationship \`no_equivalent\` on a complete miss.

## Adding a new provider

1. Add the literal to \`ProviderId\` in \`src/domain/routing/types.ts\`.
2. Add the corresponding literal to \`ProviderIdSchema\` in \`src/schemas/modelRouting.ts\`.
3. Add equivalence edges in \`DEFAULT_MODEL_ROUTING.equivalence\` (in \`defaults.ts\`) for each of the provider's model ids and efforts, anchoring each to its Claude hub peer.
4. Add a \`ProviderEntry\` in \`DEFAULT_PROVIDER_CONFIG.providers\` with a \`families\` record and per-model \`models\` arrays.
5. Create \`src/infra/providers/<newProvider>.ts\` with \`runNewProviderAgent\` + resume variant returning \`AgentRunResult\`.
6. Wire the new branch in \`src/infra/providers/dispatcher.ts\`.
7. Add tests in \`tests/unit/providers/<newProvider>.test.ts\` (no real CLI — mock the spawn).

## Adding a new model family

1. Add the literal to \`ModelFamily\` in \`types.ts\` and \`ModelFamilySchema\` in \`modelRouting.ts\`.
2. Add \`requestedModelNormalization\` entries for known versioned ids in \`DEFAULT_MODEL_ROUTING\`.
3. Add the family's \`models\` arrays (with per-entry \`efforts\` and \`status\`) to the relevant provider entry in \`DEFAULT_PROVIDER_CONFIG\`.
4. If the family belongs to a spoke provider, add equivalence edges in \`DEFAULT_MODEL_ROUTING.equivalence\`.
5. Update \`docs/model-routing.md\` family table.

## Per-invocation provider priority override

Both \`phax run\` and \`phax resume\` accept \`--provider-priority <list>\` to override \`providerPriority\` for that invocation without touching any config file:

\`\`\`bash
phax run --provider-priority mistral-vibe,claude-code
phax resume my-run --yes --provider-priority codex-cli,claude-code
\`\`\`

Valid ids: \`claude-code\`, \`mistral-vibe\`, \`codex-cli\`. The list is parsed by \`parseProviderPriority\` in \`src/domain/routing/priorityOverride.ts\` (deduped, trimmed, validated; fails fast on empty/unknown). The override is applied by \`applyProviderPriorityOverride\` which returns a new \`ModelRouting\` with only \`providerPriority\` replaced.

**Caveat**: \`claude-code\` remains the guaranteed terminal fallback in \`resolveModel\` regardless of the override.

## Worked examples

| Request                               | Priority           | allowDowngrade | Result                                                                     |
| ------------------------------------- | ------------------ | -------------- | -------------------------------------------------------------------------- |
| \`claude-sonnet-4-6\` / \`medium\`        | claude-code only   | —              | claude-code, \`claude-sonnet-4-6\`, \`medium\`, \`exact\`                        |
| \`claude-sonnet-4-6\` / \`medium\`        | mistral-vibe first | —              | mistral-vibe, \`phax-mistral-medium-3.5-medium\`, \`medium\`, \`equivalent\`     |
| \`gpt-5.5\` / \`xhigh\`                  | codex-cli first    | —              | codex-cli, \`gpt-5.5\`, \`xhigh\`, \`exact\`                                    |
| \`gpt-5.5\` / \`xhigh\` (codex disabled) | —                  | true           | claude-code, \`claude-opus-4-8\`, \`medium\`, \`equivalent\` (hub translation)   |
| \`claude-opus-4-8\` / \`ultracode\`       | any                | any            | claude-code, \`claude-opus-4-8\`, \`ultracode\`, \`exact\`                       |
`;

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const checkMode = process.argv.includes("--check");
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const tableContent = renderCatalogTable(DEFAULT_PROVIDER_CONFIG);

  let stale = false;
  for (const relPath of SKILL_FILES) {
    const filePath = join(repoRoot, relPath);
    const content = readFileSync(filePath, "utf8");

    if (checkMode) {
      if (hasStaleRegion(content, tableContent)) {
        console.error(`Stale model catalog in ${relPath} — run: pnpm gen:model-catalog`);
        stale = true;
      }
    } else {
      // Apply prose patches first (idempotent), then the catalog table.
      const withProse = applyPlanningSkillProse(content);
      const updated = applyToContent(withProse, tableContent);
      if (updated !== content) {
        writeFileSync(filePath, updated, "utf8");
        console.log(`Updated: ${relPath}`);
      } else {
        console.log(`Already up to date: ${relPath}`);
      }
    }
  }

  if (!checkMode) {
    // Update the model-routing skill (complete rewrite, idempotent).
    const modelRoutingPath = join(repoRoot, ".claude/skills/model-routing/SKILL.md");
    const currentRouting = readFileSync(modelRoutingPath, "utf8");
    if (currentRouting !== MODEL_ROUTING_SKILL_CONTENT) {
      writeFileSync(modelRoutingPath, MODEL_ROUTING_SKILL_CONTENT, "utf8");
      console.log(`Updated: .claude/skills/model-routing/SKILL.md`);
    } else {
      console.log(`Already up to date: .claude/skills/model-routing/SKILL.md`);
    }
  }

  if (stale) process.exit(1);
}
