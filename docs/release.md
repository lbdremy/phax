# Releasing phax

## Prerequisites

### SSH signing (one-time setup)

Configure git to sign with your SSH key:

```bash
git config --global gpg.format ssh
git config --global user.signingKey ~/.ssh/id_ed25519.pub
git config --global tag.gpgSign true   # sign all tags automatically
```

Add the same key to GitHub as a **Signing Key** (Settings → SSH and GPG keys → New SSH key → type: Signing Key). The same key used for authentication can be reused for signing — just add it as a separate entry.

### Trusted publisher for `@lbdremy/phax-schemas` (one-time, before its first release)

The release workflow publishes with no npm token: npm authenticates it through a trusted publisher (OIDC) configured on each package. A trusted publisher can only be configured on a package that exists, so the schemas package needs one hand-published version before the first release that ships it. Publish a deprecated `0.0.0` placeholder, then link the workflow — the first real version still comes from the tag, with provenance. The placeholder is the one version of `@lbdremy/phax-schemas` with no matching `@lbdremy/phax`.

Logged in to npm (`npm login`), with npm ≥ 11.16 (`npm trust` is not in older versions):

```bash
PLACEHOLDER="$(mktemp -d)"
cat > "$PLACEHOLDER/package.json" <<'EOF'
{
  "name": "@lbdremy/phax-schemas",
  "version": "0.0.0",
  "description": "Placeholder reserving the name; install a release instead",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lbdremy/phax.git",
    "directory": "packages/schemas"
  }
}
EOF
(cd "$PLACEHOLDER" && npm publish --access public)
npm deprecate @lbdremy/phax-schemas@0.0.0 "placeholder — install a release of @lbdremy/phax-schemas"
npm trust github @lbdremy/phax-schemas --file release.yml --repo lbdremy/phax --allow-stage-publish
```

### The docs site (one-time, by hand — never automated)

The docs site at docs.phax.run is set up once, by hand. These steps are done by hand and never automated: no workflow creates a Cloudflare resource.

1. Have a Cloudflare account holding the phax.run zone, with its DNS on Cloudflare.
2. Create an API token from the "Edit Cloudflare Workers" template, limited to that account and zone. Store it as the GitHub secret `CLOUDFLARE_API_TOKEN`, and store the account id as the secret `CLOUDFLARE_ACCOUNT_ID`.
3. Create the `phax-docs` Worker, then attach the custom domain docs.phax.run to it in the Cloudflare dashboard. Attaching the domain creates its DNS record and certificate. Do this in the order below, so that `https://docs.phax.run/schemas/index.json` answers 404 before the first release:
   - from a local checkout, run `pnpm exec wrangler deploy --config site/wrangler.jsonc --assets <empty directory holding only a 404.html>`. This creates `phax-docs` and enables the workers.dev subdomain and preview URLs from the config, and every path answers 404;
   - do not create the Worker from the dashboard's Hello World template, which answers 200 on every path and makes the deploy guard refuse;
   - attach docs.phax.run in the dashboard, then confirm that `https://docs.phax.run/schemas/index.json` answers 404.
4. Keep the workers.dev subdomain and the preview URLs enabled on the Worker. Each release's preview URL is how the release is checked before its npm packages are approved.

## Release process

A release ships two npm packages in lockstep, at the tag's version:

- `@lbdremy/phax`, the launcher for the release binaries (`npm/`);
- `@lbdremy/phax-schemas`, the persisted-format schemas (`packages/schemas/`).

Between releases, main names the **opened version**: the version the next release will carry. `package.json`, `npm/package.json` and `packages/schemas/package.json` all name it, `phax --version` prints it, and it is never tagged. The release ledger `packages/schemas/releases.json` lists only cut releases, so it ends below the opened version until the cut. A `$schema` stamp names a format's shape, not the build that wrote it: phax stamps each document with the release that last changed its format, or with the opened version while the format has a `next` snapshot. A wording-only change to a schema (its `description`, `title` or `examples`) is not a shape change and moves no stamp. This amends q-release-name in the archived `schemas-package` spec (`docs/specs/archive/2609241238-schemas-package.md`), under which a stamp named the release that wrote the file.

### 1. Ensure the branch is ready

```bash
pnpm check:full && pnpm build
```

### 2. Cut, commit, tag and push

```bash
scripts/release.sh 1.2.0
```

The version must be the opened version, the one `package.json` names, in `MAJOR.MINOR.PATCH` form — pre-release suffixes are not supported by the release workflow. On a clean tree, `release.sh`:

