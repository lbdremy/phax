// Every `$schema` literal the hello-world scripts print and the README shows
// names its format's current stamp, so gate-step and brief-provider authors
// copy a stamp phax reads. A format change must update them in the same
// commit; a release cut or an opening never does, since neither changes a
// stamp. JSON `"$schema": "…"` and JS `$schema: "…"` literals are in scope;
// URLs in prose are not.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { isFormatId, isRelease, schemaUrl } from "../../src/schemas/schemaUrl.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const FILES = ["examples/hello-world/audit.mjs", "examples/hello-world/brief.mjs", "README.md"];

const LITERAL =
  /"?\$schema"?\s*:\s*"https:\/\/docs\.phax\.run\/schemas\/([^/"\s]+)\/([^/"\s]+)\.json"/g;

/** Every `$schema` key/value literal in `text`, as its format and stamp. */
function stampLiterals(text: string): ReadonlyArray<{ format: string; stamp: string }> {
  return [...text.matchAll(LITERAL)].map(([, format = "", stamp = ""]) => ({ format, stamp }));
}

describe("example $schema literals", () => {
  it("reads both JSON and JS literals, and no prose URL", () => {
    expect(
      stampLiterals(
        [
          '{ "$schema": "https://docs.phax.run/schemas/brief-request/0.20.0.json" }',
          '  $schema: "https://docs.phax.run/schemas/gate-diagnostics/0.17.0.json",',
          "names its format, e.g. `https://docs.phax.run/schemas/run-status/0.17.0.json`.",
        ].join("\n"),
      ),
    ).toEqual([
      { format: "brief-request", stamp: "0.20.0" },
      { format: "gate-diagnostics", stamp: "0.17.0" },
    ]);
  });

  it.each(FILES)("%s names each format's current stamp", (file) => {
    const literals = stampLiterals(readFileSync(join(repoRoot, file), "utf8"));
    expect(literals.length, `${file} holds no $schema literal`).toBeGreaterThan(0);
    for (const { format, stamp } of literals) {
      expect(isFormatId(format), `${file}: ${format} is not a format id`).toBe(true);
      expect(isRelease(stamp), `${file}: ${format} stamp ${stamp} is not X.Y.Z`).toBe(true);
      if (!isFormatId(format)) continue;
      const current = CURRENT_STAMPS[format];
      expect(
        stamp,
        `${file}: ${format} is stamped ${stamp}, but its current stamp is ${current} ` +
          `(${schemaUrl(format, current)})`,
      ).toBe(current);
    }
  });
});
