// `phax resume` as the runner will read it. A stub until phase-05 moves the command onto the
// runner: its factory takes the layers a test swaps, and its run dies with a recognizable
// sentence. It is not part of phaxProgram yet.
import { Effect, type Layer } from "effect";
import type { Backend } from "../../ports/backend.js";
import type { GitHub } from "../../ports/github.js";
import type { Shell } from "../../ports/shell.js";
import { defineCommand } from "../commandLibrary/contract/index.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ResumeDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly githubLayer?: Layer.Layer<GitHub>;
  readonly shellLayer?: Layer.Layer<Shell>;
}

export function makeResumeCommand(_deps: ResumeDeps = {}) {
  return defineCommand({
    name: "resume",
    summary: "Resume a run from its next pending phase",
    input: {},
    exits: {},
    run: () => Effect.die(new Error("not implemented: resume on the runner (phase-05)")),
  });
}
