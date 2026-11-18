// The classes a fix's changed paths fall into (spec finding-ids-and-fates §5.13).
// Alphabetical: the order a set of classes is written in. Imports only `effect`
// and schema modules, because a published format uses it.
import { Schema } from "effect";
import { refusalOverride } from "./refusal/adapter.js";

export const PATH_CLASSES = ["code", "docs", "gate-config", "tests"] as const;

/** How a path counts in a fix: code, docs, gate-config (a gate tool's config or CI workflow) or tests. */
export const PathClassSchema = Schema.Literals(PATH_CLASSES).annotate({
  description:
    "The class of a changed path: code (everything else), docs (documentation), gate-config (a gate tool's configuration or a CI workflow) or tests (test files and directories).",
  ...refusalOverride(
    (actual) =>
      `${JSON.stringify(actual)} is not a path class (expected one of ${PATH_CLASSES.join(", ")})`,
  ),
});
export type PathClass = Schema.Schema.Type<typeof PathClassSchema>;
