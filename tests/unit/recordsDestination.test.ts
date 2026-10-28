import { describe, expect, it } from "vitest";
import { classifyGhFailure } from "../../src/domain/records/ghFailure.js";
import {
  decideRecordsDestination,
  type RepoVisibility,
} from "../../src/domain/records/destination.js";
import type { RecordsDestination } from "../../src/schemas/recordsConfig.js";

const IN_REPO: RecordsDestination = { kind: "in-repo" };
const IN_REPO_ACKNOWLEDGED: RecordsDestination = {
  kind: "in-repo",
  acknowledgedUnknownVisibility: true,
};
const REPO: RecordsDestination = { kind: "repo", remote: "https://example.com/records.git" };

const reading = (visibility: RepoVisibility, ghError: string | null = null) => ({
  visibility,
  ghError,
});

const ACKNOWLEDGE_REMEDY =
  "set records.destination.acknowledgedUnknownVisibility to true once you have confirmed this repo is private, or disable transcripts";

describe("decideRecordsDestination", () => {
  it("allows a private source repo with transcripts on and an in-repo destination", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: reading("private"),
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO });
  });

  it("refuses a public source repo with transcripts on and an in-repo destination, naming the destination", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: reading("public"),
    });
    expect(decision.kind).toBe("refused");
    if (decision.kind === "refused") {
      expect(decision.reason).toBe("public-source-in-repo");
      expect(decision.destination).toEqual(IN_REPO);
      expect(decision.message).toContain("public");
      expect(decision.remedy.length).toBeGreaterThan(0);
    }
  });

  it("allows a public source repo with transcripts off and an in-repo destination", () => {
    const decision = decideRecordsDestination({
      transcript: false,
      destination: IN_REPO,
      visibility: reading("public"),
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO });
  });

  it("refuses an unknown-visibility source repo with transcripts on and no acknowledgement", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: reading("unknown"),
    });
    expect(decision.kind).toBe("refused");
    if (decision.kind === "refused") {
      expect(decision.reason).toBe("unacknowledged-unknown-visibility");
      expect(decision.message).toBe(
        "this repo's visibility could not be determined, and transcripts are enabled with an in-repo destination",
      );
      expect(decision.remedy).toBe(ACKNOWLEDGE_REMEDY);
    }
  });

  it("allows an unknown-visibility source repo with transcripts on once acknowledged", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO_ACKNOWLEDGED,
      visibility: reading("unknown", "error connecting to api.github.com"),
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO_ACKNOWLEDGED });
  });

  it("allows a dedicated destination whatever the visibility", () => {
    for (const visibility of ["public", "private", "unknown"] as const) {
      const decision = decideRecordsDestination({
        transcript: true,
        destination: REPO,
        visibility: reading(visibility),
      });
      expect(decision).toEqual({ kind: "allowed", destination: REPO });
    }
  });

  describe("an unknown visibility that gh explained", () => {
    const refusalFor = (ghError: string) => {
      const decision = decideRecordsDestination({
        transcript: true,
        destination: IN_REPO,
        visibility: reading("unknown", ghError),
      });
      if (decision.kind !== "refused") throw new Error("an unknown visibility must be refused");
      return decision;
    };

    it("quotes a network failure and suggests a retry, never the acknowledgement", () => {
      const refusal = refusalFor("error connecting to api.github.com");
      expect(refusal.message).toBe(
        "this repo's visibility could not be determined — gh: error connecting to api.github.com, and transcripts are enabled with an in-repo destination",
      );
      expect(refusal.remedy).toBe("retry once the network is back");
      expect(`${refusal.message} ${refusal.remedy}`).not.toContain("acknowledgedUnknownVisibility");
    });

    it("quotes an auth failure and suggests gh auth login, then a retry", () => {
      const refusal = refusalFor("To get started with GitHub CLI, please run:  gh auth login");
      expect(refusal.message).toContain(
        "— gh: To get started with GitHub CLI, please run:  gh auth login",
      );
      expect(refusal.remedy).toBe("run `gh auth login`, then retry");
      expect(`${refusal.message} ${refusal.remedy}`).not.toContain("acknowledgedUnknownVisibility");
    });

    it("quotes a no-remote failure and keeps the acknowledgement remedy", () => {
      const refusal = refusalFor("no git remotes found");
      expect(refusal.message).toContain("— gh: no git remotes found");
      expect(refusal.remedy).toBe(ACKNOWLEDGE_REMEDY);
    });
  });
});

describe("classifyGhFailure", () => {
  it.each([
    ["error connecting to api.github.com", "network"],
    [
      "Post https://api.github.com/graphql: dial tcp: lookup api.github.com: no such host",
      "network",
    ],
    ["could not resolve host: github.com", "network"],
    ["read tcp 10.0.0.2:5000: i/o timeout", "network"],
    ["net/http: TLS handshake timeout", "network"],
    ["connect: connection refused", "network"],
    ["To get started with GitHub CLI, please run:  gh auth login", "auth"],
    ["HTTP 401: Bad credentials (https://api.github.com/graphql)", "auth"],
    ["You are not logged in to any GitHub hosts", "auth"],
    ["GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)", "other"],
    ["no git remotes found", "other"],
    ["the operation hit a timeout", "other"],
    [null, "other"],
  ] as const)("reads %j as %s", (line, expected) => {
    expect(classifyGhFailure(line)).toBe(expected);
  });
});
