// `phax artifact new spec` and `plan` as runner commands: stubs until phase-04 of command-contracts
// plan 3 moves them onto the runner. The acceptance tests of
// tests/integration/artifactStdinDocuments.test.ts load these factories; each stub declares
// nothing and dies when run, so each test fails on its own assertion until phase-04.
import { Effect, type Layer } from "effect";
import type { Backend } from "../../ports/backend.js";
import type { GitHub } from "../../ports/github.js";
import { defineCommand } from "../commandLibrary/contract/index.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ArtifactNewDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

export function makeArtifactNewSpecCommand(_deps: ArtifactNewDeps = {}) {
  return defineCommand({
    name: "spec",
    summary: "Create a Draft spec skeleton",
    input: {},
    exits: {},
    run: () => Effect.die("not implemented: artifact new spec on the runner (phase-04)"),
  });
}

export function makeArtifactNewPlanCommand(_deps: ArtifactNewDeps = {}) {
  return defineCommand({
    name: "plan",
    summary: "Create a Draft plan skeleton",
    input: {},
    exits: {},
    run: () => Effect.die("not implemented: artifact new plan on the runner (phase-04)"),
  });
}
