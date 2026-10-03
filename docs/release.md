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

## Release process

A release ships two npm packages in lockstep, at the tag's version:

- `@lbdremy/phax`, the launcher for the release binaries (`npm/`);
- `@lbdremy/phax-schemas`, the persisted-format schemas (`packages/schemas/`).

### 1. Ensure the branch is ready

```bash
pnpm check:full && pnpm build
```

### 2. Cut, commit, tag and push

```bash
scripts/release.sh 1.2.3
```

The version must be `MAJOR.MINOR.PATCH` and newer than the current one — pre-release suffixes are not supported by the release workflow. On a clean tree, `release.sh`:

1. runs `scripts/release-cut.ts`, which:
   - sets `version` in `package.json`, `npm/package.json` and `packages/schemas/package.json`;
   - renames every `packages/schemas/snapshots/<format id>/next.schema.json` to `<version>.schema.json`, so each format's current shape is named by the release;
   - regenerates `PACKAGE_VERSION`, `FIRST_SUPPORTED_RELEASE` and `CURRENT_SHAPES` (`packages/schemas/src/generated/index.ts`) and `src/schemas/release.ts`;
2. regenerates the usage spec and the CLI docs;
3. stages exactly the paths the cut changed (renames included) and the regenerated files, and commits `chore: release v1.2.3`;
4. creates the signed tag `v1.2.3` and pushes the commit and the tag.

To see what a cut changes without touching the tree, dry-run it on a copy:

```bash
pnpm exec tsx scripts/release-cut.ts 1.2.3 --root <copy of the tree>
```

### 3. Watch the release workflow

The `release.yml` workflow triggers automatically on the pushed tag. In order, it:

1. Runs the full gate (typecheck, tests, lint, build, Deno smoke). The build also builds the schemas package and its JSON Schemas.
2. Cross-compiles four platform binaries with SHA-256 checksums.
3. Smoke-tests the schemas package under Node 20 (`scripts/schemas-smoke.ts`): it packs the built package, installs the tarball into an empty project, and runs the schemas spec's `read-record.mjs` consumer against a made-up phase record on a `phax/records/v1` branch. It also checks the installed version, one JSON Schema per format, and that `node_modules` holds only the package, `effect` and `effect`'s dependencies. CI runs the same smoke on every push and pull request.
4. Prepares the npm wrapper (`npm/package.json` is set to the tag's version).
5. Checks that `npm/package.json` and `packages/schemas/package.json` both carry the tag's version. `release.sh` already set the second one in the release commit, so a tag on a commit `release.sh` did not make fails here.
6. Stage-publishes `@lbdremy/phax-schemas`, then `@lbdremy/phax`, with `npm stage publish --access public --provenance`.
7. Creates the GitHub Release and uploads binaries and checksums.

A failed gate, smoke or version check stages nothing. The stage publishes themselves can still fail (a registry error, a misconfigured trusted publisher): the schemas package goes first, so a failure there stages nothing, and a failure on the wrapper leaves only a staged schemas package, which nobody can install until you approve it. Fix the cause, then delete and re-push the tag (below).

### 4. Approve both staged packages

Stage publish does not make a package installable. Approve each staged version by hand on npm:

- https://www.npmjs.com/package/@lbdremy/phax
- https://www.npmjs.com/package/@lbdremy/phax-schemas

### 5. Verify

- GitHub shows a **Verified** badge on the tag (requires the signing key registered on GitHub)
- The GitHub Release page lists all four binaries and their `.sha256` files
- Both npm packages show the tag's version once approved
- `package.json`, `npm/package.json` and `packages/schemas/package.json` all carry the tag's version in the release commit

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
