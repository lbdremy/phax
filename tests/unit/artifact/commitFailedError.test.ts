import { describe, expect, it } from "vitest";
import { ArtifactCommitFailedError } from "../../../src/domain/errors.js";

const SIDECAR_SENTENCE =
  "is safe: phax compares its parsed document with the Markdown, not its bytes";

describe("ArtifactCommitFailedError message", () => {
  it("names the paths, the cause, a hook, and a pasteable commit carrying the trailers (spec + sidecar)", () => {
    const err = new ArtifactCommitFailedError({
      paths: ["docs/specs/2601010000-made-up.md", "docs/specs/2601010000-made-up.json"],
      cause: "pre-commit hook failed: fmt --check",
      commitMessage: {
        subject: "docs(specs): draft made-up",
        body: [
          "Authored headless (model-x / high); it's the sidecar's rendering.",
          "",
          "Artifact: docs/specs/2601010000-made-up.md",
          "Authoring-Id: 2601010000-made-up",
        ].join("\n"),
      },
    });
    const message = err.message;

    expect(message).toContain("docs/specs/2601010000-made-up.md");
    expect(message).toContain("docs/specs/2601010000-made-up.json");
    expect(message).toContain("pre-commit hook failed: fmt --check");
    expect(message).toContain("commit hook");
    expect(message).toContain("formatter");
    expect(message).not.toContain("authoring");
    expect(message).toContain(
      "git commit -m 'docs(specs): draft made-up' -m 'Authored headless (model-x / high); it'\\''s the sidecar'\\''s rendering.\n\nArtifact: docs/specs/2601010000-made-up.md\nAuthoring-Id: 2601010000-made-up' -- 'docs/specs/2601010000-made-up.md' 'docs/specs/2601010000-made-up.json'",
    );
    expect(message).toContain("\nAuthoring-Id: 2601010000-made-up'");
    expect(message).toContain(`(docs/specs/2601010000-made-up.json) ${SIDECAR_SENTENCE}`);
  });

  it("adds no sidecar sentence for a hand-authored plan and the approvals ledger", () => {
    const err = new ArtifactCommitFailedError({
      paths: ["docs/plans/2601010000-made-up-plan.md", "docs/plans/approvals.json"],
      cause: "fatal: unable to auto-detect email address",
      commitMessage: {
        subject: "chore(plans): approve made-up",
        body: "Transitions docs/plans/2601010000-made-up-plan.md to Approved (approve).",
      },
    });
    const message = err.message;

    expect(message).toContain(
      "Wrote docs/plans/2601010000-made-up-plan.md, docs/plans/approvals.json but the commit failed: fatal: unable to auto-detect email address.",
    );
    expect(message).toContain(
      "git commit -m 'chore(plans): approve made-up' -m 'Transitions docs/plans/2601010000-made-up-plan.md to Approved (approve).' -- 'docs/plans/2601010000-made-up-plan.md' 'docs/plans/approvals.json'",
    );
    expect(message).not.toContain(SIDECAR_SENTENCE);
  });
});
