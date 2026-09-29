import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CORPUS_PARSERS,
  SESSION_ID_FIELDS,
  SESSION_ID_PLACEHOLDER,
  corpusFileContent,
  corpusPath,
  planCorpus,
  scrubDocument,
} from "../../../packages/schemas/build/corpus.js";
import { sha256 } from "../../../packages/schemas/build/generated.js";
import { renderShapeJsonSchema } from "../../../packages/schemas/build/jsonSchemas.js";
import { SNAPSHOT_FORMATS } from "../../../packages/schemas/build/snapshots.js";
import { FORMAT_IDS, isFormatId } from "../../../src/schemas/schemaUrl.js";
import { readSurveyedFixtures } from "./surveyedFixtures.js";

const HOME = "/Users/someone";
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function phaseRecordFixtures(shape: "v1" | "v2"): string[] {
  const dir = join(fixturesDir, "phase-record-manifest", shape);
  return readdirSync(dir)
    .toSorted()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

function firstPhaseStatus(): object {
  const [fixture] = readSurveyedFixtures("phase-status", "v1");
  return fixture!.document as object;
}

describe("scrubDocument", () => {
  it("replaces the home directory in string values and object keys", () => {
    const scrubbed = scrubDocument(
      {
        prefix: `${HOME}/.phax/worktrees/x`,
        exact: HOME,
        embedded: `cd ${HOME}/repo && ls ${HOME}`,
        [`${HOME}/key`]: 1,
        list: [`${HOME}/a`, { nested: `${HOME}/b` }],
      },
      HOME,
    );
    expect(scrubbed).toEqual({
      prefix: "~/.phax/worktrees/x",
      exact: "~",
      embedded: "cd ~/repo && ls ~",
      "~/key": 1,
      list: ["~/a", { nested: "~/b" }],
    });
  });

  it("leaves another home and a home-like prefix without a following / untouched", () => {
    const value = { other: "/Users/other/x", longer: `${HOME}2/x`, glued: `${HOME}-old` };
    expect(scrubDocument(value, HOME)).toEqual(value);
  });

  it("replaces every session id at any depth and keeps everything else", () => {
    const value = {
      claudeSessionId: "3c7080a6-7750-491b-92f1-24d5850b81a0",
      sessionCostUsd: 1.5,
      commitHash: "d9a7c6c792e4075492c9792a69a4d03d6b271da8",
      phases: [{ claudeSessionId: "cb90b50d-b392-4bee-8534-4adeebcfc144", n: 1 }],
    };
    expect(scrubDocument(value, HOME)).toEqual({
      ...value,
      claudeSessionId: SESSION_ID_PLACEHOLDER,
      phases: [{ claudeSessionId: SESSION_ID_PLACEHOLDER, n: 1 }],
    });
  });

  it("keeps key order and does not mutate its input", () => {
    const value = { b: `${HOME}/x`, a: 1 };
    const scrubbed = scrubDocument(value, HOME) as Record<string, unknown>;
    expect(Object.keys(scrubbed)).toEqual(["b", "a"]);
    expect(value.b).toBe(`${HOME}/x`);
  });

  it("is idempotent", () => {
    const once = scrubDocument(
      { p: `${HOME}/x`, claudeSessionId: "abc", q: [HOME, `${HOME}/y`] },
      HOME,
    );
    expect(scrubDocument(once, HOME)).toEqual(once);
  });

  it("scrubs no paths for an empty home or /", () => {
    const value = { p: "/Users/someone/x", claudeSessionId: "abc" };
    for (const home of ["", "/"]) {
      expect(scrubDocument(value, home)).toEqual({
        ...value,
        claudeSessionId: SESSION_ID_PLACEHOLDER,
      });
    }
  });
});

describe("corpusPath and corpusFileContent", () => {
  it("names a file by the first 16 hex chars of its content's sha256", () => {
    const content = corpusFileContent({ version: 1 });
    expect(content).toBe('{\n  "version": 1\n}\n');
    expect(corpusPath("registry", "v1", content)).toBe(
      `registry/v1/${sha256(content).slice(0, 16)}.json`,
    );
  });
});

describe("planCorpus", () => {
  it("classifies each document by the shape the package parses it as", () => {
    const [v1] = phaseRecordFixtures("v1");
    const [v2] = phaseRecordFixtures("v2");
    const [attribution] = readSurveyedFixtures("gate-attribution", "v0");
    const { entries, failures } = planCorpus(
      [
        { format: "phase-record-manifest", source: "a", text: v1! },
        { format: "phase-record-manifest", source: "b", text: v2! },
        { format: "gate-attribution", source: "c", text: JSON.stringify(attribution!.document) },
      ],
      HOME,
    );
    expect(failures).toEqual([]);
    expect(entries.map((e) => e.path.split("/").slice(0, 2).join("/")).toSorted()).toEqual([
      "gate-attribution/v0",
      "phase-record-manifest/v1",
      "phase-record-manifest/v2",
    ]);
    for (const entry of entries) {
      const [format, shape] = entry.path.split("/");
      expect(corpusPath(format as never, shape!, entry.content)).toBe(entry.path);
    }
  });

  it("writes the scrubbed document", () => {
    const document = firstPhaseStatus();
    const text = JSON.stringify({
      ...document,
      worktreePath: `${HOME}/.phax/worktrees/x/phase-01`,
      claudeSessionId: "3c7080a6-7750-491b-92f1-24d5850b81a0",
    });
    const { entries, failures } = planCorpus([{ format: "phase-status", source: "s", text }], HOME);
    expect(failures).toEqual([]);
    const written = JSON.parse(entries[0]!.content) as Record<string, unknown>;
    expect(written["worktreePath"]).toBe("~/.phax/worktrees/x/phase-01");
    expect(written["claudeSessionId"]).toBe(SESSION_ID_PLACEHOLDER);
  });

  it("keeps one entry for identical documents, and for documents differing only in their session id", () => {
    const document = firstPhaseStatus();
    const withSession = (id: string) => JSON.stringify({ ...document, claudeSessionId: id });
    const { entries } = planCorpus(
      [
        { format: "phase-status", source: "a", text: withSession("one") },
        { format: "phase-status", source: "b", text: withSession("one") },
        { format: "phase-status", source: "c", text: withSession("two") },
      ],
      HOME,
    );
    expect(entries).toHaveLength(1);
  });

  it("returns sorted entries, stable across input order", () => {
    const docs = [...phaseRecordFixtures("v1"), ...phaseRecordFixtures("v2")].map((text, i) => ({
      format: "phase-record-manifest" as const,
      source: `s${i}`,
      text,
    }));
    const forward = planCorpus(docs, HOME);
    const backward = planCorpus(docs.toReversed(), HOME);
    expect(forward).toEqual(backward);
    const paths = forward.entries.map((e) => e.path);
    expect(paths).toEqual(paths.toSorted());
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("reports a rejected document and a non-JSON text, naming source, format, path and message", () => {
    const { entries, failures } = planCorpus(
      [
        { format: "registry", source: "~/r.json", text: '{"version":1,"runs":"no"}' },
        { format: "run-status", source: "~/s.json", text: "not json" },
      ],
      HOME,
    );
    expect(entries).toEqual([]);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ source: "~/r.json", format: "registry", path: "runs" });
    expect(failures[0]!.message).not.toBe("");
    expect(failures[1]).toMatchObject({ source: "~/s.json", format: "run-status", path: "" });
    expect(failures[1]!.message).not.toBe("");
  });
});

describe("scrubbed fixtures", () => {
  // Every fixture file keyed by signature, and every one-document fixture of the phase record.
  const keyed = readdirSync(fixturesDir)
    .filter(isFormatId)
    .flatMap((format) =>
      readdirSync(join(fixturesDir, format))
        .filter((name) => name.endsWith(".json"))
        .flatMap((name) =>
          readSurveyedFixtures(format, name.slice(0, -".json".length)).map(
            ({ signature, document }) => ({
              label: `${format}/${name} ${signature}`,
              format,
              document,
            }),
          ),
        ),
    );
  const records = (["v1", "v2"] as const).flatMap((shape) =>
    phaseRecordFixtures(shape).map((text, i) => ({
      label: `phase-record-manifest/${shape}#${i}`,
      format: "phase-record-manifest" as const,
      document: JSON.parse(text) as unknown,
    })),
  );

  it.each([...keyed, ...records].map((f) => [f.label, f] as const))(
    "%s still parses once scrubbed",
    (_label, { format, document }) => {
      const result = CORPUS_PARSERS[format](scrubDocument(document, HOME));
      expect(result.ok).toBe(true);
    },
  );
});

describe("CORPUS_PARSERS", () => {
  it("has one parser per format id", () => {
    expect(Object.keys(CORPUS_PARSERS).toSorted()).toEqual([...FORMAT_IDS].toSorted());
  });
});

/** Every property name a rendered JSON Schema declares, at any depth. */
function propertyNames(schema: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(schema)) for (const item of schema) propertyNames(item, into);
  else if (typeof schema === "object" && schema !== null) {
    for (const [key, value] of Object.entries(schema)) {
      if (key === "properties" && typeof value === "object" && value !== null) {
        for (const name of Object.keys(value)) into.add(name);
      }
      propertyNames(value, into);
    }
  }
  return into;
}

describe("SESSION_ID_FIELDS", () => {
  it("names every session-id property of every shape of every format", () => {
    const names = new Set<string>();
    for (const format of SNAPSHOT_FORMATS) {
      for (const shape of [...format.released, format.current]) {
        const rendered = renderShapeJsonSchema(format.id, shape.schema);
        if (!rendered.ok) throw new Error(`${format.id} ${shape.name}: ${rendered.reason}`);
        propertyNames(JSON.parse(rendered.content), names);
      }
    }
    const sessionIds = [...names].filter((name) => /session_?id$/i.test(name));
    expect(sessionIds).not.toEqual([]);
    for (const name of sessionIds) expect(SESSION_ID_FIELDS).toContain(name);
  });
});
