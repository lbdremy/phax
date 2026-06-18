# Locked Agent Binding for Phase Sessions

## 1. Context

Phax currently provides commands such as:

- `enter`
- `enter last`
- `session`
- `session last`

These commands work correctly with Claude session data, but they do not reliably work with Codex. Mistral support is uncertain and must be verified.

The problem appears broader than provider-specific session parsing. Today, Phax may rely too heavily on model routing when re-entering, resuming, or inspecting an already-launched phase. This is incorrect.

Once a phase has started, the agent/model used for that phase must become immutable for the lifetime of that phase session.

Model routing is only allowed before the phase starts, at the moment Phax decides which agent/model should execute the phase. After that decision, all commands that interact with the phase must use the locked agent binding recorded for that phase.

## 2. Goal

Ensure that every launched phase has a stable, persisted, provider-aware agent binding.

This binding must be used by all session-related commands, regardless of the current routing configuration or routing outcome.

The objective is to make session re-entry and session inspection reliable across Claude, Codex, and Mistral.

## 3. Problem Statement

Today, session commands appear to be coupled to Claude-specific session data.

This causes at least three issues:

1. `enter`, `enter last`, `session`, and `session last` work for Claude but fail or behave incorrectly for Codex.
2. Mistral support is not guaranteed and must be tested.
3. A phase may not have a strong guarantee that its selected model/provider remains fixed after launch.

The critical functional bug is this:

> Once a phase has been launched with a selected provider/model, Phax must never re-run model routing to decide how to enter, resume, inspect, or continue that same phase.
> 

## 4. Core Principle

A phase has two separate moments.

### 4.1 Phase launch

At phase launch time, Phax may use the model routing system to choose the provider/model.

Example:

```
Phase 3 starts
→ routing selects Codex
→ Phax launches the Codex session
→ Phax records the locked agent binding for Phase 3
```

### 4.2 Phase interaction after launch

After launch, Phax must use the recorded binding.

Example:

```
User runs `phax enter last`
→ Phax resolves the last launched phase
→ Phax reads the locked agent binding
→ Phax enters the Codex session
→ Phax does not ask the router again
```

## 5. Required Concept: Locked Agent Binding

Phax must persist an explicit locked agent binding for every launched phase.

Suggested name:

```tsx
PhaseAgentBinding
```

Suggested shape:

```tsx
type PhaseAgentBinding = {
  phaseRunId: string
  planRunId: string
  phaseIndex: number
  phaseName: string

  provider: "claude" | "codex" | "mistral"
  model: string

  adapter: "claude" | "codex" | "mistral"

  sessionId: string | null
  sessionHandle: string | null

  worktreePath: string
  cwd: string

  launchedAt: string

  lockSource:
    | "routing_at_phase_start"
    | "manual_override"
    | "legacy_inferred"

  status:
    | "launching"
    | "running"
    | "awaiting_manual_review"
    | "failed"
    | "completed"
    | "archived"
}
```

Exact field names can change during implementation, but the product-level requirement is stable:

> Phax must persist enough information to re-enter or inspect the exact provider session used for the phase, without consulting model routing again.
> 

## 6. Functional Requirements

### FR-1 — Lock the provider/model when a phase starts

When a phase starts, Phax must:

1. Resolve the provider/model using the existing routing logic.
2. Launch the phase using that provider/model.
3. Persist the locked agent binding.
4. Use this binding as the source of truth for all future interactions with that phase.

The binding must be written before the phase is considered successfully launched.

### FR-2 — Never reroute an already-launched phase

Once a phase has a locked binding, Phax must not call the model router for any of the following operations:

- `enter`
- `enter last`
- `session`
- `session last`
- `resume`
- any future command that reopens, inspects, or continues a launched phase

The router is only used for phases that have not yet started.

### FR-3 — Provider-specific session adapters

Phax must support provider-specific session handling through explicit adapters.

Required adapters:

- Claude
- Codex
- Mistral

Each adapter must be responsible for:

- launching a session
- resolving a session handle
- entering or re-entering the session
- displaying session information
- validating that the stored session metadata is usable

The Claude implementation must not be treated as the generic session model.

### FR-4 — Fix Codex session support

Codex must be explicitly tested and supported for:

- `enter`
- `enter last`
- `session`
- `session last`

If Codex uses a different session identifier, storage format, CLI invocation, working directory convention, or process model than Claude, this must be represented in the Codex adapter.

The expected behavior is not “Claude-compatible session data”.

The expected behavior is:

> Phax can enter and inspect a Codex phase session using the locked Codex binding created at phase launch.
> 

### FR-5 — Verify Mistral session support

Mistral support must be tested even if it appears to work.

The implementation must determine whether Mistral needs its own adapter behavior or whether it can share a generic adapter.

This must be verified with actual command-level tests.

### FR-6 — `enter` command behavior

`phax enter <target>` must:

1. Resolve the target phase/session.
2. Read the locked agent binding.
3. Dispatch to the correct provider adapter.
4. Enter the exact session associated with that phase.

It must not use current model routing.

If the phase has no locked binding, Phax must use the legacy behavior only through a controlled compatibility path.

### FR-7 — `enter last` command behavior

`phax enter last` must:

1. Resolve the most recent eligible launched phase.
2. Read its locked agent binding.
3. Enter that session through the correct provider adapter.

“Last” must be based on persisted Phax run/session state, not on the current router, current provider preference, or global default model.

### FR-8 — `session` command behavior

`phax session <target>` must display the session information for the resolved phase.

It should include at least:

- plan/run identifier
- phase name or index
- locked provider
- locked model
- adapter
- session id or handle if available
- worktree path
- phase status
- launch time

The output must make it clear which provider/model is locked for the phase.

### FR-9 — `session last` command behavior

