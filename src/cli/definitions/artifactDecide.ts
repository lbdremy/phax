// `phax artifact decide` as a runner command: a stub until phase-04 of command-contracts plan 3
// moves it onto the runner. The acceptance tests of tests/integration/artifactStdinDocuments.test.ts
// load this factory; the stub declares nothing and dies when run, so each of them fails on its
// own assertion until phase-04 replaces it.
import { Effect, type Layer } from "effect";
import type { Backend } from "../../ports/backend.js";
import type { GitHub } from "../../ports/github.js";
import type { Prompt } from "../../ports/prompt.js";
import type { Session } from "../../ports/session.js";
import type { Terminal } from "../../ports/terminal.js";
import { defineCommand } from "../commandLibrary/contract/index.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ArtifactDecideDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly promptLayer?: Layer.Layer<Prompt>;
  readonly terminalLayer?: Layer.Layer<Terminal>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

export function makeArtifactDecideCommand(_deps: ArtifactDecideDeps = {}) {
  return defineCommand({
    name: "decide",
    summary:
      "Decide a Draft spec's or plan's open questions, with the operator or from a verdicts file",
    input: {},
    exits: {},
    run: () => Effect.die("not implemented: artifact decide on the runner (phase-04)"),
  });
}
