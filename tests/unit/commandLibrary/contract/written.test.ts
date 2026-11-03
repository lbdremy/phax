import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { Written, written } from "../../../../src/cli/commandLibrary/contract/index.js";
import { WRITTEN_FIXTURE } from "../../../../src/cli/commandLibrary/contract/conformance/cases.js";

interface Fixture {
  readonly cases: ReadonlyArray<{
    readonly path: string;
    readonly bytes: string;
    readonly record: Written;
  }>;
}

// The one oracle of the written-file record: the library's Rust twin reads this same file.
const fixture: Fixture = JSON.parse(
  readFileSync(new URL("./fixtures/written-record.json", import.meta.url), "utf8"),
) as Fixture;

describe("written", () => {
  it("holds two cases, a JSON document with a $schema and a Markdown file", () => {
    expect(fixture.cases.map((c) => c.path)).toEqual(["out/a.json", "out/b.md"]);
    expect(fixture.cases[0]?.record.format).toBe(
      "https://docs.steme.dev/schemas/ledger/1.0.0.json",
    );
    expect(fixture.cases[1]?.record.format).toBeNull();
  });

  for (const { path, bytes, record } of fixture.cases) {
    it(`makes the fixture's record of ${path}`, async () => {
      const made = await Effect.runPromise(written(path, new TextEncoder().encode(bytes)));
      expect(made).toEqual(record);
    });

    it(`agrees with node:crypto on the digest of ${path}`, () => {
      const digest = createHash("sha256").update(bytes, "utf8").digest("hex");
      expect(record.digest).toBe(`sha256:${digest}`);
      expect(record.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  }

  it("is the case the conformance suite's written.record makes", () => {
    const first = fixture.cases[0];
    expect(WRITTEN_FIXTURE.path).toBe(first?.path);
    expect(WRITTEN_FIXTURE.bytes).toBe(first?.bytes);
    expect(WRITTEN_FIXTURE.record).toEqual(first?.record);
  });

  it("reads format as null for bytes that are not a JSON object holding a string $schema", async () => {
    const cases = ["[1]", "not json", '{"$schema": 1}', '{"a": 1}', "null", ""];
    for (const text of cases) {
      const made = await Effect.runPromise(written("x", new TextEncoder().encode(text)));
      expect(made.format).toBeNull();
    }
  });

  it("encodes to the record's JSON through its schema", () => {
    const record = fixture.cases[0]?.record as Written;
    expect(Schema.encodeSync(Written)(record)).toEqual(record);
  });
});