1. runs `scripts/release-cut.ts`, which refuses, before writing anything, a version other than the opened one (`<v> is not the opened version <opened> — re-open first: scripts/release.sh --open <v>`), one not newer than the ledger's last entry, one whose snapshot already exists, one whose notes file `docs/releases/<version>.md` already exists, any refusal of the release notes (see [Release notes](#release-notes)), and a missing, malformed or unordered ledger. It then:
   - renames every `packages/schemas/snapshots/<format id>/next.schema.json` to `<version>.schema.json`, so each format's current shape is named by the release;
   - regenerates `CURRENT_SHAPES` and `FIRST_SUPPORTED_RELEASE` (`packages/schemas/src/generated/index.ts`) and `src/schemas/release.ts`;
   - appends the version to the release ledger `packages/schemas/releases.json`, which the docs site reads to serve every release's schemas;
   - writes the release's notes to `docs/releases/<version>.md`, built from git before the first write.

   The cut changes no manifest, no stamp and no example: the manifests already name the version, and a renamed `next` snapshot was already stamped with it;
2. regenerates the usage spec and the CLI docs;
3. runs `pnpm typecheck`, `pnpm test:type` and `pnpm test` on the cut. If one fails, it stops with nothing committed, tagged or pushed, and prints how to undo the cut (resetting the tree and cleaning the new snapshots and `docs/releases`);
4. stages exactly the paths the cut changed (renames included) and the regenerated files, and commits `chore: release v1.2.0`;
5. creates the signed tag `v1.2.0` and pushes the commit and the tag;
6. opens the next minor: sets `1.3.0` in the three manifests, regenerates `PACKAGE_VERSION`, `PHAX_RELEASE`, `CURRENT_STAMPS`, the usage spec and the CLI docs, commits `chore: open v1.3.0` and pushes it. No test suite runs here, to keep the window between the tag and the opening short; every pull request's CI runs on an opened tree anyway.

If the opening fails, the release is already out. `release.sh` prints `✗ v1.2.0 is released but 1.3.0 is not opened — finish with: scripts/release.sh --open 1.3.0`, then `git push`, and how to discard a partial opening first (`git reset --hard HEAD`). If only the push of the opening fails, it says the opening is committed and `git push` finishes it.

`scripts/release.sh --rehearse <opened version>` does steps 1 and 2, typechecks the cut and runs only the tests that read what a cut changes (`tests/unit/schemasPackage/` and `tests/unit/site/`), then stops, leaving the cut in the working tree. On a release commit, whose version the ledger already ends at, it cuts nothing and says there is nothing to rehearse. CI rehearses the opened version that `package.json` names this way as its last step on every push and pull request, in seconds. A test that holds only until the next cut, such as one that reads the package's own version as an older release, then fails on the pull request that adds it, not at release time.

