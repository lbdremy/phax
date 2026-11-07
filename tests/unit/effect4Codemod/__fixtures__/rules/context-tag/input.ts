import { Context, type Effect } from "effect";

/** Reads the wall clock, so a test can pin the time a run records. */
export interface ClockOps {
  readonly now: Effect.Effect<Date>;
}

export class Clock extends Context.Tag("phax/Clock")<Clock, ClockOps>() {}

export class Journal extends Context.Tag("phax/Journal")<
  Journal,
  { readonly append: (line: string) => Effect.Effect<void> }
>() {}

/** Writes progress lines for a person watching a run. */
export interface ProgressOps {
  readonly line: (text: string) => Effect.Effect<void>;
}

export const Progress = Context.GenericTag<ProgressOps>("phax/Progress");
