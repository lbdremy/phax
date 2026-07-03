# Gate Profile as Attributed Steps

Status: Draft

Date: 2026-07-03

Audience: implementation planning with Claude Code

Scope: functional behavior only

## 1. Context

phax evaluates a **gate** after each phase: a set of steps (typecheck / test / lint / build) whose
failures drive a same-session fix loop. Which steps run is chosen today by a coarse **depth**
selection — a single dial (e.g. fast vs full) picked per run.

This spec is the foundation the other gate specs build on: **External Gate Steps** (how a non
built-in step registers and feeds the fix loop) and **Gate Step Scheduling** (per-diagnostic
completion timing) both assume the profile model defined here.

## 2. Problem

A depth scalar is the wrong shape for a gate:

- It conflates *how much* to run with *what* is verified. "full" says a lot ran; it does not say
  the **architecture** was checked as opposed to only the local compile/test surface.
- It cannot say *when* a step should fire. A cheap check belongs at every phase; an expensive one
  (a full build) belongs only at the end. A single dial forces the same cadence on all steps.
- It cannot **attribute**. A green gate reports "the gate passed", not "the structural surface was
  verified". A run that never exercised a whole class of checks looks identical to one that did.

The gate needs to be a legible set of steps carrying explicit dimensions, not a dial.

## 3. Product goal

A gate profile is a **named selection of gate steps**, each step carrying two explicit dimensions:
the **surface** it verifies (a recorded label, e.g. local / structural / product) and its **firing**
time (every-phase or terminal). The depth scalar is removed. phax records, per phase, which steps
ran and on what surface, so a run is attributable — which surfaces were verified is legible, and a
surface a profile never exercised is visible rather than hidden.

> A gate profile is a set of attributed steps, not a depth dial — what ran and what it verified must
> be legible, never collapsed into "how much".

## 4. Terminology

- **Gate profile** — the named set of gate steps a run evaluates.
- **Gate step** — one command in the profile (built-in or external).
- **Surface** — the class of verification a step performs, as a recorded label (conventionally
  local, structural, or product). It is an **attribution** dimension: phax records it and does not
  branch behavior on it.
- **Firing** — when a step runs across a phased run: every-phase or terminal. It is a **behavioral**
  dimension: phax schedules on it.
- **Attribution record** — the per-phase record of which steps ran, their surface, and their result.

## 5. Functional requirements

### 5.1 Profile is a selection of steps

THE system SHALL express a gate profile as a named set of gate steps rather than a depth scalar.

THE system SHALL remove the depth-scalar selection; a profile determines the gate solely by the
steps it names.

### 5.2 Surface dimension (attribution)

THE system SHALL require each gate step to declare the surface it verifies.

THE system SHALL record each step's declared surface and SHALL NOT alter gate behavior based on the
surface value.

### 5.3 Firing dimension (behavior)

THE system SHALL require each gate step to declare a firing time of either every-phase or terminal.

WHILE a run is before its terminal phase THE system SHALL run only the profile's every-phase steps
at each phase gate.

WHERE a step's firing is terminal THE system SHALL run it only at the run's terminal phase gate.

### 5.4 Per-phase attribution

WHEN a phase gate completes THE system SHALL record which steps ran and, for each, its surface and
its result.

### 5.5 Run-level surface legibility

WHEN a run completes THE system SHALL report the set of surfaces that were verified during the run.

## 6. Non-goals

- The **content** of any step — what a structural or product step actually checks — is the step's
  (or its provider's) concern.
- The **registration and fix-loop mechanics** of external steps — the External Gate Steps spec.
- **Per-diagnostic scheduling** (invariant vs completion, scope closure, pending) — the Gate Step
  Scheduling spec. Note that **polarity is not a profile dimension**: it is carried per diagnostic
  there, not per step here.
- **Choosing** which surfaces a given project should run — that is the operator selecting a profile,
  not phax's behavior.
- Any **runtime/product execution** a product-surface step might require — out of scope.

## 7. Acceptance criteria

### Profile is a named step set

Given a gate profile, when a run reads it, then the gate is determined by the steps it names and no
depth scalar is consulted. (refs §5.1)

### Step declares its surface and phax records it

Given a step declaring surface "structural", when it runs, then phax records the result under that
surface and behaves identically regardless of the surface value. (refs §5.2)

### Every-phase vs terminal firing

Given a profile with an every-phase step and a terminal step, when a non-terminal phase gate runs,
then only the every-phase step runs; when the terminal phase gate runs, then the terminal step also
runs. (refs §5.3)

### Attribution is recorded per phase

Given a completed phase gate, when its record is read, then it lists which steps ran, each step's
surface, and each step's result. (refs §5.4)

### Verified surfaces are legible at run end

Given a completed run, when its summary is read, then it names the set of surfaces that were
verified. (refs §5.5)

## 8. Open questions for implementation planning

- **Presets vs fully user-defined profiles.** phax may ship named default profiles or leave the
  selection entirely to the project. *Default:* profiles are user-defined; phax may ship one default
  profile.
- **Surface vocabulary.** Whether the surface label is a fixed enum (local/structural/product) or a
  free label phax merely records. *Default:* record a free label with those three as the convention,
  since phax does not branch on it.
- **Migration from the depth scalar.** *Default:* remove it with no shim (phax schema policy);
  existing configs that set a depth are rejected at validation, not silently mapped.

## 9. Implementation-planning note

Settled: a profile is a named set of steps; each step carries a **surface** (recorded, not
behavioral) and a **firing** time (every-phase | terminal, behavioral); the depth scalar is removed;
attribution is recorded per phase and surfaces are legible at run end. Left open: presets vs
user-defined and the surface vocabulary (§8). Constraint: **phax stays generic** — firing is the
only dimension phax schedules on; surface is pure attribution. This spec defines the profile shape;
**External Gate Steps** and **Gate Step Scheduling** fill it with external steps and per-diagnostic
timing respectively. Per phax schema policy, the removed depth scalar leaves no shim.
