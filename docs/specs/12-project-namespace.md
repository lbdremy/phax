# Project Namespaces and Repo-Scoped Run Names

Status: Draft

Date: 2026-06-15

Audience: implementation planning with Claude Code

Scope: functional behavior only

## 1. Context

PHAX currently creates a short name for each run when the run starts. This short name is generated from the name found in the plan document.

This works while PHAX is used in a single project, but it becomes fragile as soon as different repositories can produce runs with the same short name. For example, two unrelated projects may both have a run named `fixbug`.

The expected behavior is that PHAX treats runs as belonging to a project namespace. The short name remains convenient locally, but the canonical identity of a run is scoped by the project that created it.

The namespace must also be visible in the user interface. Users should not have to infer which project a run belongs to from context alone.

## 2. Problem

Without a project namespace:

- two different repositories can create runs with the same short name;
- resume-like commands may target the wrong run;
- `phax ls` and equivalent listings become harder to read;
- run identity is not explicit enough for long-lived sessions;
- user-facing commands become ambiguous when used outside the original repository;
- copied run names from command outputs may be incomplete or ambiguous.

The issue is not the existence of short names. Short names are useful. The issue is that they are currently globally ambiguous and too implicit when displayed.

## 3. Product goal

Introduce a project namespace so that every PHAX run has a stable, unambiguous functional identity.

A user working inside a PHAX repository should still be able to use short names naturally:

- `phax resume fixbug`

However, PHAX should display the resolved run identity as a qualified name everywhere:

- `louloupapers.fixbug`

When PHAX is not able to infer the current project context, the user must provide an explicit project-qualified run reference, or PHAX must fail with a clear message.

## 4. Terminology

### Project namespace

A stable user-facing name representing the PHAX project/repository that owns a run.

Examples:

- `louloupress`
- `louloupapers`
- `steme-doc`
- `phax`

### Run short name

The local run name generated when a run starts, currently derived from the plan document name.

Example:

- `fixbug`

### Qualified run name

The full user-facing identity of a run, composed from the project namespace and the run short name.

Example:

- `louloupapers.fixbug`

The separator should be `.` unless implementation constraints require another separator. The functional expectation is that the qualified name is readable, copyable, and easy to type.

## 5. Project namespace source

### 5.1 The namespace comes from `phax.json`

The project namespace must be defined in the PHAX project configuration file.

Recommended field:

`namespace`

Example:

`namespace: "louloupapers"`

The config value is the source of truth for the project namespace.

PHAX must not rely only on the repository folder name, Git remote name, package name, or plan name to identify the namespace once the project is configured.

### 5.2 `phax.json` must support a namespace field

If the current PHAX config schema does not already contain a namespace-like field, the schema must be extended with one.

This field should be considered part of the project identity, not an optional display label.

### 5.3 Namespace value requirements

The namespace should be stable, human-readable, and CLI-friendly.

Functional constraints:

- it must be explicit in `phax.json`;
- it should use a simple slug format;
- it should avoid spaces and ambiguous punctuation;
- it should be suitable for display in command outputs;
- it should be suitable for composing qualified run names.

Examples of valid namespace values:

- `louloupress`
- `louloupapers`
- `steme-doc`
- `phax`

### 5.4 Missing namespace behavior

If PHAX is run inside a repository that has a PHAX config file but no namespace field, commands that need a project identity must fail early with a clear message.

Recommended message:

`PHAX project namespace is missing in phax.json. Add a namespace field, for example: namespace: "louloupapers".`

PHAX should not silently infer a namespace from the folder name for normal command execution.

For user convenience, `phax init` or a future migration command may suggest a namespace derived from the repository name, but the explicit value must still be written to the config.

## 6. Functional requirements

### 6.1 Every run belongs to a project namespace

When PHAX starts a run, it must associate the run with the current project namespace from `phax.json`.

The run must then be stored and displayed as belonging to that namespace for its entire lifetime.

