// The hero's run card: the home's live run as it plays (site/theme/playback.tsx),
// a stepper from spec to pull request, the phases, and the semantic log
// scrolling under them. It tells the playback when it is off screen.
import { useEffect, useRef, type ReactElement } from "react";
import type { LiveRunLine, LiveRunStage } from "../build/liveRun.js";
import { usePlayback } from "./playback.js";

// The test typecheck has no DOM library; the one browser API the card uses.
declare const IntersectionObserver:
  | (new (callback: (entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void) => {
      observe(target: unknown): void;
      disconnect(): void;
    })
  | undefined;

const STAGES: ReadonlyArray<LiveRunStage> = ["spec", "plan", "run", "review", "pr"];
const LOG_LINES = 8;
/** How far along a phase is, by its sub-state, for the phase's bar. */
const PROGRESS: Readonly<Record<string, number>> = {
  pending: 0,
  setting_up_worktree: 15,
  running: 40,
  gates_failed: 55,
  fixing: 55,
  passed: 75,
  committed: 90,
  cleaning_up: 95,
  cleaned_up: 100,
  review_open: 100,
};
const FAILING = new Set(["gates_failed", "fixing"]);

interface CardView {
  readonly stage: LiveRunStage | undefined;
  readonly status: Readonly<Record<LiveRunStage, string>>;
  readonly phases: ReadonlyArray<{
    readonly id: string;
    readonly state: string;
    readonly attempt: number | undefined;
  }>;
  readonly current: string | undefined;
}

function view(lines: ReadonlyArray<LiveRunLine>, phaseIds: ReadonlyArray<string>): CardView {
  const status: Record<LiveRunStage, string> = {
    spec: "—",
    plan: "—",
    run: "—",
    review: "—",
    pr: "—",
  };
  const phases = new Map<string, { state: string; attempt: number | undefined }>(
    phaseIds.map((id) => [id, { state: "pending", attempt: undefined }]),
  );
  let current: string | undefined;
  for (const line of lines) {
    if (line.kind === "artifact" && line.after !== undefined) {
      status[line.label.startsWith("spec") ? "spec" : "plan"] = line.after;
    }
    if (line.kind === "state.transition" && line.after !== undefined) {
      const [run = "", phase] = line.after.split(":");
      status.run = run;
      if (line.phase !== undefined && phase !== undefined) {
        phases.set(line.phase, {
          state: phase,
          attempt: FAILING.has(phase) ? line.attempt : undefined,
        });
        current = line.phase;
      }
    }
    if (line.stage === "review" && line.kind === "artifact.generated") {
      status.review = line.label.split(" · ").at(-1) ?? "—";
    }
    if (line.stage === "pr") status.pr = "opened";
  }
  return {
    stage: lines.at(-1)?.stage,
    status,
    phases: [...phases].map(([id, phase]) => ({ id, ...phase })),
    current,
  };
}

function LogLine({ line }: { readonly line: LiveRunLine }) {
  const failed = line.failed === true ? " phax-run__line--failed" : "";
  if (line.before !== undefined || line.after !== undefined) {
    return (
      <div className={`phax-run__line${failed}`}>
        <span className="phax-run__event">{line.label}</span>
        {line.attempt !== undefined && line.kind === "state.transition"
          ? ` attempt=${line.attempt}`
          : ""}{" "}
        {line.before ?? ""} <span className="phax-run__arrow">→</span> {line.after}
      </div>
    );
  }
  return (
    <div className={`phax-run__line${failed}`}>
      {line.kind} <span className="phax-run__event">{line.label}</span>
      {line.phase !== undefined ? ` ${line.phase}` : ""}
    </div>
  );
}

export function LiveRun(): ReactElement {
  const playback = usePlayback();
  const lines = playback?.lines ?? [];
  const shown = playback?.shown ?? lines.length;
  const setVisible = playback?.setVisible;
  const phaseIds = [
    ...new Set(lines.flatMap((line) => (line.phase === undefined ? [] : [line.phase]))),
  ];
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = card.current;
    if (element === null || setVisible === undefined) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? true),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [setVisible]);

  const played = lines.slice(0, shown);
  const state = view(played, phaseIds);
  const log = played.slice(-LOG_LINES);

  return (
    <div className="phax-run" ref={card} aria-label="A phax run, from spec to pull request">
      <div className="phax-run__top">
        <span>phax · greet</span>
        <span>
          run: <span className="phax-run__state">{state.status.run}</span>
        </span>
      </div>
      <ol className="phax-run__stages">
        {STAGES.map((stage) => (
          <li
            key={stage}
            className={
              stage === state.stage ? "phax-run__stage phax-run__stage--on" : "phax-run__stage"
            }
          >
            <span>{stage}</span>
            <b>{state.status[stage]}</b>
          </li>
        ))}
      </ol>
      <div className="phax-run__phases">
        {state.phases.map((phase) => {
          const classes = ["phax-run__phase"];
          if (phase.id === state.current && state.stage === "run")
            classes.push("phax-run__phase--on");
          if (FAILING.has(phase.state)) classes.push("phax-run__phase--failing");
          if ((PROGRESS[phase.state] ?? 0) >= 90) classes.push("phax-run__phase--done");
          return (
            <div key={phase.id} className={classes.join(" ")}>
              <b>{phase.id}</b>
              <small>
                {phase.state}
                {phase.attempt !== undefined ? ` #${phase.attempt}` : ""}
              </small>
              <span className="phax-run__bar">
                <i style={{ width: `${PROGRESS[phase.state] ?? 0}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="phax-run__log" aria-hidden="true">
        {log.map((line, index) => (
          <LogLine key={shown - log.length + index} line={line} />
        ))}
      </div>
    </div>
  );
}
