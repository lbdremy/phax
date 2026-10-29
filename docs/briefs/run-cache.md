Write the phax spec `run-cache`: a run owns one cache folder, shared by all its phases, which phax hands to the
agent and to the gate through environment variables the project names in `phax.json`. A build tool's output (Cargo's
`target/`, for one) is then built once per run instead of once per phase, and it goes away with the run.

Why: every phase of a run is a fresh worktree, so a build tool starts from nothing at every phase. On steme-lab (a
Cargo workspace beside a pnpm one, on macOS), one phase worktree after a build and the gate measured 8.0 GB on
2026-10-29:

- `target/` held 5.8 GB:
  - `deps` 4.5 GB: `.rlib` 1.7 GB, `.rmeta` 0.8 GB, `.o` kept for debug info 1.3 GB;
  - `incremental` 1.3 GB;
  - executables 0.4 GB.
- `node_modules` held 2.1 GB. These are copy-on-write clones from the pnpm store on APFS, so they cost far less on disk
  than `du` says.

The run `steme-gates-steme-2` (17 phases) held about 75 GB of worktrees, and `debt-commands` (7 phases) about 40 GB of
real disk. Most of a `target/` is third-party crates that every phase compiles again, identically. The author
measured and decided:

- **One cache per run, not one per machine or per project.** The phases of a run are sequential, so they never wait on
  the build tool's lock, and no run sees another's artifacts.
- **Incremental compilation and debug info stay on.** An agent compiles several times within a phase, and those help
  it.

What exists, to read first:
- How phax spawns the gate's commands (`src/infra/shell.ts`) and each provider's agent (`src/infra/providers/`). Today
  both inherit the environment of the `phax` process. So `CARGO_TARGET_DIR=<dir> phax run …` works by hand, but
  `phax resume` must be given the same variable again, and nothing records it.
- The security policy (`src/domain/security/resolvePolicy.ts`, `docs/security.md`):
  - the worktree is the only writable path by default, and `security.filesystem.allowWrite` adds others;
  - Claude's Bash commands are allowlisted, not confined, while Codex's and Vibe's sandboxes confine writes to their
    writable roots. A cache outside the worktree must therefore be a granted, recorded writable path.
- The run's folders and their lifecycle: `~/.phax/runs/<namespace>.<run>/`, `~/.phax/worktrees/…`, `phax archive`
  (moves) and `phax prune` (`src/app/prune.ts`, deletes and keeps the cost ledger).
- The commands that work in a run's worktree outside a phase: `phax shell`, `phax open`, `phax enter`,
  `phax enter-phase`, the interactive review stop. A person reviewing the final phase builds there too.

What the spec must cover:
- **The configuration.** A key in `phax.json`, for example `runCache: { env: ["CARGO_TARGET_DIR"] }`, naming the
  variables phax sets to the run's cache folder; indicative.
  - phax knows no build tool: a project names its variables.
  - Say which config layers may set it, and whether one folder serves several variables or each gets its own
    subfolder.
- **The folder.** Where it lives (under `~/.phax/`, beside the run's worktrees), its name from the run's qualified name,
  when phax creates it, and that every phase of the run, its gate, its fix loop, a resume and an interactive stop get
  the same one.
- **Its grant.** The folder is added to the phase's writable paths and recorded in `security.json`, as any
  `allowWrite` path is.
  - The loss to state: the agent of one phase can change what a later phase of the same run builds on. That is the
    run's own work, but it is no longer only the worktree.
  - Frame it as a §9 question with options: granted by the key itself, or only with a flag at `phax run`.
- **Its lifecycle.**
  - `phax archive`: kept or deleted? Recommend deleted, since a cache is rebuildable and an archive keeps the work,
    not the build.
  - `phax prune` deletes it.
  - A size line in the run's final report, and in `phax prune`'s preview.
- **The commands outside a phase.** `phax shell`, `phax open` and `phax enter` set the same variables, so that a person
  reviewing builds into the run's cache too. Say which ones do and why.
- **The surface.** The `phax.json` key with its schema and docs, the environment each spawned process gets (shown in
  `phax security status`, or in the phase's record), and acceptance criteria:
  - two phases share the folder: a file the first writes is there for the second;
  - a resumed run keeps it;
  - prune removes it;
  - a project with no `runCache` sees no change in argv, environment or records.

Out of scope:
- **A cache shared across runs or projects.** It would bring locks and stale artifacts.
- **Build tools' own caches,** such as sccache or pnpm's store.
- **Cleaning a cache inside a run.**
- **Any change to how a phase's worktree is made.**

Constraints:
- **Additive:** without the key, nothing changes. Persisted formats change only by adding fields, at their current
  version.
- **§9 holds genuine choices only,** each with its options, what each abandons, and a recommended default. At least:
  - the grant;
  - archive's fate for the cache;
  - one folder or one per variable;
  - which commands outside a phase set the variables.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
