# Frozen Agent Commands

## Status

Functional specification.

This document defines how PHAX should manage the commands an agent is allowed to execute during a run.

The goal is to avoid failed runs caused by missing command permissions while keeping the security model explicit, simple, and auditable.

This spec is intentionally non-prescriptive about the exact configuration location, field names, and schema details. The implementation plan must inspect the current PHAX architecture and propose the most coherent integration.

---

# 1. Problem

PHAX restricts which commands an agent can execute.

This is necessary for security.

However, it creates a practical issue when a plan introduces a new tool.

Example:

```txt
A plan introduces Deno.

The agent needs to run:
  deno fmt
  deno lint
  deno task check
  deno task test

But the current PHAX security configuration does not allow these commands.

The run starts.

PHAX generates the phase security.json.

The provider jail receives restricted command permissions.

The agent cannot execute the commands required by the plan.

The phase fails.
```

PHAX needs a clear way for the developer to explicitly authorize the commands the agent may use before execution begins.

---

# 2. Goal

PHAX should support a frozen set of agent command capabilities.

This set defines what the agent is allowed to execute during a phase or run.

The set should be derived from explicit, developer-controlled PHAX configuration.

It should be recorded in the generated phase `security.json`.

It should not change during the active phase or run.

---

# 3. Core principle

The agent must not be able to grant itself new command permissions during a run.

PHAX should compute the allowed agent command set before agent execution starts.

After that, the command capability set is frozen.

Changes made by the agent during the run to files such as:

```txt
phax.json
package.json
deno.json
pnpm-workspace.yaml
```

must not affect the command capabilities of the active phase or run.

Those changes may affect a future run, but not the current one.

---

# 4. Unified command model

PHAX should use one conceptual permission model:

```txt
agentCommands
```

There should not be two separate user-facing concepts such as:

```txt
agentExecutables
agentCommands
```

because this creates misleading security semantics.

Example of the problem:

```txt
agentExecutables:
  - deno

agentCommands:
  - deno fmt
```

If `deno` is already authorized as an executable, then `deno fmt` does not provide a meaningful additional restriction in many enforcement systems.

The agent may effectively have access to all Deno commands.

Therefore, PHAX should use one unified list of agent command allowances.

---

# 5. Command granularity

An `agentCommands` entry may be broad or narrow.

Examples:

```txt
deno
deno fmt
deno lint
deno task check
deno task test
pnpm test
vitest run
tsc --noEmit
gh pr create
```

Interpretation:

```txt
deno
  → broad command family allowance

deno fmt
  → narrower command allowance

deno task test
  → specific task allowance

gh pr create
  → specific GitHub CLI operation allowance
```

This gives PHAX one mental model:

```txt
What is the agent allowed to call?
```

The answer is:

```txt
the frozen agentCommands set
```

---

# 6. No automatic package-script unrolling

PHAX should not automatically unroll package-manager scripts referenced by gates.

PHAX should not inspect a gate such as:

```txt
pnpm test
```

then automatically derive:

```txt
vitest run
```

from `package.json`.

Reason:

```txt
automatic unrolling makes the permission model less explicit
it is hard to know what level of command precision the user expects
it may produce surprising derived permissions
it adds complexity without being necessary
```

If the developer wants the agent to run the underlying command directly, the developer should declare it explicitly in `agentCommands`.

Example:

```txt
pnpm test
vitest run
```

This is clearer, more predictable, and easier to audit.

---

# 7. Explicit command allowances

The developer should explicitly allow the commands the agent may need.

Example for a Deno-related plan:

```txt
deno fmt
deno lint
deno task check
deno task test
```

If the developer wants to allow the whole Deno command family, they may choose to allow:

```txt
deno
```

PHAX should treat this as intentionally broader.

PHAX should make the consequences visible.

---

# 8. Source configuration

PHAX already has security-related configuration.

This feature should extend the existing security configuration model rather than introduce a parallel configuration system.

However, this spec does not prescribe the exact location.

The implementation planning agent must inspect the current PHAX architecture and determine where this belongs.

It should consider:

```txt
where security configuration currently lives
how phase security.json is generated
how provider permissions are built
how gates are defined
how run-level and phase-level config are represented
```

If one location clearly fits the existing architecture, the planning agent should propose it and explain why.

If several locations are equally reasonable, the planning agent should ask the user to choose.

---

# 9. Generated phase security artifact

PHAX already generates a `security.json` file for each phase.

This feature should extend the generated phase `security.json` with the effective frozen `agentCommands` set.

The exact schema is not prescribed here.

Functionally, the phase `security.json` should record:

```txt
allowed agent commands
source of each allowance
whether each allowance was explicitly configured
whether the command was required by the plan
how precisely the provider can enforce it
whether enforcement was degraded
```

The purpose is auditability.

A reviewer should be able to understand why the agent was allowed to execute each command.

---

# 10. Requested policy vs effective enforcement

PHAX must distinguish:

```txt
requested policy
effective enforcement
```

The requested policy is what PHAX wants to allow.

The effective enforcement is what the selected provider can actually enforce.

Example:

```txt
Requested command:
  deno fmt

Provider can enforce:
  only executable-level permissions

Effective permission:
  deno

Security precision:
  degraded
```

PHAX must not pretend that a precise command is enforced precisely if the underlying provider can only enforce the executable.

The generated `security.json` should make this visible.

---

# 11. Broad vs narrow allowances

PHAX should treat broad command allowances as intentionally broader.

Example:

```txt
deno
```

means the agent may be allowed to use the Deno command family.

Example:

```txt
deno fmt
```

means the desired policy is narrower.

PHAX should help the user see when a narrow allowance is degraded to a broader effective permission by the provider.

Example diagnostic:

