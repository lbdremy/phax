# Init Command and Local JSON Schema Reference

## Status

Functional specification.

This document defines a minimal `phax init` command for initializing PHAX configuration in a project.

It also captures the unresolved schema-reference question that should be investigated during implementation planning.

## 1. Goal

PHAX should provide a simple initialization command for users starting to use PHAX in a project.

The command should create the project configuration file in JSON format.

The command should also ensure that the generated configuration includes a useful JSON Schema reference.

The current problem is that PHAX exposes a `$schema` property, but the referenced URL is not valid or does not point to a real schema.

The goal is to make the generated config file immediately useful in editors, with schema-backed validation and completion when possible.

## 2. User command

PHAX should expose:

```bash
phax init
```

The command is intended for first-time setup in an existing project.

It should create the canonical PHAX project configuration file.

The exact config filename and path should follow the current PHAX architecture. If the current canonical file is already established, `phax init` should use it rather than introduce a new name.

## 3. Generated configuration

`phax init` should generate a valid minimal PHAX configuration.

The generated file should be:

- small;
- readable;
- valid JSON;
- compatible with PHAX defaults;
- suitable as a starting point;
- safe to commit in the project repository.

The generated config should not include every possible option.

It should include only the minimum useful structure required for a new project.

## 4. Existing file behavior

`phax init` should not silently overwrite an existing PHAX configuration file.

If the config already exists, PHAX should report that the project is already initialized.

The command may later support an explicit overwrite/update mode, but that is not required for the first version.

## 5. JSON Schema requirement

The generated configuration should include a `$schema` property if PHAX supports schema-backed configuration.

The `$schema` value must point to an actual schema that exists and matches the installed PHAX version.

The current invalid schema URL should be replaced.

The implementation plan should investigate the best schema-reference strategy for PHAX’s distribution model.

## 6. Schema packaging requirement

The JSON Schema should be packaged with PHAX.

The schema should version with the PHAX release.

The intended outcome is:

```
PHAX version N
  → ships config schema version N
  → phax init references schema version N
  → editor validation matches the installed PHAX version
```

This avoids pointing users to a stale or broken remote schema.

## 7. Open schema-reference question

This spec intentionally does not decide the final `$schema` reference format.

The implementation planning phase must investigate the best approach.

The main question is:

```
How should a PHAX project config reference the JSON Schema when PHAX may be installed globally, locally through npm, or distributed as a standalone CLI binary?
```

Possible directions to evaluate include:

- referencing a schema file bundled inside an npm package;
- copying the schema into the project during `phax init` and referencing the copied local file;
- using a stable remote schema URL;
- using a versioned remote schema URL;
- using a hybrid strategy depending on installation mode;
- avoiding `$schema` if no robust editor-compatible strategy exists.

The planning agent should not assume the answer.

It should verify what works with common editor JSON Schema resolution behavior and PHAX’s actual packaging model.

## 8. Global CLI concern

PHAX may be installed globally.

This creates an open design question.

If the schema lives inside the installed package, the generated project config may not have a stable relative path to that schema.

The planning phase should determine whether this is a real problem and propose the least fragile solution.

The spec does not require a specific answer.

## 9. npm package schema concern

Some tools reference a JSON Schema directly from the installed npm package so that the schema matches the package version.

PHAX should evaluate whether this pattern is applicable.

The planning phase should answer:

- whether this works when PHAX is installed locally;
- whether this works when PHAX is installed globally;
- whether this works when PHAX is distributed as a compiled CLI;
- whether common editors resolve such references correctly;
- whether PHAX should instead copy the schema into the project.

## 10. Validation behavior

After generating the configuration file, PHAX should be able to validate it.

The first version of `phax init` should at least ensure that the generated file is valid according to PHAX’s own config parser.

If schema validation is already part of the current architecture, the generated config should pass it.

## 11. Output and diagnostics

After successful initialization, PHAX should print:

- the created config file path;
- whether a schema reference was added;
- what schema strategy was used;
- the next useful command for the user.

Example intent:

```
Created PHAX config: phax.json
Schema: bundled local schema reference
Next: edit the config, then run phax plan or phax run according to your workflow.
```

The exact next command should match the current PHAX CLI workflow.

## 12. Planning agent responsibility

When implementing this spec, the planning agent must inspect the current PHAX architecture before deciding:

- the canonical config filename;
- where the schema currently lives;
- how the schema is currently generated or packaged;
- how `$schema` is currently written;
- how PHAX is distributed;
- how global vs local installation affects schema references;
- whether a local copied schema is preferable;
- whether a remote versioned schema is needed;
- whether the schema should be included in npm package files;
- whether release automation must validate that the schema is included.

If multiple schema-reference strategies are reasonable, the planning agent should present the options and ask the user to choose.

## 13. Non-goals

This feature does not define:

- a complete config schema redesign;
- every PHAX configuration option;
- migration of existing configs;
- interactive setup flows;
- remote schema hosting details;
- npm package implementation details;
- binary packaging implementation details.

Those should be handled during planning if needed.

## 14. Acceptance criteria

This feature is complete when:

1. PHAX exposes a `phax init` command.
2. `phax init` creates the canonical PHAX project configuration file.
3. The generated config is valid JSON.
4. The generated config is minimal and useful.
5. `phax init` does not silently overwrite an existing config.
6. The generated config includes a valid `$schema` reference if PHAX keeps schema-backed config.
7. The schema reference no longer points to a broken or empty URL.
8. The JSON Schema is packaged or made available in a way that matches the installed PHAX version.
9. The planning phase investigates global CLI, local npm, and standalone binary constraints before choosing a schema strategy.
10. If schema strategy options remain ambiguous, the planning agent asks the user to choose.
11. The release process ensures the schema is present wherever the chosen strategy requires it.
12. The generated config passes PHAX validation.
13. The command prints clear output showing what was created.

## 15. Product summary

PHAX should make project setup explicit and reliable.

The first project command should be:

```bash
phax init
```

It should create a valid minimal JSON config and fix the broken schema-reference problem.

The schema strategy remains an implementation-planning question because PHAX may be installed locally, globally, or as a standalone CLI.

Core rule:

```
A PHAX config generated by PHAX should reference a real schema that matches the PHAX version the user is actually using.
```