Once a run has started, its namespace must not silently change, even if the repository folder is renamed later.

If the config namespace changes after a run has started, existing runs keep their original namespace unless an explicit migration action is introduced later.

### 6.2 The short name remains local to a project

The existing short name behavior should remain useful inside a project.

A short name only needs to be unique within its project namespace.

This means the following situation is valid:

- `louloupress.fixbug`
- `louloupapers.fixbug`

These are two different runs, even though they share the same short name.

### 6.3 PHAX resolves unqualified names from the current repository

When a user runs a command from inside a PHAX project, PHAX must infer the current project namespace from `phax.json`.

Example:

- current repository namespace: `louloupapers`
- user command: `phax resume fixbug`
- resolved run: `louloupapers.fixbug`

PHAX must not search every project namespace for `fixbug` when the current project namespace is known. The local project context is the default scope.

### 6.4 PHAX must display qualified names by default

Even when the user enters an unqualified short name, PHAX must display the resolved run as a qualified name.

Example:

Command:

`phax resume fixbug`

Output:

`Resuming run louloupapers.fixbug`

The qualified name must be the default visible identity in user-facing output.

### 6.5 All run references in command outputs use qualified names

Every place where PHAX currently displays or references a run short name must be updated to display the qualified run name instead.

This applies to, at minimum:

- `phax ls`;
- resume output;
- enter/session output;
- last-run output;
- run-start output;
- run-completion output;
- error messages;
- ambiguity messages;
- archive/listing output;
- any user-facing summary where a run name is shown.

The rule is simple: if PHAX shows a run identity to the user, it should show `namespace.shortname`, not only `shortname`.

### 6.6 `phax ls` must make namespaces visible by default

`phax ls` must show qualified run names by default.

The first or primary identity shown for each run should be the qualified run name.

Example output shape:

`louloupapers.fixbug   running   phase 2/5   /path/to/louloupapers`

If `phax ls` uses a table, the table may also include separate `namespace` and `short name` columns, but it must still expose a copyable qualified name.

Recommended columns:

- qualified name;
- status;
- current phase;
- repository path or project location;
- last updated time when available.

The user should be able to copy the qualified name from `phax ls` and use it directly in a resume-like command.

### 6.7 PHAX must fail early outside a PHAX project context

For commands that require a current project context, PHAX must check that the command is being executed inside a PHAX-enabled repository.

If no PHAX project context can be found, PHAX must stop immediately with a clear message.

The message should explain that PHAX could not find the current project context and that the command must be run from a PHAX repository or with an explicitly qualified run name when that command supports it.

Example message:

`No PHAX project context found. Run this command from a PHAX repository, or use a qualified run name such as louloupapers.fixbug when targeting an existing run.`

### 6.8 Starting a new run requires a PHAX project context

A new run must only be started from inside a PHAX project.

If the user runs `phax run` outside a PHAX project, PHAX must fail.

If the user runs `phax run` inside a PHAX project without a configured namespace, PHAX must fail.

PHAX should not create a run under a guessed or global namespace.

### 6.9 Resuming an existing run uses local scope by default

Inside a PHAX project:

- `phax resume fixbug` resolves to the current project namespace;
- `phax resume louloupapers.fixbug` resolves to the explicitly qualified run;
- if the explicit namespace differs from the current project namespace, PHAX should make the target explicit in the output before resuming.

Outside a PHAX project:

- `phax resume fixbug` must fail because the namespace is ambiguous;
- `phax resume louloupapers.fixbug` may be accepted for existing runs, provided PHAX has enough run metadata to locate the run safely.

If PHAX cannot safely locate the run from the qualified name, it must fail with a clear message rather than guessing.

### 6.10 Other existing-run commands follow the same resolution model

The same namespace behavior should apply consistently to commands that target existing runs or sessions, such as:

- `resume`
- `enter`
- `enter last`
- `session`
- `session last`
- any equivalent future command that targets an already-created run

Inside a project, unqualified names are scoped to the current namespace.