```txt
Configured agent command:
  deno fmt

Provider enforcement:
  executable-level only

Effective permission:
  deno

Security precision:
  degraded
```

This is acceptable only if the selected security mode allows degraded enforcement.

In strict mode, PHAX may fail instead.

---

# 12. Planning skill update

The PHAX planning skill should be updated.

When creating a plan, it should detect whether the plan introduces a new tool, runtime, package manager, provider CLI, or command family.

Examples:

```txt
Deno
Bun
pnpm
Vitest
Playwright
ESLint
Biome
Rust/Cargo
Docker
gh
```

If the plan introduces such a tool, the planning output should include a clear pre-run requirement.

Example:

```md
## Required PHAX security configuration changes

This plan introduces Deno.

Before running this plan, ensure PHAX allows the agent to execute the required Deno commands.

Suggested agent commands:
- deno fmt
- deno lint
- deno task check
- deno task test

If you prefer a broader allowance, you may allow:
- deno

But this is less precise.
```

The planning skill should not assume newly introduced tools are automatically available.

---

# 13. Planning model responsibility

When implementing this feature, Claude should not blindly choose a configuration shape.

Claude should first inspect the current architecture and determine:

```txt
where security configuration currently lives
how per-phase security.json is generated
how provider permissions are derived
how gates are represented
how planning skills are stored and updated
```

Then Claude should propose the least disruptive integration.

If several options are reasonable, Claude should ask the user to decide.

The plan should remain functional and architecture-aware.

---

# 14. Preflight behavior

Before executing a run, PHAX should validate that required agent commands can be authorized.

The preflight should detect:

```txt
explicitly configured agent commands
commands required by the plan if declared
commands missing from the effective allowed set
commands whose requested precision cannot be enforced by the selected provider
```

If a required command is missing, PHAX should fail before starting the agent.

Example diagnostic:

```txt
Security preflight failed.

The plan appears to require Deno commands, but the current agent command capability set does not include them.

Required commands:
  deno fmt
  deno lint
  deno task check
  deno task test

Update PHAX security configuration before running this plan.
```

If enforcement is degraded, PHAX should report that clearly.

Example:

```txt
Security precision warning.

Requested:
  deno fmt

Effective provider enforcement:
  deno

The selected provider can only enforce executable-level permissions for this command.
```

---

# 15. Auditability

PHAX should make the frozen command capability set visible.

It should be recorded in the generated phase `security.json`.

It should also be visible in verbose mode or diagnostics when useful.

A reviewer should be able to answer:

```txt
Why was this command allowed?
Was it explicitly allowed?
Was it required by the plan?
Was it enforced exactly?
Was it degraded to executable-level enforcement?
```

---

# 16. Safety constraints

This feature should not silently weaken the security model.

Functional safety rules:

```txt
Do not grant new permissions during a run based on files modified by the agent.

Do not let the agent modify PHAX configuration and immediately benefit from the change.

Do not automatically derive extra permissions from package-manager scripts.

Do not authorize every possible package-manager command just because one gate uses a package manager.

Do not pretend a precise command is precisely enforced if the provider only enforces the executable.

Do not hide missing command permissions until the phase is already running.

Do not introduce a parallel security configuration system if the current architecture already has one.
```

---

# 17. Non-goals

This feature does not specify:

```txt
exact JSON schema
exact config field names
exact file layout
exact provider-specific permission syntax
PHAX’s own subprocess allowlist
package script unrolling
shell parsing
network policy
MCP policy
external sandboxing
```

Those decisions should be made during implementation planning after inspecting the current architecture.

If the right structure is ambiguous, the planning model should ask the user.

---

# 18. Acceptance criteria

This feature is complete when:

1. PHAX uses one unified concept for agent command capabilities.
2. The concept is named or represented as `agentCommands`, unless the current architecture strongly suggests another name.
3. `agentCommands` can represent a broad command allowance such as `deno`.
4. `agentCommands` can represent a narrow command allowance such as `deno fmt`.
5. PHAX no longer models user-facing agent permissions as two independent lists of executables and commands.
6. PHAX does not automatically unroll package-manager scripts from gates.
7. Developers can explicitly allow underlying commands when they want the agent to call them directly.
8. The effective command capability set is frozen for the phase or run.
9. Agent modifications to config files do not change active command capabilities.
10. Each generated phase `security.json` records the effective agent command capabilities.
11. Each generated phase `security.json` records why each command was allowed.
12. Each generated phase `security.json` records whether enforcement was exact, prefix-based, executable-level, or degraded.
13. PHAX preflight detects missing command permissions before agent execution starts.
14. PHAX preflight detects provider enforcement degradation when relevant.
15. PHAX emits clear diagnostics for missing or degraded command permissions.
16. The PHAX planning skill warns when a plan introduces a new tool or command family.
17. The planning skill asks for security configuration updates before the run when needed.
18. Claude’s implementation plan proposes the correct config/artifact placement based on the existing architecture.
19. Claude asks the user to choose if multiple configuration placements are reasonable.
20. The feature remains compatible with existing per-phase `security.json` generation.
21. The feature does not require renaming existing config or artifact files unless Claude identifies that as necessary and the user approves it.

---

# 19. Product summary

PHAX should not fail mid-run because the agent is blocked from using a tool that the plan itself introduced.

The solution is a unified frozen command capability set:

```txt
agentCommands
```

This set may include broad or narrow command allowances.

Examples:

```txt
deno
deno fmt
pnpm test
vitest run
```

PHAX should not automatically derive additional commands from package-manager scripts.

If the user wants the agent to run an underlying command directly, the user declares that command explicitly.

Core rule:

```txt
The agent receives a frozen command capability set computed before execution starts.

The allowed commands are explicit.

PHAX must be honest about what is requested and what the provider can actually enforce.
```
