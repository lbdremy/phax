Write the phax spec `surface-summary`. Every element of a spec's §6 Surface gains a required one-line `summary`: what the consumer can now do or sees differently, in the consumer's words. Today an element names only *where* the change lands (`cli: phax validate`, `config: phax.json assignments`); its `before`/`after` blocks show the change, but nothing says it in one sentence.

Why: the phax repository will build its release notes from the specs a release completes (spec title, `productGoal.guidingRule`, then one line per surface element), instead of GitHub's notes generated from PR titles. That script is repository tooling under `scripts/`, not a phax feature, and it is out of scope here (a non-goal). It needs one thing phax does not carry yet: the summary. Human readers of §6 get the same line.

What already exists (read it; do not restate it as new):
- **The spec document format** (`src/schemas/specDocument.ts`): `surface` is a list of `{ surface, binding, before, after }`, `surface` prefixed by its kind (`cli: `, `config: `, `file: `, `api: `, `package: `, `internal: `).
- **The renderer** that turns the sidecar into the canonical Markdown §6 (`### <surface> — <binding>`, then `before:` / `after:`).
- **The `phax-spec` skill** (`.claude/skills/phax-spec/SKILL.md`), its Surface section and its sidecar field table.
- **`phax artifact migrate-documents`**, which lifts live sidecars stamped below their format's current shape, and the frozen-snapshot mechanism for document formats.

What the operator decided on 2026-10-21 (do not reopen):
1. **`summary` is required on every surface element, of every kind**, including `internal:`. No optional field for older sidecars (no back-compat shims in persisted formats). A consumer that wants only the user-visible elements filters on the kind prefix.
2. **One sentence, the consumer's words, the what.** It says what changes for whoever consumes that element ("`phax validate` checks each assignment bound against the routing catalog"), never where it lives or how it is built. The skill teaches this, with one good and one bad example.
3. **The renderer prints it in §6**, under each element's heading and before `before:` / `after:`, so the Markdown and the sidecar say the same thing.
4. **Archived specs are never touched**, as today: the release-notes script reads only specs completed after this ships.
5. **The headless spec authoring prompt and its JSON Schema** carry the new field, so a headless session writes it.

Settle in §9, framing each option by what it abandons:
- **What `migrate-documents` writes for a live sidecar that has no summary.** It is deterministic and cannot invent a sentence. For instance: refuse that sidecar and name re-authoring or a hand edit; lift with a marker that `phax artifact approve` and `complete` refuse until replaced; or lift copying the surface name into the summary. Name what each costs the live Draft and Approved specs (`interactive-phases`, `oracle-phases`) and their bound plans.
- **Whether a hand-authored spec (no sidecar) shows the line too**: the skill's Markdown template carries it as guidance, or only the sidecar format requires it.
- **Whether `summary` has a length bound** (one line, a character cap) or stays a non-empty string the skill describes.

Out of scope: the release-notes script itself; dropping the `PHAX: ` prefix from PR titles (`src/domain/publish/title.ts`), which is a separate change.
