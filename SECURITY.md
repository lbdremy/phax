# Security policy

## Reporting a vulnerability

Report it privately, through GitHub: the repository's **Security** tab, then **Report a vulnerability** ([direct link](https://github.com/lbdremy/phax/security/advisories/new)). Please do not open a public issue for it.

Say which version you ran (`phax --version`), what you did, what happened, and what an attacker could gain. A plan, a `phax.json` or a command that reproduces it helps most.

You get an acknowledgement within 7 days. phax has one maintainer, so there is no promised date for the fix; you are kept informed until it ships, and credited in the advisory if you wish.

## Supported versions

Only the latest release. A fix ships in the next release, with no backport to older versions; [docs/upgrading.md](docs/upgrading.md) covers moving to it.

## Scope

In scope: the `phax` CLI and its release binaries, the npm packages `@lbdremy/phax` (the launcher) and `@lbdremy/phax-schemas`, and the release workflow that builds them. That includes how phax confines the agent CLIs it drives: a phase's agent reaching what its security mode should deny is a phax vulnerability. [docs/security.md](docs/security.md) describes what each mode enforces, per provider.

Out of scope: a vulnerability in Claude Code, Codex or Mistral Vibe themselves. Report it to their vendor.

## Verifying what you install

- **npm packages** are published from the release workflow with provenance: `npm audit signatures` checks it after an install.
- **Release binaries** come with a `.sha256` file each, which the npm launcher checks before running a binary it downloads.