Outside a project, unqualified names are rejected.

Qualified names are accepted only when PHAX can safely resolve the target run.

All outputs from these commands should display the qualified run name.

### 6.11 “last” commands are scoped by project when run inside a project

When a user runs a command such as `phax resume last` or `phax enter last` from inside a PHAX project, “last” must mean the last relevant run in the current project namespace.

It must not mean the last run across all PHAX projects.

The output must still show the qualified run name.

Example:

`Entering last run for louloupapers: louloupapers.fixbug`

If the user wants a global last-run behavior later, that should be introduced as an explicit separate behavior, not as the default.

### 6.12 Collisions inside the same project namespace must be handled explicitly

PHAX must prevent two active or archived runs in the same project namespace from silently sharing the same short name.

If a generated short name already exists in the same namespace, PHAX must either:

- generate a clear unique variant, such as `fixbug-2`; or
- fail and ask the user to provide a different run name if a future option allows manual naming.

There must never be silent overwrite or ambiguous resolution inside the same project namespace.

### 6.13 Global listings must show qualified names

When PHAX displays runs across multiple projects, it must show the qualified run name.

A listing should make it easy to distinguish:

- project namespace;
- short name;
- qualified name;
- status;
- current phase;
- repository path or project location when available.

The user should be able to copy the qualified name from the listing and use it in a resume-like command.

## 7. User-facing examples

### Example 1 — Resume from inside the owning repository

Current directory belongs to the `louloupapers` PHAX project.

Config contains:

`namespace: "louloupapers"`

Command:

`phax resume fixbug`

Expected behavior:

PHAX resolves the command as:

`louloupapers.fixbug`

Output uses the qualified name:

`Resuming run louloupapers.fixbug`

The run resumes normally.

### Example 2 — Same short name in two projects

Existing runs:

- `louloupress.fixbug`
- `louloupapers.fixbug`

Current directory belongs to `louloupapers`.

Command:

`phax resume fixbug`

Expected behavior:

PHAX resumes `louloupapers.fixbug`.

It does not ask the user to choose between both projects because the current repository provides the namespace.

### Example 3 — `phax ls` shows qualified names

Existing runs:

- `louloupress.fixbug`
- `louloupapers.fixbug`

Command:

`phax ls`

Expected behavior:

The listing displays the qualified names directly.

Example:

`louloupress.fixbug    stopped    phase 3/5   /repos/louloupress`

`louloupapers.fixbug   running    phase 2/4   /repos/louloupapers`

The output must not display only `fixbug` as the primary identity.

### Example 4 — Unqualified resume outside a PHAX project

Current directory does not belong to a PHAX project.

Command:

`phax resume fixbug`

Expected behavior:

PHAX fails with an ambiguity message.

It must not guess which project owns `fixbug`.

### Example 5 — Qualified resume outside a PHAX project

Current directory does not belong to a PHAX project.

Command:

`phax resume louloupapers.fixbug`

Expected behavior:

PHAX may resume the run if the run metadata is sufficient to locate the session safely.

If not, PHAX fails with an actionable message explaining that the user should run the command from the owning repository.

### Example 6 — Starting a run outside a PHAX project

Current directory does not belong to a PHAX project.

Command:

`phax run`

Expected behavior:

PHAX fails immediately.

It explains that new runs must be launched from a PHAX repository.

### Example 7 — Missing namespace in config

Current directory belongs to a PHAX repository, but `phax.json` has no namespace field.

Command:

`phax run`

Expected behavior:

PHAX fails before creating the run.

It explains that `phax.json` must define a namespace.

## 8. User experience requirements

### Clear command output

When PHAX starts, resumes, enters, or displays a run, it must include the qualified run name in the output.

Example:

`Resuming run louloupapers.fixbug`

### Consistent naming across the CLI

The same run should not appear as `fixbug` in one command and `louloupapers.fixbug` in another.

The qualified name is the default display form.