`phax session last` must:

1. Resolve the most recent eligible launched phase.
2. Read its locked agent binding.
3. Display the persisted session data.

It must not infer the provider/model from current routing configuration.

### FR-10 — Legacy session compatibility

Existing runs may not have a locked agent binding.

For legacy runs, Phax must follow this behavior:

1. Try to infer the provider/model/session from existing persisted session metadata.
2. If inference succeeds, persist a `legacy_inferred` binding.
3. If inference fails, stop with a clear error.

Phax must not silently route a new model for an already-launched legacy phase.

Example error:

```
Cannot enter this phase because it was launched before phase agent bindings were introduced, and Phax could not infer its provider/session metadata.

Run `phax session <target> --debug` for available metadata.
```

### FR-11 — Manual overrides

If Phax supports manual model/provider overrides at phase launch, the override must be recorded in the locked binding.

After launch, the override behaves like any other lock.

The important distinction is:

- overrides may affect launch-time routing
- overrides must not affect already-launched phases

### FR-12 — Routing changes must not affect active phases

If the user changes routing configuration while a phase is running or after it has launched, existing phases must remain bound to their original provider/model.

Only future, not-yet-launched phases may use the new routing configuration.

## 7. State Model

A phase should be treated as having the following lifecycle:

```
planned
→ routing_resolved
→ launching
→ running
→ awaiting_manual_review
→ completed
→ archived
```

The provider/model must be locked when the phase enters `launching`.

After that point, it must not change.

## 8. Acceptance Criteria

### AC-1 — Claude still works

Given a phase launched with Claude, when the user runs:

```bash
phax enter last
```

Then Phax re-enters the Claude session using the persisted Claude binding.

### AC-2 — Codex enter works

Given a phase launched with Codex, when the user runs:

```bash
phax enter last
```

Then Phax re-enters the Codex session.

The command must not fail because it expects Claude session metadata.

### AC-3 — Codex session inspection works

Given a phase launched with Codex, when the user runs:

```bash
phax session last
```

Then Phax displays the Codex provider/model/session metadata.

### AC-4 — Mistral is verified

Given a phase launched with Mistral, the following commands must either work correctly or fail with a provider-specific unsupported message:

```bash
phax enter last
phax session last
```

A silent Claude-based fallback is not acceptable.

### AC-5 — Routing is not called after launch

Given a phase already launched with Codex, and given the router would now select Claude, when the user runs:

```bash
phax enter last
```

Then Phax must still enter the Codex session.

### AC-6 — Routing config changes do not affect existing phase sessions

Given a phase launched with Mistral, and given the user changes routing configuration to prefer Claude, then:

```bash
phax session last
```

must still show Mistral as the locked provider/model for that phase.

### AC-7 — Legacy phase behavior is explicit

Given an old phase without a locked binding, when the user runs:

```bash
phax enter last
```

Then Phax must either:

1. infer and persist a legacy binding, or
2. stop with a clear error.

It must not silently route to a new provider.

## 9. Test Plan

### Unit tests

Add tests for:

1. phase launch creates a locked binding
2. locked binding cannot be changed after launch
3. `enter` reads the locked binding
4. `enter last` reads the locked binding
5. `session` reads the locked binding
6. `session last` reads the locked binding
7. routing is only called before phase launch
8. routing is not called for already-launched phases
9. legacy inference creates a `legacy_inferred` binding when possible
10. legacy inference fails explicitly when impossible

### Provider adapter tests

Add provider-specific tests for:

#### Claude

- launch session
- enter session
- inspect session

#### Codex

- launch session
- enter session
- inspect session

#### Mistral

- launch session
- enter session if supported
- inspect session if supported
- return explicit unsupported errors if needed

### Integration tests

Create integration tests for at least these scenarios:

#### Scenario 1 — Claude phase

```
Launch phase with Claude
Run `phax session last`
Run `phax enter last`
Verify Claude adapter is used
```

#### Scenario 2 — Codex phase

```
Launch phase with Codex
Run `phax session last`
Run `phax enter last`
Verify Codex adapter is used
Verify no Claude session assumptions are used
```

#### Scenario 3 — Router changes after launch

```
Launch phase with Codex
Change routing so Claude would now be selected
Run `phax enter last`
Verify Codex is still used
Verify router is not called
```

#### Scenario 4 — Mistral phase

```
Launch phase with Mistral
Run `phax session last`
Run `phax enter last`
Verify Mistral behavior is correct or explicitly unsupported
```

## 10. Expected CLI Output

`phax session last` should produce provider-aware output.

Example:

```
Phase session

Run: feature-auth-flow
Phase: 03 - Implement auth state machine
Status: running

Provider: codex
Model: codex-...
Adapter: codex
Locked at: 2026-06-15T09:14:22Z
Lock source: routing_at_phase_start

Session ID: ...
Worktree: ~/.phax/feature-auth-flow
```

The exact formatting can change, but the locked provider/model must be visible.

## 11. Non-Goals

This spec does not require:

- changing the model routing algorithm itself
- changing how plans are generated
- changing how phases are selected before launch
- introducing a new provider
- changing the names of existing commands
- replacing provider CLIs

The goal is specifically to make launched phase sessions stable, provider-aware, and correctly re-enterable.

## 12. Implementation Notes for Planning

Claude Opus should plan this as a structural fix, not as a Codex-only patch.

The expected implementation likely needs:

1. a persisted `PhaseAgentBinding`
2. provider-specific session adapters
3. command refactoring so session commands read the binding first
4. tests proving routing is not called after launch
5. explicit Codex support
6. Mistral verification

The key invariant is:

> For any launched phase, `provider` and `model` are immutable. Every later interaction with that phase must use the locked binding, never the router.
>
