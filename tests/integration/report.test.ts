import { Effect, Either, Layer } from "effect";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { report } from "../../src/app/report.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";

const PHAX_HOME = "/fake-home/.phax";
const STATE_ROOT = "/fake-state";
const SHORT_NAME = "my-run";

const SAMPLE_RECORD = JSON.stringify({
  ts: "2026-06-19T10:00:00.000Z",
  type: "step.started",
  runId: "my-run-001",
  step: "phase-01",
});

function makeInput(
  overrides: Partial<Parameters<typeof report>[0]> = {},
): Parameters<typeof report>[0] {
  return {
    phaxHomeDir: PHAX_HOME,
    noGist: false,
    phaxVersion: "0.1.2",
    repo: "/project",
    ...overrides,
  };
}

async function runReport(
  input: Parameters<typeof report>[0],
  fs: ReturnType<typeof makeFakeFileSystem>,
  github: ReturnType<typeof makeFakeGitHub>,
): Promise<
  Either.Either<
    string,
    import("../../src/ports/fs.js").FsError | import("../../src/ports/github.js").GitHubError
  >
> {
  const layer = Layer.mergeAll(fs.layer, github.layer);
  return Effect.runPromise(Effect.either(report(input).pipe(Effect.provide(layer))));
}

describe("report (integration)", () => {
  it("creates an issue from a per-run semantic.jsonl", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    const runPath = join(STATE_ROOT, "runs", SHORT_NAME, "semantic.jsonl");
    fs.setFile(runPath, SAMPLE_RECORD + "\n");

    const result = await runReport(
      makeInput({ shortName: SHORT_NAME, stateRoot: STATE_ROOT }),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toContain("github.com");
    }

    const issueCalls = github.calls.filter((c) => c.method === "createIssue");
    expect(issueCalls).toHaveLength(1);
    const issueCall = issueCalls[0] as Extract<
      (typeof github.calls)[number],
      { method: "createIssue" }
    >;
    expect(issueCall.title).toContain("run: my-run");
  });

  it("creates an issue from the latest daily journal when no shortName", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    const journalPath = join(PHAX_HOME, "telemetry-2026-06-19.jsonl");
    fs.addDir(PHAX_HOME);
    fs.setFile(journalPath, SAMPLE_RECORD + "\n");

    const result = await runReport(
      makeInput(),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isRight(result)).toBe(true);
    const issueCalls = github.calls.filter((c) => c.method === "createIssue");
    expect(issueCalls).toHaveLength(1);
    const issueCall = issueCalls[0] as Extract<
      (typeof github.calls)[number],
      { method: "createIssue" }
    >;
    expect(issueCall.title).toContain("global: 2026-06-19");
  });

  it("creates a gist for large logs and references it in the issue body", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    // Create a log that exceeds the 32KB threshold
    const bigRecord = JSON.stringify({ ts: "2026-06-19T10:00:00.000Z", data: "x".repeat(500) });
    const bigContent = Array.from({ length: 100 }, () => bigRecord).join("\n") + "\n";
    const journalPath = join(PHAX_HOME, "telemetry-2026-06-19.jsonl");
    fs.addDir(PHAX_HOME);
    fs.setFile(journalPath, bigContent);
    github.setCreatedGistUrl("https://gist.github.com/user/biggist");

    const result = await runReport(
      makeInput(),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isRight(result)).toBe(true);

    const gistCalls = github.calls.filter((c) => c.method === "createGist");
    expect(gistCalls).toHaveLength(1);
    const gistCall = gistCalls[0] as Extract<
      (typeof github.calls)[number],
      { method: "createGist" }
    >;
    expect(gistCall.public).toBe(false);

    // The body file written to fs should contain the gist URL
    const issueCalls = github.calls.filter((c) => c.method === "createIssue");
    expect(issueCalls).toHaveLength(1);
    const issueCall = issueCalls[0] as Extract<
      (typeof github.calls)[number],
      { method: "createIssue" }
    >;
    const bodyContent = fs.getFile(issueCall.bodyFile);
    expect(bodyContent).toContain("https://gist.github.com/user/biggist");
  });

  it("skips gist creation when --no-gist is set", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    const bigRecord = JSON.stringify({ ts: "2026-06-19T10:00:00.000Z", data: "x".repeat(500) });
    const bigContent = Array.from({ length: 100 }, () => bigRecord).join("\n") + "\n";
    const journalPath = join(PHAX_HOME, "telemetry-2026-06-19.jsonl");
    fs.addDir(PHAX_HOME);
    fs.setFile(journalPath, bigContent);

    const result = await runReport(
      makeInput({ noGist: true }),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isRight(result)).toBe(true);
    const gistCalls = github.calls.filter((c) => c.method === "createGist");
    expect(gistCalls).toHaveLength(0);
  });

  it("fails with a clear error when no journal files exist", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    fs.addDir(PHAX_HOME);

    const result = await runReport(
      makeInput(),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("No telemetry journal files found");
    }
  });

  it("propagates GitHubError when issue creation fails", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: github, layer: githubLayer } = makeFakeGitHub();

    const journalPath = join(PHAX_HOME, "telemetry-2026-06-19.jsonl");
    fs.addDir(PHAX_HOME);
    fs.setFile(journalPath, SAMPLE_RECORD + "\n");
    github.failNextCreateIssue("gh: not logged in");

    const result = await runReport(
      makeInput(),
      { impl: fs, layer: fsLayer },
      { impl: github, layer: githubLayer },
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("not logged in");
    }
  });
});
