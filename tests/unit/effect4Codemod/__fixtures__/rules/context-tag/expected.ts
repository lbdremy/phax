import { Context, type Effect } from "effect";

/** Reads the wall clock, so a test can pin the time a run records. */
export interface ClockOps {
  readonly now: Effect.Effect<Date>;
}

export class Clock extends Context.Service<Clock, ClockOps>()("phax/Clock") {}

export class Journal extends Context.Service<
  Journal,
  { readonly append: (line: string) => Effect.Effect<void> }
>()("phax/Journal") {}

/** Writes progress lines for a person watching a run. */
export interface ProgressOps {
  readonly line: (text: string) => Effect.Effect<void>;
}

export const Progress = Context.Service<ProgressOps>("phax/Progress");
