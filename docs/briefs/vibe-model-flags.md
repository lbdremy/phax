Write the phax spec `vibe-model-flags`: phax picks a Mistral Vibe session's model and thinking level with Vibe's own
`--model` and `--thinking` flags, and stops writing model aliases into the user's `~/.vibe/config.toml`.

## Why

Vibe had no per-run way to pick a model or a thinking level when phax first drove it, so phax works around it:

- `phax agent setup mistral-vibe --install-model-aliases` appends one `[[models]]` block per thinking level to
  `~/.vibe/config.toml` (`# Added by PHAX.`, aliases `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high`,
  `src/schemas/vibeConfig.ts`, `src/app/vibeSetup.ts`), copying the base model's name, provider, temperature, prices
  and compaction threshold;
- the routing catalog lists those aliases as the `mistral-medium` family's models, one effort each
  (`src/domain/routing/defaults.ts`), and `RETIRED_MODEL_IDS` keeps three more (`-low`, `-medium`, `-max`) that the
  Mistral API refuses;
- each headless turn selects the alias through the environment, `VIBE_ACTIVE_MODEL=<alias>`, from the provider entry's
  `modelEnvVar` (`src/infra/providers/mistralVibe.ts`, `spawnVibe`); the interactive fresh-start command a stop prints
  does the same (`src/domain/session/mistral.ts`, `buildFreshStartCommand`).

So phax edits a file it does not own, a user's Vibe config must carry phax's blocks before a Vibe phase can run, and the
copied prices and thresholds drift from Vibe's own table as Vibe changes it.

## Mistral Vibe 3.1.3 facts (installed 2026-11-18, read from its docs and `vibe --help`)

- **`--model ALIAS`** (3.0.4): "Model alias to use instead of 'active_model' (headless mode only, new sessions). Not
  saved as the default." An unknown alias is a usage error (exit 1, outcome `usage_error`).
- **`--thinking LEVEL`** (3.1.3): "Thinking level of the model (off, low, medium, high, xhigh, max, or a level the model
  lists; any other word is sent as written), headless mode only, new sessions. Not saved." A level an agent profile or
  the admin config fixes for the model is a usage error.
- **Built-in model table** (`vibe/core/config/vibe_schema.py`): alias `mistral-medium-3.5` (name
  `mistral-vibe-cli-latest`, `thinking_levels = ["off", "high"]`, default `high`, input 1.5 / output 7.5 per million);
  alias `mistral-large-4-0`, now Vibe's default model. With Mistral's model catalog on, a pin on `mistral-medium-3.5`
  runs the catalog model behind that alias.
- **Resume** (3.1.1): "A resumed session uses the model and agent it last ran, instead of the current default."
- **Export**: `--output-dir` still writes `export.json` at `schema_version: 1`, with the effective `config`
  (`active_model` among it), as phax reads today.
- phax's real-CLI Vibe e2e (`tests/e2e/vibeSecure.test.ts`) passes on 3.1.3 unchanged (8 passed, the `MISTRAL_API_KEY`
  one skipped), on the alias path.

## Settled (do not reopen)

1. **Model and thinking by flag.** A new headless Vibe session (a phase's first turn, an authoring, review, compliance,
   decide or extraction session, a sealed completion) passes `--model <alias> --thinking <level>`. A resumed turn
   (`--resume`) passes neither: Vibe keeps the session's model and level.
2. **No model environment variable on headless turns.** phax sets no `VIBE_ACTIVE_MODEL` on a headless turn.
3. **phax never writes `~/.vibe/config.toml`.** The alias installer goes, with its backup, its retired-alias report and
   its JSON answer fields.
4. **Catalog.** The `mistral-medium` family lists one model, Vibe's own alias `mistral-medium-3.5`, with efforts `off`
   and `high` (the levels the Mistral API serves for it, checked 2026-10-28). The two alias ids join
   `RETIRED_MODEL_IDS`, so a `providers.json` that still lists them is refused as today and
   `phax agent setup providers --write` drops them. The routing equivalences move to the new id, edge for edge.
5. **Version floor 3.1.3**, refused before any session spawns as the 3.0.3 floor is today (installed version, 3.1.3,
   `uv tool upgrade mistral-vibe`).
6. **Mistral Large 4 is out of this spec.** Adding it to the catalog, and re-pointing defaults by cost, is its own change.

## What the spec must cover

- **The argv**, per session kind, with the flags' place in it, and that a resume carries neither flag.
- **What phax checks after a confined turn.** `vibeConfigMismatch` compares the export's `config` with what phax set; say
  whether it also compares the model and the thinking level, and name the export fields that hold them (verify on a
  real export: whether the thinking level is visible there at all).
- **The interactive fresh-start command** a stop prints runs Vibe's TUI, where neither flag works. Say what it carries
  instead (see §9).
- **An older `providers.json`**: one listing the alias ids, and one carrying `modelEnvVar`. What phax says, and the one
  command that fixes it.
- **What a user with phax's alias blocks in `~/.vibe/config.toml` sees and does** (see §9). The blocks keep working for
  their own Vibe sessions; phax no longer reads them.
- **Records**: run, phase and authoring records name the model `mistral-medium-3.5` from now on; records written before
  keep the alias ids. No persisted format changes; the cost history already sums across models.
- **Acceptance**: a real-CLI check that a session runs under `--model mistral-medium-3.5 --thinking off` and under
  `high`, that a resumed turn keeps its model, and that a Vibe older than 3.1.3 is refused naming 3.1.3.
- **Docs**: `docs/model-catalog.md`, `docs/model-routing.md`, the README's Vibe setup, and the `docs/upgrading.md` entry.

## §9 — genuine choices (each with options, what each abandons, and a recommended default)

- **The `phax agent setup mistral-vibe` command.** Remove it (recommended: nothing left for it to do; the upgrade entry
  says how to delete the `# Added by PHAX.` blocks by hand), or keep it as a report of leftover blocks, or turn it into a
  remover (phax would edit the user's Vibe config once more).
- **The interactive fresh start.** Keep `VIBE_ACTIVE_MODEL=mistral-medium-3.5` for the TUI command, with the thinking
  level left at the model's default and named in the printed command's note (recommended), or print no model at all.
- **`modelEnvVar` in the provider entry.** Drop the field from the provider config schema, so an old file carrying it is
  refused by name and `setup providers --write` rewrites it (recommended: Vibe was its only user, and the TUI command
  can name its variable itself), or keep it for the TUI command only.

## Constraints

- No back-compat shims: an old `providers.json` is refused and rewritten by the existing setup command, not read
  leniently.
- phax never reads Vibe's home directory to pick a model: the flags, Vibe's own table and the export are the whole
  contract.
- The secure-mode confinement (`src/domain/session/vibeFlags.ts`) is unchanged: `--agent accept-edits`, the `VIBE_*`
  variables, `VIBE_TOOLS`, the refusals.

## Out of scope

- Mistral Large 4 and any other model or family.
- `--time-limit`, `--max-tokens`, `--max-price`, and the export's `warnings` (denied tool calls): later, separate changes.
- Vibe's new hook kinds (`pre_agent`, `pre_llm`, `post_llm`, `session_start`).
