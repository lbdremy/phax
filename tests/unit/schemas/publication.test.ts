import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePublication, encodePublication } from "../../../src/schemas/publication.js";
import type { Publication } from "../../../src/schemas/publication.js";

const validRecord: Publication = {
  version: 1,
  enabled: true,
  provider: "github",
  remote: "origin",
  branch: "phax/my-run",
  pushStatus: "pushed",
  prStatus: "created",
  pullRequestUrl: "https://github.com/org/repo/pull/42",
  createdAt: "2026-06-12T10:00:00.000Z",
};

describe("PublicationSchema decode", () => {
  it("decodes a full valid record", () => {
    const result = decodePublication(validRecord);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.prStatus).toBe("created");
      expect(result.right.pullRequestUrl).toBe("https://github.com/org/repo/pull/42");
    }
  });

  it("decodes a record without optional fields", () => {
    const minimal = {
      version: 1,
      enabled: false,
      provider: "github",
      remote: "origin",
      branch: "phax/my-run",
      pushStatus: "not_attempted",
      prStatus: "not_attempted",
      createdAt: "2026-06-12T10:00:00.000Z",
    };
    const result = decodePublication(minimal);
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes a failed record with failureReason", () => {
    const failed = {
      ...validRecord,
      pushStatus: "failed",
      prStatus: "not_attempted",
      failureReason: "gh is not authenticated",
    };
    const result = decodePublication(failed);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.failureReason).toBe("gh is not authenticated");
    }
  });

  it("rejects an invalid provider", () => {
    const result = decodePublication({ ...validRecord, provider: "gitlab" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid pushStatus", () => {
    const result = decodePublication({ ...validRecord, pushStatus: "in_progress" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid prStatus", () => {
    const result = decodePublication({ ...validRecord, prStatus: "pending" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects wrong schema version", () => {
    const result = decodePublication({ ...validRecord, version: 2 });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PublicationSchema round-trip", () => {
  it("encode then decode is identity", () => {
    const encoded = encodePublication(validRecord);
    const decoded = decodePublication(encoded);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(validRecord);
    }
  });

  it("encode then decode preserves optional fields", () => {
    const withOptionals: Publication = {
      ...validRecord,
      baseBranch: "main",
      failureReason: "some error",
    };
    const encoded = encodePublication(withOptionals);
    const decoded = decodePublication(encoded);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.baseBranch).toBe("main");
      expect(decoded.right.failureReason).toBe("some error");
    }
  });
});
