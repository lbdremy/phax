# Gate profiles

A gate profile is a named list of gate steps in `phax.json`. A project can define several, and each plan names the one that verifies its whole run. This page is for the operator whose project defines more than one profile and wants a plan to run under another than the first.

## Define the profiles

`gateProfiles` maps an id to its steps. Here `standard` is the full gate and `light` is for changes to the docs:

```json
{
  "gateProfiles": {
    "standard": [
      { "command": "pnpm typecheck", "surface": "local", "firing": "every-phase" },
      { "command": "pnpm test", "surface": "local", "firing": "every-phase" },
      { "command": "pnpm build", "surface": "product", "firing": "terminal" }
    ],
    "light": [
      { "command": "pnpm format:check", "surface": "local", "firing": "every-phase" },
      { "command": "pnpm site:build", "surface": "product", "firing": "terminal" }
    ]
  }
}
```

A profile is defined when it has at least one step. A plan writes the id as one word, so an id it can declare holds no space and no backtick. The order of the entries chooses nothing.

`phax.local.json` and `~/.phax/config.json` can add profiles, and replace one under the same id. A `workspaces` entry can also hold its own `gateProfiles`, which replace the top-level list under the same id for that workspace. `phax run`, `phax plans lint` and `phax resume` select no workspace, so they read the top-level `gateProfiles`.

## Declare the profile in the plan

Every plan declares exactly one profile before its first phase, in a `## Gate profile` section:

```markdown
## Gate profile

`light`

## Required commands

- (none)
```

The id is written as a code span or a bare word. phax reads the section itself and never asks a model for it. There is no default, and a phase cannot have a profile of its own. A phase's `### Verification` says what proves the phase beyond the profile. A headless planning session is given the defined profiles with their steps, and phax renders the one it chose into the section.

The declaration is part of the approved plan. Changing it makes the plan edited since its approval, and `phax run` refuses it until you approve it again. Editing the steps of a profile in `phax.json` does not: a run takes the steps `phax.json` holds when it runs.

## Check and run

`phax plans lint` checks the declaration, and checks the plan's required commands against `security.agentCommands` and the declared profile's steps alone. A missing or doubled declaration is a `structure` error:

```text
error    structure     -  the plan declares no gate profile (## Gate profile)
error    structure     -  the plan declares more than one gate profile (## Gate profile)
```

`phax run` refuses such a plan before it calls any model, and names `phax plans lint`.

The dry run names the profile that would gate the run:

```bash
phax run --plan <plan> --dry-run
#   Gate profile: light
```

`phax run --plan <plan>` then gates every phase with `light`'s steps.

## A profile phax.json does not define

Rename `light` to `docs` in `phax.json`, and the plan that declares `light` no longer lints. The finding has the `gate-profile` check, names the profiles that exist, and lint exits 1. The required commands are not checked until the profile is fixed.

```text
error    gate-profile  -  gate profile "light" is not defined in phax.json (defined: standard, docs)
```

`phax run`, with or without `--dry-run`, exits 2 before any worktree, run branch or run folder exists:

```text
gate profile "light" is not defined in phax.json (defined: standard, docs)
  the plan declares it under ## Gate profile; no worktree was created
```

Restore the id in `phax.json`, or change the declaration and approve the plan again.

## Resume keeps the profile

A run records its profile when it starts. `phax resume` gates the remaining phases with that one, even if the plan now declares another or `phax.json` lists another first. If `phax.json` no longer defines it, resume exits 2:

```text
gate profile "light" is not defined in phax.json (defined: standard, docs)
  the run recorded it when it started; restore it in phax.json, or archive the run with `phax archive <run> --force`
```

A run started by 0.42.0 or earlier cannot be resumed: finish it with that release, or archive it with `phax archive <run> --force` and run its plan again.

## Records

The review handoff and the pull request description name the run's profile. So does each phase record: `phax records explain` prints it on a `profile` line above `gates`, and `--json` holds it as `gateProfile`. A record written before shows `(not recorded)`.

## Older plans

A hand-written plan with no declaration gains one by editing it: add the section, then approve it again.

A plan with a JSON sidecar stamped 0.38.0 or earlier is migrated instead:

```bash
phax artifact migrate-documents --gate-profile standard
```

This writes the id into the sidecar and renders `## Gate profile` into the plan's body, so approve an Approved plan again afterwards. One call applies the one id to every plan it migrates. Without the flag such a plan is refused, naming the flag, and an id `phax.json` does not define is refused with exit 2.
