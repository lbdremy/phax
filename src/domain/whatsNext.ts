import { describeProtectedChange, type ProtectedChange } from "./security/protectedPaths.js";

export interface NextStep {
  readonly title: string;
  readonly detail?: readonly string[];
  readonly command?: string;
}

export interface WhatsNext {
  readonly headline: string;
  readonly steps: readonly NextStep[];
}

export type KeepAwakePlatform = "darwin" | "linux" | "other";

/** Map a raw `process.platform` string to the keep-awake platform the builder understands. */
export function toKeepAwakePlatform(platform: string): KeepAwakePlatform {
  if (platform === "darwin" || platform === "linux") return platform;
  return "other";
}

export type WhatsNextScenario =
  | {
      readonly kind: "limit";
      readonly shortName: string;
      readonly resetAt?: string | undefined;
      readonly phaseId?: string | undefined;
      readonly platform: KeepAwakePlatform;
    }
  | {
      readonly kind: "network";
      readonly shortName: string;
      readonly phaseId?: string | undefined;
      /**
       * The `--provider-priority` the paused invocation was given, carried
       * into the retry (a run does not record it), or null.
       */
      readonly providerPriority: string | null;
    }
  | {
      readonly kind: "gates_exhausted";
      readonly shortName: string;
      readonly phaseId?: string | undefined;
      readonly failedStep: "configured" | "oracle" | "protected-paths";
      /** The protected paths still changed, possibly none. */
      readonly protectedChanges: readonly ProtectedChange[];
      /** The phase's last fix transcript, or null when no fix was made. */
      readonly lastFixTranscript: string | null;
    }
  | {
      readonly kind: "gate_refused";
      readonly shortName: string;
      readonly phaseId: string;
      readonly failedStep: "configured" | "oracle";
      readonly command: string;
      readonly reason: string;
      readonly remedy: string;
      /** The protected paths the same attempt found changed, possibly none. */
      readonly protectedChanges: readonly ProtectedChange[];
    }
  | {
      readonly kind: "protected_paths_changed";
      readonly shortName: string;
      readonly phaseId?: string | undefined;
      /** The protected paths that differ from the phase commit. */
      readonly protectedChanges: readonly ProtectedChange[];
    }
  | {
      readonly kind: "phase_no_changes";
      readonly shortName: string;
      readonly phaseId: string;
    }
  | {
      readonly kind: "review_open";
      readonly shortName: string;
      readonly prUrl?: string | undefined;
      readonly phaseCount: number;
    };

export const RESUME_BUFFER_SECONDS = 60;

export function secondsUntil(resetAt: string, now: Date): number | undefined {
  const reset = Date.parse(resetAt);
  if (isNaN(reset)) return undefined;
  const diff = reset - now.getTime();
  if (diff <= 0) return undefined;
  return Math.ceil(diff / 1000);
}

export function resumeWhenClearCommand(
  shortName: string,
  resetAt: string | undefined,
  now: Date,
  platform: KeepAwakePlatform,
): string | undefined {
  if (resetAt === undefined) return undefined;
  const secs = secondsUntil(resetAt, now);
  if (secs === undefined) return undefined;
  const payload = `sleep ${secs + RESUME_BUFFER_SECONDS}; phax resume ${shortName} --yes --verbose`;
  switch (platform) {
    case "darwin":
      return `caffeinate -i sh -c '${payload}'`;
    case "linux":
      return `systemd-inhibit --what=idle:sleep --why="phax: waiting for limit reset" sh -c '${payload}'`;
    case "other":
      return `sh -c '${payload}'`;
  }
}

/** The recovery for a wrong oracle: correct it in the phase worktree, resume without its step. */
function oracleCorrectionSteps(shortName: string, phaseArg: string): NextStep[] {
  return [
    {
      title: "Or, if the oracle itself is wrong, correct it in the phase worktree",
      command: `phax enter-phase ${shortName} ${phaseArg}`,
    },
    {
      title:
        "Then resume without the oracle step — the configured gate still runs, with the usual fix loop",
      command: `phax resume ${shortName} --yes --skip-oracle`,
    },
  ];
}

