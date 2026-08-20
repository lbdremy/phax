import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  RecordsConfigSchema,
  RecordsDestinationSchema,
  RecordsRemoteSchema,
  resolveRecordsConfig,
} from "../../src/schemas/recordsConfig.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";

const decodeRecordsConfig = Schema.decodeUnknownEither(RecordsConfigSchema, {
  onExcessProperty: "error",
});
const decodeRecordsDestination = Schema.decodeUnknownEither(RecordsDestinationSchema, {
  onExcessProperty: "error",
});
const decodeRecordsRemote = Schema.decodeUnknownEither(RecordsRemoteSchema);

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  gateProfiles: { full: ["pnpm test"] },
} as const;

describe("RecordsRemoteSchema", () => {
  it("accepts an https:// remote", () => {
    expect(Either.isRight(decodeRecordsRemote("https://example.com/acme/records.git"))).toBe(true);
  });

  it("accepts an ssh:// remote", () => {
    expect(Either.isRight(decodeRecordsRemote("ssh://git@example.com/acme/records.git"))).toBe(
      true,
    );
  });

  it("accepts a git@host:path remote", () => {
    expect(Either.isRight(decodeRecordsRemote("git@github.com:acme/phax-records.git"))).toBe(true);
  });

  it("rejects an ext:: transport (remote code execution at clone time)", () => {
    const result = decodeRecordsRemote("ext::sh -c 'echo pwned'");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a bare filesystem path", () => {
    expect(Either.isLeft(decodeRecordsRemote("/var/records/repo.git"))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(Either.isLeft(decodeRecordsRemote(""))).toBe(true);
  });

  it("names the field and the accepted forms in the rejection message", () => {
    const result = decodeRecordsRemote("ext::sh -c 'x'");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const message = String(result.left);
      expect(message).toContain("records.destination.remote");
      expect(message).toContain("https://");
      expect(message).toContain("ssh://");
      expect(message).toContain("git@host:path");
    }
  });
});

describe("RecordsDestinationSchema", () => {
  it("decodes the in-repo variant", () => {
    const result = decodeRecordsDestination({ kind: "in-repo" });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes the repo variant with a remote", () => {
    const result = decodeRecordsDestination({
      kind: "repo",
      remote: "git@github.com:acme/phax-records.git",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects the repo variant without a remote", () => {
    expect(Either.isLeft(decodeRecordsDestination({ kind: "repo" }))).toBe(true);
  });

  it("rejects a struct carrying both kind: in-repo and a remote", () => {
    const result = decodeRecordsDestination({
      kind: "in-repo",
      remote: "git@github.com:acme/phax-records.git",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(Either.isLeft(decodeRecordsDestination({ kind: "s3" }))).toBe(true);
  });
});

describe("RecordsConfigSchema", () => {
  it("decodes a full in-repo records config", () => {
    const result = decodeRecordsConfig({
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: true,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes a full repo records config", () => {
    const result = decodeRecordsConfig({
      transcript: true,
      destination: { kind: "repo", remote: "git@github.com:acme/phax-records.git" },
      autoPush: false,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a records config missing a required field", () => {
    expect(
      Either.isLeft(decodeRecordsConfig({ transcript: true, destination: { kind: "in-repo" } })),
    ).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = decodeRecordsConfig({
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: true,
      bogus: "value",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("resolveRecordsConfig", () => {
  it("resolves records off when the block is absent", () => {
    const resolved = resolveRecordsConfig(undefined);
    expect(resolved.enabled).toBe(false);
  });

  it("resolves an in-repo config as enabled with its provided values", () => {
    const resolved = resolveRecordsConfig({
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: true,
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.transcript).toBe(true);
    expect(resolved.destination).toEqual({ kind: "in-repo" });
    expect(resolved.autoPush).toBe(true);
  });

  it("resolves a repo config carrying its remote", () => {
    const resolved = resolveRecordsConfig({
      transcript: false,
      destination: { kind: "repo", remote: "https://example.com/acme/records.git" },
      autoPush: false,
    });
    expect(resolved.destination).toEqual({
      kind: "repo",
      remote: "https://example.com/acme/records.git",
    });
  });
});

describe("PhaxConfigSchema with records block", () => {
  it("decodes phax.json with a records block present", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      records: { transcript: true, destination: { kind: "in-repo" }, autoPush: true },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.records?.transcript).toBe(true);
    }
  });

  it("decodes phax.json without a records block", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.records).toBeUndefined();
    }
  });

  it("rejects a records block with an unsafe remote", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      records: {
        transcript: true,
        destination: { kind: "repo", remote: "ext::sh -c 'x'" },
        autoPush: true,
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
