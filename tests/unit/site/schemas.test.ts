import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotPath } from "../../../packages/schemas/build/snapshots.js";
import {
  PUBLIC_DIR,
  generateSite,
  schemasLine,
  type SiteJson,
} from "../../../site/build/generate.js";
import { INTRO, definePageMap } from "../../../site/build/pageMap.js";
import {
  SCHEMA_INDEX_PATH,
  checkLedger,
  parseLedger,
  parseSchemaIndex,
  publicSchemas,
  readSchemaSources,
  servedSchemas,
  type SchemaSources,
} from "../../../site/build/schemas.js";
import { FORMAT_IDS } from "../../../src/schemas/schemaUrl.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const real = readSchemaSources(repoRoot);
const realVersion = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
).version;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Every format with `pre-schema` and 0.17.0; registry also at 0.18.0, run-status at next. */
function madeUpSnapshots(): Map<string, Map<string, Uint8Array>> {
  const snapshots = new Map<string, Map<string, Uint8Array>>(
    FORMAT_IDS.map((id) => [
      id,
      new Map([
        ["pre-schema", bytes(`{"pre":"${id}"}\n`)],
        ["0.17.0", bytes(`{"id":"${id}","at":"0.17.0"}\n`)],
      ]),
    ]),
  );
  snapshots.get("registry")?.set("0.18.0", bytes('{"id":"registry","at":"0.18.0"}\n'));
  snapshots.get("run-status")?.set("next", bytes('{"id":"run-status","at":"next"}\n'));
  return snapshots;
}

function namesOf(
  snapshots: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>,
): Map<string, ReadonlyArray<string>> {
  return new Map([...snapshots].map(([id, named]) => [id, [...named.keys()]]));
}

describe("servedSchemas on the real ledger and snapshots", () => {
  const ledger = parseLedger(real.ledger ?? "");

  it("serves exactly one /schemas/<id>/0.17.0.json per format, byte for byte", () => {
    expect(ledger).toEqual({ releases: ["0.17.0"] });
    if (ledger === undefined) return;
    const served = servedSchemas(ledger, real.snapshots);
    expect(served.files.size).toBe(15);
    expect([...served.files.keys()]).toEqual(
      FORMAT_IDS.map((id) => `/schemas/${id}/0.17.0.json`).toSorted(),
    );
    for (const id of FORMAT_IDS) {
      expect(served.files.get(`/schemas/${id}/0.17.0.json`)).toEqual(
        readFileSync(join(repoRoot, snapshotPath(id, "0.17.0"))),
      );
    }
    for (const path of served.files.keys()) expect(path).not.toMatch(/pre-schema|next/);
  });

  it("agrees with package.json and the snapshots", () => {
    if (ledger === undefined) return;
    expect(checkLedger(ledger, realVersion, namesOf(real.snapshots))).toEqual([]);
  });

  it("is committed as 2-space JSON plus a newline", () => {
    expect(real.ledger).toBe(`${JSON.stringify(parseLedger(real.ledger ?? ""), null, 2)}\n`);
  });
});

describe("servedSchemas on a made-up ledger", () => {
  const snapshots = madeUpSnapshots();
  const served = servedSchemas({ releases: ["0.17.0", "0.18.0"] }, snapshots);

  it("serves each format's latest release-named snapshot at or before each release", () => {
    expect(served.files.size).toBe(30);
    expect(served.files.get("/schemas/registry/0.18.0.json")).toBe(
      snapshots.get("registry")?.get("0.18.0"),
    );
    expect(served.files.get("/schemas/run-status/0.18.0.json")).toBe(
      snapshots.get("run-status")?.get("0.17.0"),
    );
    for (const id of FORMAT_IDS) {
      expect(served.files.get(`/schemas/${id}/0.17.0.json`)).toBe(snapshots.get(id)?.get("0.17.0"));
    }
    const contents = [...served.files.values()].map((content) => new TextDecoder().decode(content));
    expect(contents.some((content) => content.includes('"pre"'))).toBe(false);
    expect(contents.some((content) => content.includes('"next"'))).toBe(false);
  });

  it("indexes exactly the served paths, sorted", () => {
    const index = parseSchemaIndex(served.index);
    expect(index).toEqual({ releases: ["0.17.0", "0.18.0"], paths: [...served.files.keys()] });
    expect(index?.paths).toEqual([...(index?.paths ?? [])].toSorted());
    expect(served.index).toBe(`${JSON.stringify(index, null, 2)}\n`);
  });

  it("answers /schemas/* as JSON readable from any origin", () => {
    expect(served.headers.split("\n")).toEqual([
      "/schemas/*",
      "  Content-Type: application/json",
      "  Access-Control-Allow-Origin: *",
      "  Cache-Control: public, max-age=3600",
      "",
    ]);
  });
});