To see what a cut changes without touching the tree, dry-run it on a clone with the tags (`git clone . <copy>`; the notes need the previous release's tag, which a plain copy of the files lacks), naming the opened version:

```bash
pnpm exec tsx scripts/release-cut.ts "$(node -p 'require("./package.json").version')" --root <copy of the tree>
```

#### Re-opening by hand

When the cycle turns out bigger or smaller than the opened version says — a breaking change that calls for a new major, or a fix-only cycle that should ship as a patch — re-open it:

```bash
scripts/release.sh --open 2.0.0
```

On a clean tree, `--open` runs `scripts/release-open.ts`, which sets the version in the three manifests and regenerates `PACKAGE_VERSION`, `PHAX_RELEASE` and `CURRENT_STAMPS`. It then regenerates the usage spec and the CLI docs and commits `chore: open v2.0.0`. It never touches the ledger or a snapshot. It refuses, before writing anything, a version that is not `MAJOR.MINOR.PATCH`, one not newer than the ledger's last entry (`<v> is not newer than the last release <last> — nothing opened`), and the version already opened (`<v> is already the opened version — nothing opened`). It cannot be combined with `--rehearse`.

`--open` commits but does not push, since it would push whatever branch you are on: follow it with `git push` or a pull request. Only the opening that `release.sh` makes after a release pushes.

### 3. Watch the release workflow

The `release.yml` workflow triggers automatically on the pushed tag. In order, it:

1. Checks that `docs/releases/<version>.md` exists and is not empty, naming the file and `scripts/release-cut.ts` if not. After the install, it writes the GitHub release body from that file (`scripts/release-notes.ts --github-body`), so a body over GitHub's limit fails before anything is built.
2. Runs the full gate (typecheck, tests, lint, build, docs site build, Deno smoke). The build also builds the schemas package and its JSON Schemas.
3. Cross-compiles four platform binaries with SHA-256 checksums.
4. Smoke-tests the schemas package under Node 20 (`scripts/schemas-smoke.ts`): it packs the built package, installs the tarball into an empty project, and runs the schemas spec's `read-record.mjs` consumer against a made-up phase record on a `phax/records/v1` branch. It also checks the installed version, one JSON Schema per format, and that `node_modules` holds only the package, `effect` and `effect`'s dependencies. CI runs the same smoke on every push and pull request.
5. Prepares the npm wrapper: `npm/package.json` is set to the tag's version, and `npm/README.md` is written from `README.md` with its relative links pinned on GitHub at the tag (the file is ignored by Git and shipped in the package).
6. Checks that `npm/package.json` and `packages/schemas/package.json` both carry the tag's version, and that the last entry of the release ledger `packages/schemas/releases.json` equals it. Only the cut appends the ledger, so a tag on a commit that is not a release commit fails here — an opening commit included, whose manifests name the tag's version while its ledger ends earlier.
7. Deploys docs.phax.run, after the version check and before any npm stage publish, in four steps:
   - **guard**: refuses the build if it would stop serving a schema URL listed in the live index at `https://docs.phax.run/schemas/index.json`;
   - **upload**: uploads the built site as a version with the preview alias `vX-Y-Z`, so its preview URL names the release;
   - **check**: fetches the preview URL and requires the release's schema and a page showing `vX.Y.Z`;
   - **promote**: makes that version the live site at docs.phax.run.

   A failed guard, upload or check stages nothing, creates no GitHub Release and leaves the previous site serving. It can leave at most an unpromoted version with its preview URL. The remedy is the same as for any failed release: fix the cause, then delete and re-push the tag (below).
8. Stage-publishes `@lbdremy/phax-schemas`, then `@lbdremy/phax`, with `npm stage publish --access public --provenance`.
9. Creates the GitHub Release and uploads binaries and checksums. The release body is the short form of `docs/releases/<version>.md`: the notes without their examples (the `Now:` blocks and the `Before` folds), with a link to the release's page on the docs site. GitHub generates no notes.

A failed gate, smoke or version check stages nothing. The stage publishes themselves can still fail (a registry error, a misconfigured trusted publisher): the schemas package goes first, so a failure there stages nothing, and a failure on the wrapper leaves only a staged schemas package, which nobody can install until you approve it. Fix the cause, then delete and re-push the tag (below).

### 4. Approve both staged packages

Stage publish does not make a package installable. Approve each staged version by hand on npm:

- https://www.npmjs.com/package/@lbdremy/phax
- https://www.npmjs.com/package/@lbdremy/phax-schemas

### 5. Verify

- GitHub shows a **Verified** badge on the tag (requires the signing key registered on GitHub)
- The GitHub Release page lists all four binaries and their `.sha256` files, and its body is the release's notes in short form (without the `Now:` blocks and the `Before` folds), with a working link to `https://docs.phax.run/releases/X-Y-Z`
- `https://docs.phax.run/releases/X-Y-Z` shows the full notes, with each surface's `Now:` example and its `Before` fold
- Both npm packages show the tag's version once approved
- `package.json`, `npm/package.json` and `packages/schemas/package.json` all carry the tag's version in the release commit, and the ledger's last entry is the tag's version
- The commit after the release commit on main is the opening, `chore: open vX.(Y+1).0`, and the three manifests name that version
- docs.phax.run shows vX.Y.Z, and `https://docs.phax.run/schemas/registry/X.Y.Z.json` answers 200
- The previous release's preview URL still shows its own version
- Before approving the npm packages, open the release's preview URL (the one the upload step prints for the `vX-Y-Z` alias) and check the site as a reader would

## Release notes

The release cut writes the release's notes to `docs/releases/<X.Y.Z>.md`, in the release commit. They are written from what the release's runs delivered, not from the pull requests:

- `## Highlights`, one line per completed spec: its name and its guiding rule folded to one line, else the lede of its title, else its name alone;
- `## Upgrading`, the release's `### X.Y.Z` entry of `docs/upgrading.md`;
- `## What's new`, each completed spec with its lede and guiding rule, and each `cli:`, `config:` or `file:` surface of its sidecar as a bullet: its summary, its name, the current example under `Now:`, and the earlier one folded under `Before` when there was one;
- `## Also in this release`, each plan without a spec;
- `## Fixes` and `## Other`: the commits made outside any run, `fix` under Fixes, `test`, `chore`, `docs`, `refactor`, `style`, `build` and `ci` nowhere, and any other type, or a subject with no type, under Other.

### Where the notes come from

The previous release is the ledger's greatest release below the one being cut, and the range starts at its tag `v<previous>`, so the clone needs the tags (`git fetch --tags`). The runs of the range are the distinct `Short-Name` values of the non-merge commits that carry both a `Run-Id` and a `Short-Name` trailer. Each run is matched to the plan it completed: a plan archived under `docs/plans/archive/` in the range, with status `Completed`, whose run short name equals the trailer. The plan's `source-spec` names the spec, and `completes-spec: true` announces that spec in full, from its sidecar (title, guiding rule, surfaces). A plan with `completes-spec: false` is not announced: the notes announce a spec only once a plan completes it. Its run's commits still belong to its run, so they are listed neither under Fixes nor under Other, and its spec is announced in full by the release that ships the plan with `completes-spec: true`.

A review fix pushed onto a run's pull request branch carries `Short-Name: <run short name>` and no `Run-Id`. It joins that run and is listed nowhere. A review fix whose trailer was forgotten is listed by its type, like any commit without a run: `fix` under Fixes, `test`, `chore`, `docs`, `refactor`, `style`, `build` and `ci` nowhere, and any other under Other.

### Refusals and warnings

The source-spec refusals (in neither folder, not a spec path), the spec-sidecar refusals (not JSON, does not decode), the spec's missing-title refusal and the no-sidecar warning concern only a spec announced in full.

The cut refuses, and writes nothing, on a sidecar that does not decode, a plan with no frontmatter or title, a source spec found nowhere, two completed plans with the same run short name, a spec announced in full twice, a surface still holding the placeholder summary, a previous release with no tag, a missing `docs/upgrading.md`, an existing `docs/releases/<version>.md` and a GitHub body over the limit. The CI rehearsal runs the same cut on every push and pull request, so one broken document turns every pull request red until it is fixed.

It only warns, on stderr, when `docs/upgrading.md` has no entry for the version (the notes then have no Upgrading section), when a spec has no sidecar, when a run names no completed plan or a completed plan is named by no run, when a `Short-Name`-only commit names no run of the range, and when a link leaves the repository. Write the `### X.Y.Z` entry of `docs/upgrading.md` before the cut, if the release asks anything of its users.

### Preview

```bash
pnpm release:notes
```

prints the notes of the opened version, and their warnings, without writing anything. Read them before cutting.

### Where the notes are published

- The GitHub Release body is the notes' short form: the file without its examples (the `Now:` blocks and the `Before` folds), with a link to the release's page on the docs site. GitHub caps a body at 125,000 characters, and the workflow fails before building anything if the short form exceeds it. `pnpm exec tsx scripts/release-notes.ts --github-body docs/releases/<X.Y.Z>.md`, run from the repository root, prints it: the file is read relative to the current directory.
- The docs site renders the full file as one page per release, at `/releases/<X-Y-Z>`, newest first under Releases. No release edits the page map.

## Redeploying the docs site by hand

To republish a released tag's site as it was at that tag, for example after a failed promote or a manual change on Cloudflare:

```bash
gh workflow run docs-deploy.yml -f tag=vX.Y.Z
```

The `docs-deploy.yml` workflow checks out the tag, checks that `package.json` and the ledger's last entry name the tag's version, so a tag on an opening commit is refused, builds the site, and runs the same guard, preview upload, preview check and promotion as the release. It stages nothing on npm and creates no GitHub Release. The guard refuses the redeploy if it would drop a schema URL that docs.phax.run serves, so once a newer release is live, an older tag cannot be redeployed. A fix to the site on `main` reaches docs.phax.run only with the next release. To look at the site locally before redeploying, run `pnpm site:preview`, which serves the built site from `site/doc_build`.

## macOS Gatekeeper

macOS binaries are not yet code-signed or notarized. Users who download the binary directly will be blocked by Gatekeeper on first run. The workaround:

```bash
xattr -dr com.apple.quarantine /usr/local/bin/phax
```

The permanent fix requires an Apple Developer account ($99/year):

1. Obtain a **Developer ID Application** certificate from the Apple Developer portal
2. Sign: `codesign --sign "Developer ID Application: ..." --options runtime phax-darwin-*`
3. Notarize: `xcrun notarytool submit phax-darwin-*.zip --apple-id ... --team-id ... --password ...`
4. Staple: `xcrun stapler staple phax-darwin-*`

This should be added to the release workflow once an Apple Developer account is available.

## Deleting and re-pushing a tag

If the release workflow fails and you need to retag the same version:

```bash
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
git tag -s v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```
