import { readFileSync, readdirSync } from "node:fs";
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
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  SCHEMA_BORN_FORMAT_IDS,
  compareReleases,
  isRelease,
} from "../../../src/schemas/schemaUrl.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const real = readSchemaSources(repoRoot);
const realVersion = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
).version;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Every format with a pre-schema shape at `pre-schema` and 0.17.0; registry
 * also at 0.18.0, run-status at next. Every format born with $schema at next
 * only, so nothing serves it yet.
 */
function madeUpSnapshots(): Map<string, Map<string, Uint8Array>> {
  const snapshots = new Map<string, Map<string, Uint8Array>>([
    ...PRE_SCHEMA_FORMAT_IDS.map(
      (id) =>
        [
          id,
          new Map([
            ["pre-schema", bytes(`{"pre":"${id}"}\n`)],
            ["0.17.0", bytes(`{"id":"${id}","at":"0.17.0"}\n`)],
          ]),
        ] as const,
    ),
    ...SCHEMA_BORN_FORMAT_IDS.map(
      (id) => [id, new Map([["next", bytes(`{"id":"${id}","at":"next"}\n`)]])] as const,
    ),
  ]);
  snapshots.get("registry")?.set("0.18.0", bytes('{"id":"registry","at":"0.18.0"}\n'));
  snapshots.get("run-status")?.set("next", bytes('{"id":"run-status","at":"next"}\n'));
  return snapshots;
}

/**
 * The first release a format is served at: its lowest release-named
 * snapshot, or undefined while it has none (a format born with $schema
 * before the release that ships it).
 */
function servedFrom(id: string): string | undefined {
  return [...(real.snapshots.get(id)?.keys() ?? [])]
    .filter((name) => isRelease(name))
    .toSorted(compareReleases)[0];
}

function namesOf(
  snapshots: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>,
): Map<string, ReadonlyArray<string>> {
  return new Map([...snapshots].map(([id, named]) => [id, [...named.keys()]]));
}

