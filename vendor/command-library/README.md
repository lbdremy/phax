# The command library, as written (Effect 4)

A verbatim copy of the operator's command library: the contract (`cli-command/`, with its
conformance suite) and its runner over Commander (`cli-command-commander/`), at its
2026-11-03 revision. The operator, its author, brings it under phax's Apache-2.0 licence.

It is here only as the source the spec `command-contracts` ports to Effect 3 into phax's own
source. Nothing builds, lints, formats, tests or imports it: it is outside every tool's paths
(`tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `knip.json`) and ignored by oxlint
and oxfmt. The run that ports it deletes this folder.
