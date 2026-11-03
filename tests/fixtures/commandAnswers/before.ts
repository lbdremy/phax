// What phax 0.33.0 printed for the four commands that answer for the Claude
// Code mod, captured before they moved onto the command runner, as values with
// fixed timestamps. The acceptance tests of command-contracts compare the new
// answers with these:
// - `phax ls --json` over `LS_REGISTRY` (runs whose folders are gone, so the
//   rows come from the registry alone), written to `<state root>/registry.json`;
// - `phax plans overview <WIDGET_PLAN_REL> --json` and
//   `phax plans lint <WIDGET_PLAN_REL>` over `widgetPlanMd()`;
// - `phax plans lint BAD_PLAN_REL` over `widgetPlanMd("")`, the heading without
//   its anchor.
// Every output ends with the newline the command wrote.

/** The registry document behind `LS_JSON_BEFORE`: two runs, one archived. */
export const LS_REGISTRY = {
  $schema: "https://docs.phax.run/schemas/registry/0.26.0.json",
  runs: [
    {
      namespace: "made-up",
      shortName: "garden-sync",
      runId: "run-0001",
      state: "review_open",
      branch: "phax/garden-sync",
      projectName: "made-up",
      phasesCount: 3,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:30:00.000Z",
    },
    {
      namespace: "made-up",
      shortName: "old-fix",
      runId: "run-0002",
      state: "archived",
      branch: "phax/old-fix",
      projectName: "made-up",
      phasesCount: 1,
      createdAt: "2026-10-20T09:00:00.000Z",
      updatedAt: "2026-10-21T10:15:00.000Z",
      archivePath: "/archive/old-fix",
    },
  ],
} as const;

/** `phax ls --json` over `LS_REGISTRY`, stamped run-list 0.30.0. */
export const LS_JSON_BEFORE = `{
  "$schema": "https://docs.phax.run/schemas/run-list/0.30.0.json",
  "runs": [
    {
      "qualifiedName": "made-up.garden-sync",
      "namespace": "made-up",
      "shortName": "garden-sync",
      "state": "review_open",
      "branch": "phax/garden-sync",
      "currentPhase": null,
      "gateProfile": null,
      "updatedAt": "2026-10-22 09:30",
      "lockState": "none",
      "recordsPending": null,
      "archivePath": null,
      "stop": null
    },
    {
      "qualifiedName": "made-up.old-fix",
      "namespace": "made-up",
      "shortName": "old-fix",
      "state": "archived",
      "branch": "phax/old-fix",
      "currentPhase": null,
      "gateProfile": null,
      "updatedAt": "2026-10-21 10:15",
      "lockState": "none",
      "recordsPending": null,
      "archivePath": "/archive/old-fix",
      "stop": null
    }
  ]
}
`;

export const WIDGET_PLAN_REL = "docs/plans/2610240900-widget-plan.md";
export const BAD_PLAN_REL = "bad-plan.md";

/** A one-phase Draft plan; an `anchor` of `""` leaves the heading without its `{#…}`. */
export function widgetPlanMd(anchor = " {#phase-01-widget}"): string {
  return `---
status: Draft
source-spec: null
---
# Made-up widget

## Required commands

- (none)

## phase-01 — Add the widget${anchor}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

### Planned files to create

- src/domain/x.ts
- scripts/y.sh

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

- the widget is shown — small · example · the rendered widget · in-phase

### Commit subject

feat(widget): add the widget

### Commit body

Adds the widget.
`;
}

/** `phax plans overview WIDGET_PLAN_REL --json`, with no architecture provider configured. */
export const PLANS_OVERVIEW_JSON_BEFORE = `{
  "plan": "docs/plans/2610240900-widget-plan.md",
  "name": "widget",
  "title": "Made-up widget",
  "frontmatter": {
    "kind": "decoded",
    "status": "Draft"
  },
  "sourceSpec": null,
  "architecture": {
    "kind": "none"
  },
  "phases": [
    {
      "id": "phase-01",
      "title": "Add the widget",
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "mode": "headless",
      "acceptanceRole": {
        "kind": "none"
      },
      "placement": [
        {
          "part": null,
          "files": [
            "src/domain/x.ts",
            "scripts/y.sh"
          ]
        }
      ],
      "testLines": [
        {
          "guarantee": "the widget is shown",
          "size": "small",
          "technique": "example",
          "oracle": "the rendered widget",
          "loop": "in-phase",
          "criterion": null
        }
      ]
    }
  ],
  "coverage": {
    "kind": "no-source-spec"
  }
}
`;

/** `phax plans lint BAD_PLAN_REL`: one error finding, exit 1. */
export const PLANS_LINT_TEXT_BEFORE = `bad-plan.md: 1 error, 0 warnings
error    structure    phase-01  phase heading "phase-01 — Add the widget" missing id or {#anchor}
`;

/** `phax plans lint BAD_PLAN_REL --json`: exit 1. */
export const PLANS_LINT_JSON_BEFORE = `{
  "plan": "bad-plan.md",
  "findings": [
    {
      "severity": "error",
      "check": "structure",
      "phase": "phase-01",
      "message": "phase heading \\"phase-01 — Add the widget\\" missing id or {#anchor}"
    }
  ]
}
`;

/** `phax plans lint WIDGET_PLAN_REL`: no findings, exit 0. */
export const PLANS_LINT_CLEAN_TEXT_BEFORE = `docs/plans/2610240900-widget-plan.md: no findings
`;

/** `phax plans lint WIDGET_PLAN_REL --json`: exit 0. */
export const PLANS_LINT_CLEAN_JSON_BEFORE = `{
  "plan": "docs/plans/2610240900-widget-plan.md",
  "findings": []
}
`;
