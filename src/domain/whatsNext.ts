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
      readonly kind: "gates_exhausted";
      readonly shortName: string;
      readonly phaseId?: string | undefined;
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
      readonly phaseCount?: number | undefined;
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
    case "gates_exhausted": {
      const phaseArg = scenario.phaseId ?? "<phase-id>";
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
    case "review_open": {
      const headline =
        scenario.phaseCount !== undefined
          ? `The run reached review — ${scenario.phaseCount} phase(s) complete.`
          : "The run reached review — all phases are complete.";
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
