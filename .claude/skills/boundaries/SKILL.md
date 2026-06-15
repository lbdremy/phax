---
name: boundaries
description: Respect the PHAX four-layer architecture (cli → app → domain ← ports ← infra) when adding or moving code.
---

# Architectural boundaries

## The four-layer rule

```
cli/  →  app/  →  domain/   ports/
                              ↑
                           infra/
```

Each layer may only import from layers to its right (or below):

| Layer     | May import from                                 |
| --------- | ----------------------------------------------- |
| `cli/`    | `app/`, `domain/`, `ports/`                     |
| `app/`    | `domain/`, `ports/`                             |
| `domain/` | nothing inside `src/` (only `effect`, std libs) |
| `infra/`  | `ports/`, `domain/`, platform adapters          |

**cli/ must not import infra/ directly.** CLI commands call use cases in `app/`
and receive results through the output port; they never construct or call
infrastructure adapters themselves.

**app/ must not import infra/ directly.** App use cases receive ports as
Effect Services (dependency injection). They never instantiate adapters.

**domain/ must not import cli/, app/, or infra/.** The domain is the only layer
that is pure and safe to test without any adapter.

## Why

Violating these boundaries couples layers that change for different reasons.
A CLI flag change should never require touching domain logic. An infrastructure
adapter swap (e.g., different git backend) should never require touching
application logic.

## How to fix a boundary violation

1. Identify which layer the importing file belongs to.
2. Identify which layer the imported file belongs to.
3. If the import skips layers (e.g., cli → infra), introduce or use the
   appropriate port and let Effect's dependency injection wire it.
4. If `app/` is importing a concrete adapter, replace with a port interface
   and inject the adapter at the composition root (`cli/main.ts`).

## Audit rule

`PHAX_BOUNDARY_001` — cli → infra import detected.
`PHAX_BOUNDARY_002` — domain → cli/app/infra import detected.
`PHAX_BOUNDARY_003` — app → concrete infra import detected.