describe("servedSchemas on the real ledger and snapshots", () => {
  const ledger = parseLedger(real.ledger ?? "");

  // A format born with $schema is served from the release whose snapshot
  // first names it; every format with a pre-schema shape from 0.17.0.
  it("serves one /schemas/<id>/<release>.json per format and release from the format's first, 0.17.0 byte for byte", () => {
    expect(ledger?.releases[0]).toBe("0.17.0");
    expect(ledger?.releases.at(-1)).toBe(realVersion);
    if (ledger === undefined) return;
    for (const id of PRE_SCHEMA_FORMAT_IDS) expect(servedFrom(id), id).toBe("0.17.0");
    const served = servedSchemas(ledger, real.snapshots);
    expect([...served.files.keys()].toSorted()).toEqual(
      ledger.releases
        .flatMap((release) =>
          FORMAT_IDS.filter((id) => {
            const first = servedFrom(id);
            return first !== undefined && compareReleases(first, release) <= 0;
          }).map((id) => `/schemas/${id}/${release}.json`),
        )
        .toSorted(),
    );
    for (const id of PRE_SCHEMA_FORMAT_IDS) {
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
    expect(served.files.size).toBe(28);
    expect(served.files.get("/schemas/registry/0.18.0.json")).toBe(
      snapshots.get("registry")?.get("0.18.0"),
    );
    expect(served.files.get("/schemas/run-status/0.18.0.json")).toBe(
      snapshots.get("run-status")?.get("0.17.0"),
    );
    for (const id of PRE_SCHEMA_FORMAT_IDS) {
      expect(served.files.get(`/schemas/${id}/0.17.0.json`)).toBe(snapshots.get(id)?.get("0.17.0"));
    }
    for (const id of SCHEMA_BORN_FORMAT_IDS) {
      expect([...served.files.keys()].filter((path) => path.includes(`/${id}/`))).toEqual([]);
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

describe("publicSchemas with retired schemas", () => {
  const ledger = `${JSON.stringify({ releases: ["0.17.0", "0.18.0"] }, null, 2)}\n`;
  const copy = bytes('{"retired":"old-format","at":"0.17.0"}\n');
  const sources = (
    retired: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>,
  ): SchemaSources => ({ ledger, snapshots: madeUpSnapshots(), retired });

  it("serves each retired copy byte for byte at its path and lists it beside the snapshot-served paths", () => {
    const result = publicSchemas(
      sources(new Map([["old-format", new Map([["0.17.0", copy]])]])),
      "0.18.0",
    );
    expect(result.findings).toEqual([]);
    expect(result.files.get("/schemas/old-format/0.17.0.json")).toBe(copy);
    const current = servedSchemas(parseLedger(ledger) ?? { releases: [] }, madeUpSnapshots());
    const paths = [...current.files.keys(), "/schemas/old-format/0.17.0.json"].toSorted();
    expect(result.served).toEqual(paths);
    const index = parseSchemaIndex(new TextDecoder().decode(result.files.get(SCHEMA_INDEX_PATH)));
    expect(index).toEqual({ releases: ["0.17.0", "0.18.0"], paths });
  });

  it("serves nothing for a ledger release the retired id has no copy for", () => {
    const result = publicSchemas(
      sources(new Map([["old-format", new Map([["0.17.0", copy]])]])),
      "0.18.0",
    );
    expect(result.files.has("/schemas/old-format/0.18.0.json")).toBe(false);
    expect(result.served.filter((path) => path.includes("/old-format/"))).toEqual([
      "/schemas/old-format/0.17.0.json",
    ]);
  });

  it("fails a retired id that is a current format id, serving nothing", () => {
    const result = publicSchemas(
      sources(new Map([["registry", new Map([["0.18.0", copy]])]])),
      "0.18.0",
    );
    expect(result.findings).toEqual([
      "✗ site/retired-schemas/registry: registry is a current format id",
      "✗ site/retired-schemas/registry/0.18.0.json: /schemas/registry/0.18.0.json is already served",
    ]);
    expect(result.files.size).toBe(0);
  });

  it("fails a retired release the ledger lacks, serving nothing", () => {
    const result = publicSchemas(
      sources(new Map([["old-format", new Map([["0.16.0", copy]])]])),
      "0.18.0",
    );
    expect(result.findings).toEqual([
      "✗ site/retired-schemas/old-format/0.16.0.json: release 0.16.0 is not in the release ledger",
    ]);
    expect(result.files.size).toBe(0);
  });

  it("serves every copy under site/retired-schemas/ of the real repository byte for byte", () => {
    const result = publicSchemas(real, realVersion);
    expect(result.findings).toEqual([]);
    const root = join(repoRoot, "site/retired-schemas");
    const copies = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(root, entry.name)).map((file) => [entry.name, file] as const),
      );
    expect(copies.length).toBeGreaterThan(0);
    for (const [id, file] of copies) {
      expect(result.served).toContain(`/schemas/${id}/${file}`);
      expect(result.files.get(`/schemas/${id}/${file}`)).toEqual(
        readFileSync(join(root, id, file)),
      );
    }
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
    retired: new Map(),
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
        ...PRE_SCHEMA_FORMAT_IDS.map((id) => `/schemas/${id}/0.17.0.json`),
        SCHEMA_INDEX_PATH,
      ].toSorted(),
    );
    expect(PUBLIC_DIR).toBe("docs/public");
    const page = result.files.get("docs/reference/formats.md") ?? "";
    expect(page).toContain("## Served JSON Schemas \\{#served-json-schemas\\}");
    for (const id of PRE_SCHEMA_FORMAT_IDS) {
      expect(page).toContain(`- \`https://docs.phax.run/schemas/${id}/0.17.0.json\``);
    }
    expect(result.files.get("docs/index.md")).not.toContain("schemas");
    const site = JSON.parse(result.files.get("site.json") ?? "{}") as SiteJson;
    expect(site.headingIds["/reference/formats"]).toEqual([
      "persisted-formats",
      "served-json-schemas",
    ]);
    expect(schemasLine(result.summary)).toBe(
      "site: schemas — 14 served (ledger: 1 × 14 formats), ledger agrees with package.json",
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