/**
 * Each protected path still changed with its kind, and why it cannot stay:
 * no phase of the run may change it. Indented under a headline.
 */
function protectedHeadlineLines(changes: readonly ProtectedChange[]): string[] {
  return [
    ...changes.map((change) => `  - ${describeProtectedChange(change)}`),
    "  No phase of this run may change these paths: they are the operator's decision.",
  ];
}

/**
 * The two ways on from a protected change, never a phase reset: put each file
 * back to its content at the phase base and resume, or make the change on the
 * base branch and start a new run.
 */
function protectedWaysOn(shortName: string, phaseArg: string): NextStep[] {
  return [
    {
      title: "Put each protected file back to its content at the phase base",
      command: `phax enter-phase ${shortName} ${phaseArg}`,
    },
    {
      title: "Then resume — the gate is re-run first; if it passes the phase commits",
      command: `phax resume ${shortName} --yes`,
    },
    {
      title: "Or, if the change is wanted, make it on the base branch yourself and start a new run",
    },
  ];
}

export function buildWhatsNext(scenario: WhatsNextScenario, now: Date): WhatsNext {
  switch (scenario.kind) {
    case "limit": {
      const steps: NextStep[] = [];
      const autoCmd = resumeWhenClearCommand(
        scenario.shortName,
        scenario.resetAt,
        now,
        scenario.platform,
      );
      if (autoCmd !== undefined) {
        const autoStep: NextStep = {
          title: "Wait for the limit to clear, then resume automatically",
          command: autoCmd,
          ...(scenario.resetAt ? { detail: [`Limit resets at ${scenario.resetAt}.`] } : {}),
        };
        steps.push(autoStep);
      } else {
        const detail: string[] = scenario.resetAt
          ? [`Limit resets at ${scenario.resetAt}.`]
          : ["Reset time was not reported — retry later."];
        steps.push({
          title: "Resume when the limit clears",
          detail,
          command: `phax resume ${scenario.shortName} --yes --verbose`,
        });
      }
      if (scenario.phaseId !== undefined) {
        steps.push({
          title: "Or inspect the in-flight phase interactively",
          command: `phax enter-phase ${scenario.shortName} ${scenario.phaseId}`,
        });
      }
      return {
        headline: "The run is paused — a provider limit was reached.",
        steps,
      };
    }
    case "network": {
      const at = scenario.phaseId !== undefined ? ` at ${scenario.phaseId}` : "";
      const priority =
        scenario.providerPriority === null
          ? ""
          : ` --provider-priority ${scenario.providerPriority}`;
      return {
        headline: `Run ${scenario.shortName} is paused${at}.`,
        steps: [
          {
            title: "Retry once the network is back — no reset time to wait for",
            command: `phax resume ${scenario.shortName} --yes${priority}`,
          },
        ],
      };
    }
    case "gates_exhausted": {
      const phaseArg = scenario.phaseId ?? "<phase-id>";
      if (scenario.protectedChanges.length > 0) {
        return {
          headline: [
            scenario.failedStep === "protected-paths"
              ? "Gates failed after all fix attempts: protected paths changed."
              : "Gates failed after all fix attempts, and protected paths changed.",
            ...protectedHeadlineLines(scenario.protectedChanges),
            scenario.lastFixTranscript === null
              ? "  No fix attempt was made."
              : `  Last fix transcript: ${scenario.lastFixTranscript}`,
          ].join("\n"),
          steps: protectedWaysOn(scenario.shortName, phaseArg),
        };
      }
      if (scenario.failedStep === "oracle") {
        return {
          headline: "The oracle step failed after all fix attempts.",
          steps: [
            {
              title: "Let the fix loop try again — the gate, oracle step included, is re-run first",
              command: `phax resume ${scenario.shortName} --yes`,
            },
            ...oracleCorrectionSteps(scenario.shortName, phaseArg),
          ],
        };
      }
      return {
        headline: "Gates failed after all fix attempts.",
        steps: [
          {
            title: "Fix the gate in the phase worktree",
            command: `phax enter-phase ${scenario.shortName} ${phaseArg}`,
          },
          {
            title: "Resume — the gate is re-run first; if it passes the phase commits",
            command: `phax resume ${scenario.shortName} --yes`,
          },
          {
            title: "If the session was lost, reset the phase instead",
            command: `phax reset-phase ${scenario.shortName} ${phaseArg}`,
          },
        ],
      };
    }
    case "gate_refused": {
      return {
        headline: [
          `${scenario.phaseId} gate: \`${scenario.command}\` refused to run: ${scenario.reason}`,
          `  remedy: ${scenario.remedy}`,
          `  No fix attempt was made. Fix the cause, then: phax resume ${scenario.shortName} --yes`,
          ...(scenario.protectedChanges.length === 0
            ? []
            : [
                "  Protected paths also changed in the same attempt:",
                ...protectedHeadlineLines(scenario.protectedChanges),
              ]),
        ].join("\n"),
        steps: [
          {
            title: "Apply the remedy in the phase worktree",
            detail: [
              scenario.remedy,
              ...(scenario.protectedChanges.length === 0
                ? []
                : ["Put each protected file back to its content at the phase base."]),
            ],
            command: `phax enter-phase ${scenario.shortName} ${scenario.phaseId}`,
          },
          {
            title: "Resume — the gate is re-run first, with the full fix budget",
            command: `phax resume ${scenario.shortName} --yes`,
          },
          ...(scenario.protectedChanges.length === 0
            ? []
            : [
                {
                  title:
                    "Or, if the protected change is wanted, make it on the base branch yourself and start a new run",
                },
              ]),
          ...(scenario.failedStep === "oracle"
            ? oracleCorrectionSteps(scenario.shortName, scenario.phaseId)
            : []),
        ],
      };
    }
    case "phase_no_changes": {
      return {
        headline: "The phase produced no changes.",
        steps: [
          {
            title: "Continue with the next phase",
            command: `phax resume ${scenario.shortName} --yes`,
          },
          {
            title: "Inspect the phase",
            command: `phax enter-phase ${scenario.shortName} ${scenario.phaseId}`,
          },
        ],
      };
    }
    case "protected_paths_changed": {
      const phaseArg = scenario.phaseId ?? "<phase-id>";
      return {
        headline: [
          "Protected paths changed after the phase committed.",
          ...protectedHeadlineLines(scenario.protectedChanges),
        ].join("\n"),
        steps: [
          {
            title: "Put each protected file back to its content in the phase commit",
            command: `phax enter-phase ${scenario.shortName} ${phaseArg}`,
          },
          {
            title: "Then resume — the paths are checked again before the handoff is validated",
            command: `phax resume ${scenario.shortName} --yes`,
          },
          {
            title:
              "Or, if the change is wanted, make it on the base branch yourself and start a new run",
          },
        ],
      };
    }
    case "review_open": {
      const headline = `The run reached review — ${scenario.phaseCount} phase(s) complete.`;
      const prStep: NextStep =
        scenario.prUrl !== undefined
          ? { title: "View the pull request", detail: [scenario.prUrl] }
          : { title: "Publish a pull request", command: `phax publish-pr ${scenario.shortName}` };
      return {
        headline,
        steps: [
          prStep,
          {
            title: "Open the review worktree in your editor",
            command: `phax open ${scenario.shortName}`,
          },
          {
            title: "Open a shell in the review worktree",
            command: `phax shell ${scenario.shortName}`,
          },
          {
            title: "Resume the agent session on the final phase",
            command: `phax enter ${scenario.shortName}`,
          },
          { title: "Archive the run", command: `phax archive ${scenario.shortName}` },
        ],
      };
    }
  }
}

export function renderWhatsNext(wn: WhatsNext): string {
  const lines: string[] = ["", wn.headline, "", "Next steps:"];
  for (const step of wn.steps) {
    lines.push(`  • ${step.title}`);
    if (step.detail) {
      for (const d of step.detail) {
        lines.push(`    ${d}`);
      }
    }
    if (step.command !== undefined) {
      lines.push(`    ${step.command}`);
    }
  }
  return lines.join("\n");
}