The short name may still be accepted as user input when the current project namespace is known, but output should normalize to the qualified name.

### Clear ambiguity errors

If a user provides an unqualified short name outside a project context, PHAX must not guess.

It should explain the problem and, when possible, show matching qualified candidates.

Example:

`Run name fixbug is ambiguous outside a PHAX project. Matching runs: louloupress.fixbug, louloupapers.fixbug. Use a qualified run name.`

### Clear project-context errors

If a command requires a PHAX project context and none is found, the error must be immediate and understandable.

The user should not see a later low-level failure caused by missing config, missing plan, or missing repository state.

### Clear config errors

If `phax.json` exists but the namespace is missing or invalid, PHAX must report that specific problem.

It should not report a generic “run not found” or “project not found” error.

## 9. Migration behavior

Existing runs that do not yet have a namespace should be handled safely.

Recommended functional behavior:

- if the original repository path is known and its `phax.json` contains a namespace, PHAX assigns that namespace to the legacy run;
- if the original repository path is known but the config has no namespace, PHAX reports that the run cannot be fully qualified until the project config is updated;
- if the original repository path is unknown, PHAX marks the run as legacy/unscoped;
- unscoped legacy runs must not be silently mixed with namespaced runs;
- listings should make legacy/unscoped runs visible so the user can understand why they require special handling.

Legacy runs should not block the introduction of explicit namespaces, but they must not create ambiguous behavior.

## 10. Non-goals

This spec does not require:

- changing the plan document format;
- changing how the first short name is derived from the plan;
- designing a full global project registry UI;
- supporting new runs outside a PHAX repository;
- introducing multi-project orchestration;
- exposing technical storage details to the user;
- defining the exact config-file syntax beyond the functional requirement that a namespace exists in the PHAX project config.

## 11. Acceptance criteria

### Namespace configured in project config

Given a PHAX project config, the config exposes an explicit namespace field.

When PHAX starts a run from that project, the run is associated with that namespace.

### Local resolution

Given a PHAX project with namespace `louloupapers` and a run named `fixbug`, when the user runs `phax resume fixbug` from inside that repository, PHAX resumes `louloupapers.fixbug`.

### Qualified output after local resolution

Given the user runs `phax resume fixbug` inside the `louloupapers` project, PHAX displays `louloupapers.fixbug` in the output.

It does not display only `fixbug` as the run identity.

### `phax ls` visibility

Given runs exist across several projects, when the user runs `phax ls`, PHAX displays qualified names such as `louloupress.fixbug` and `louloupapers.fixbug`.

The primary visible run identity is not the unqualified short name.

### Cross-project collision prevention

Given two projects with runs named `fixbug`, when the user runs `phax resume fixbug` inside one of those projects, PHAX resumes the run from the current project only.

### Outside-context ambiguity

Given the user is outside any PHAX project, when they run `phax resume fixbug`, PHAX fails and asks for a qualified run name.

### Qualified reference

Given an existing run `louloupapers.fixbug`, when the user runs a supported command with `louloupapers.fixbug`, PHAX resolves that exact run and does not search by short name alone.

### Start-run protection

Given the user is outside a PHAX project, when they run `phax run`, PHAX fails before creating any run metadata.

### Missing namespace protection

Given the user is inside a PHAX project whose config has no namespace field, when they run `phax run`, PHAX fails before creating any run metadata and explains that the namespace must be added to `phax.json`.

### Last-run scoping

Given the user is inside the `louloupapers` project, when they run a `last` command, PHAX selects the last relevant run in `louloupapers`, not the last global run across every namespace.

The output displays the selected run as a qualified name.

## 12. Implementation-planning note

The implementation plan should determine the exact storage model, schema update, validation rules, and resolution algorithm.

The functional contract is that project namespaces make run identity unambiguous while preserving the local convenience of short names inside the current PHAX repository.

The namespace must be part of the PHAX project config, and the qualified run name must be the default visible identity across the CLI.
