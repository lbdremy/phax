Write the phax spec `docs-site`: `docs.phax.run`, the documentation website of the phax CLI, built from what this repository already holds and deployed by the release pipeline.

Decided with the author on 2026-09-25 (NEXT_STEPS.md, "The docs site, in the release pipeline") — the spec must reflect these, not reopen them:
- `docs.phax.run` is a **rendering of what the repo already holds**: `docs/cli/reference.md` (generated from `phax.usage.kdl`), the README, `docs/security.md`, `docs/release.md`, `docs/model-catalog.md`, `docs/blog/`, and the comparisons (`docs/comparisons/`). No second copy of the content: a deterministic build step takes the sources as they are.
- Built with **Rspress** (v2, `@rspress/core`) from a `site/` folder — not an app, not a workspace package: the same kind of deliverable as the binaries and the npm publish.
- **Deployed on the release tag** by the release workflow, after every step that can fail (as the npm publish is). Hosting: **Cloudflare Workers Static Assets** — a `wrangler.jsonc` with `assets.directory` on the Rspress output and no Worker script; preview URLs per version.
- This is the pipeline steme's own docs site (steme roadmap item 0.6) copies afterwards, so keep it plain and reusable.
- The marketing site `www.phax.run` and the cockpit `app.phax.run` live in the private `phax-cockpit` repository: out of scope here.

A hard constraint from the Completed `schemas-package` spec: every document phax writes names its shape as `$schema: https://docs.phax.run/schemas/<format id>/<release>.json`. **The site must serve every released format's JSON Schema at exactly that path, for every release, and never remove one** (the committed snapshots `packages/schemas/snapshots/<format id>/<release>.schema.json` are the source; `pre-schema` and `next` are not served). 0.17.0 is already released, so its 15 URLs must resolve from the first deploy.

The identity (from the phax brand identity in the private cockpit corpus, summarised here since this public repo cannot link to it): dark theme first — a deep, unsaturated gold (old gold, brass; never yellow, never a gradient) on a warm black that leans toward it; a light theme, if kept, uses a warm off-white, with gold for accents only (rules, focus, logo, highlights), never running text, and a link that must be gold drops to a bronze that passes 7:1; gold never signals a warning. The logo is a P whose bowl is split so it also reads as an F (one stroke weight, geometric, gap ≥ 1/8 of the height to survive a 16 px favicon), with the lowercase wordmark `phax`. No hex values or logo asset exist yet. The design system is local to the site (Rspress's `--rp-c-*` variables, `logo`, self-hosted fonts); nothing is shared with another app.

What the spec must cover:
- The page tree (navigation) and where each page's content comes from; how a README section maps to a page without editing the README for the site's sake (or, if a source must change, say which and why).
- The build: one command, deterministic, offline (phase agents have no network), reproducible in CI and in the release workflow; what is generated and never committed; links between sources rewritten to site routes; a check that fails on a broken internal link.
- The `$schema` URLs: the route layout, content type, and a test that every released snapshot is served at its URL (and that a release never removes one).
- Versioning: whether the site shows only the latest release, or keeps older versions (Rspress `multiVersion`), and what "preview URLs per version" means concretely.
- The deploy: the release workflow steps, ordering relative to the npm stage publishes and the GitHub Release, what a failed deploy leaves behind; CI building the site on every push without deploying.
- What the author does by hand once (Cloudflare account, API token as a GitHub secret, the `docs.phax.run` custom domain, DNS): list it as a one-time setup in `docs/release.md`, never automated by an agent.
- The identity: concrete colour tokens (with their contrast ratios), the logo and favicon, the fonts; dark first.
- Acceptance criteria, testable without network where possible.
- §9: genuine choices only, each with options, what each abandons, and a recommended default — at least versioning, the identity tokens and logo (who draws the logo: a first geometric SVG made in a phase, or an asset the author supplies), whether the README stays the single source for the getting-started pages, and how the site is checked visually.
- Out of scope, named: `www.phax.run` and the cockpit; search beyond Rspress's built-in local search; analytics; i18n (English only, as the repo's docs); steme's docs site.

Ground to read first: NEXT_STEPS.md (the entry above, and "Road to 1.0.0"), README.md, `docs/release.md`, `.github/workflows/release.yml` and `ci.yml`, `tests/unit/releaseWorkflow.test.ts`, `scripts/docs-cli.ts`, `packages/schemas/snapshots/`, `scripts/release.sh` and `scripts/release-cut.ts`, the archived `schemas-package` spec (`docs/specs/archive/2609241238-schemas-package.md`, its `$schema` URL constraint).

Constraints: no CLI change, no persisted-format change; nothing from `~/.phax` or another repository enters this public repository; network-free build and tests; the deploy only from the release workflow (and an explicit author action), never from a phase.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
