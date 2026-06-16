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

## Release process

### 1. Ensure the branch is ready

```bash
pnpm test && pnpm build
```

### 2. Create a signed annotated tag

```bash
git tag -s v1.2.3 -m "Release v1.2.3"
```

Tag format must be `vMAJOR.MINOR.PATCH` — pre-release suffixes are not supported by the release workflow.

### 3. Push the tag

```bash
git push origin v1.2.3
```

### 4. Watch the release workflow

The `release.yml` workflow triggers automatically on the pushed tag. It:

1. Runs the full gate (typecheck, tests, lint, build, Deno smoke)
2. Cross-compiles four platform binaries with SHA-256 checksums
3. Version-matches `npm/package.json` to the tag and runs `npm publish --dry-run`
4. Creates the GitHub Release and uploads binaries and checksums

### 5. Verify

- GitHub shows a **Verified** badge on the tag (requires the signing key registered on GitHub)
- The GitHub Release page lists all four binaries and their `.sha256` files
- `npm/package.json` version matches the tag (transiently updated during the workflow, not committed back)

## Deleting and re-pushing a tag

If the release workflow fails and you need to retag the same version:

```bash
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
git tag -s v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```