describe("checkLedger", () => {
  const names = namesOf(madeUpSnapshots());

  it("passes a ledger that agrees with package.json and the snapshots", () => {
    expect(checkLedger({ releases: ["0.17.0", "0.18.0"] }, "0.18.0", names)).toEqual([]);
  });

  it("fails a last entry that differs from package.json", () => {
    expect(checkLedger({ releases: ["0.17.0", "0.18.0"] }, "0.19.0", names)).toEqual([
      "✗ release ledger: last entry 0.18.0, package.json version 0.19.0",
    ]);
  });

  it("fails a release-named snapshot whose release the ledger lacks", () => {
    expect(checkLedger({ releases: ["0.17.0"] }, "0.18.0", names)).toEqual([
      "✗ release ledger: last entry 0.17.0, package.json version 0.18.0",
      "✗ packages/schemas/snapshots/registry/0.18.0.schema.json: release 0.18.0 is not in the release ledger",
    ]);
  });

  it("fails entries that are not strictly increasing", () => {
    expect(checkLedger({ releases: ["0.17.0", "0.18.0", "0.18.0"] }, "0.18.0", names)).toEqual([
      "✗ release ledger: 0.18.0 follows 0.18.0; entries must be strictly increasing",
    ]);
  });

  it("fails a first entry that is not the first supported release", () => {
    expect(checkLedger({ releases: ["0.16.0", "0.17.0", "0.18.0"] }, "0.18.0", names)).toEqual([
      "✗ release ledger: first entry 0.16.0, first supported release 0.17.0",
    ]);
  });

  it("fails an empty ledger and an entry that is not X.Y.Z", () => {
    expect(checkLedger({ releases: [] }, "0.18.0", names)).toEqual([
      "✗ release ledger: lists no release",
    ]);
    expect(checkLedger({ releases: ["0.17.0", "next", "0.18.0"] }, "0.18.0", names)).toEqual([
      '✗ release ledger: "next" is not X.Y.Z',
    ]);
  });
});

describe("the generator serves the schemas", () => {
  const README = "# tool\n\nRuns plans.\n\n## Persisted formats\n\nEvery format.\n";
  const MAP = definePageMap({
    repository: "https://github.com/example/tool",
    readme: [
      { route: "/", title: "tool", sections: [INTRO] },
      {
        route: "/reference/formats",
        title: "File formats",
        sections: ["Persisted formats"],
        generated: "served-schemas",
      },
    ],
    files: [],
  });
  const snapshots = madeUpSnapshots();
  snapshots.get("registry")?.delete("0.18.0");
  const schemas: SchemaSources = {
    ledger: `${JSON.stringify({ releases: ["0.17.0"] }, null, 2)}\n`,
    snapshots,
  };
  const generate = (version: string, sources: SchemaSources | null = schemas) =>
    generateSite({
      files: new Map([["README.md", README]]),
      pageMap: MAP,
      version,
      ...(sources === null ? {} : { schemas: sources }),
    });

  it("writes the served files, the index and _headers, and lists every URL on the formats page", () => {
    const result = generate("0.17.0");
    expect(result.findings).toEqual([]);
    expect([...result.publicFiles.keys()]).toEqual(
      [
        "/_headers",
        ...FORMAT_IDS.map((id) => `/schemas/${id}/0.17.0.json`),
        SCHEMA_INDEX_PATH,
      ].toSorted(),
    );
    expect(PUBLIC_DIR).toBe("docs/public");
    const page = result.files.get("docs/reference/formats.md") ?? "";
    expect(page).toContain("## Served JSON Schemas \\{#served-json-schemas\\}");
    for (const id of FORMAT_IDS) {
      expect(page).toContain(`- \`https://docs.phax.run/schemas/${id}/0.17.0.json\``);
    }
    expect(result.files.get("docs/index.md")).not.toContain("schemas");
    const site = JSON.parse(result.files.get("site.json") ?? "{}") as SiteJson;
    expect(site.headingIds["/reference/formats"]).toEqual([
      "persisted-formats",
      "served-json-schemas",
    ]);
    expect(schemasLine(result.summary)).toBe(
      "site: schemas — 15 served (ledger: 1 × 15 formats), ledger agrees with package.json",
    );
  });

  it("fails on a ledger that disagrees with package.json, writing nothing", () => {
    const result = generate("0.18.0");
    expect(result.findings).toContain(
      "✗ release ledger: last entry 0.17.0, package.json version 0.18.0",
    );
    expect(result.files.size).toBe(0);
    expect(result.publicFiles.size).toBe(0);
  });

  it("fails on a missing ledger", () => {
    expect(generate("0.17.0", { ...schemas, ledger: undefined }).findings).toEqual([
      "✗ packages/schemas/releases.json: the release ledger is missing",
    ]);
  });

  it("fails when the formats page asks for schemas the build was not given", () => {
    expect(generate("0.17.0", null).findings).toEqual([
      "✗ page map: /reference/formats lists the served schemas, but the build has none",
    ]);
  });

  it("serves the same bytes from publicSchemas", () => {
    const direct = publicSchemas(schemas, "0.17.0");
    expect(direct.findings).toEqual([]);
    expect(generate("0.17.0").publicFiles).toEqual(direct.files);
  });
});
