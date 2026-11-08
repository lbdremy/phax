import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULE_OWNERS, SYMBOL_OWNERS } from "../../scripts/effect4-codemod/owners.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillPath = (name: string): string => join(root, ".claude", "skills", name, "SKILL.md");
const read = (name: string): string => readFileSync(skillPath(name), "utf8");
const TOPICS = ["effect4-services", "effect4-errors", "effect4-schema", "effect4-core"] as const;
const ALL = ["effect4-lookup", ...TOPICS] as const;

/** The body of a `## <title>` section, up to the next `## ` heading. */
function section(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

describe("effect4 skills", () => {
  for (const topic of TOPICS) {
    it(`${topic} names what it may change and which v3 symbols it owns`, () => {
      const text = read(topic);
      expect(section(text, "May change")).not.toBe("");
      expect(section(text, "v3 symbols")).not.toBe("");
      expect(text).toContain(`Follows skill: ${topic} (with effect4-lookup for every symbol)`);
    });
  }

  it("each topic skill lists the modules and symbols owners.ts routes to it", () => {
    for (const [module, owner] of MODULE_OWNERS) {
      expect(section(read(owner), "v3 symbols"), `${module} in ${owner}`).toContain(
        `\`${module}\``,
      );
    }
    for (const { pattern, owner } of SYMBOL_OWNERS) {
      expect(section(read(owner), "v3 symbols"), `${pattern} in ${owner}`).toContain(pattern);
    }
  });

  it("every owner owners.ts can return is an installed skill", () => {
    const owners = new Set<string>([
      ...MODULE_OWNERS.values(),
      ...SYMBOL_OWNERS.map(({ owner }) => owner),
      "effect4-core",
    ]);
    for (const owner of owners) expect(existsSync(skillPath(owner)), owner).toBe(true);
  });

  it("the lookup skill reads local files and uses no network or delegated agent", () => {
    const text = read("effect4-lookup");
    expect(text).toContain("docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md");
    expect(text).toContain("node_modules/effect");
    for (const word of ["git clone", "fetch", "curl", "npx", "sub-agent", "subagent"]) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });

  it("every vendored path the skills cite exists", () => {
    for (const name of ALL) {
      const cited = read(name).match(/docs\/vendor\/[\w@./-]+/g) ?? [];
      for (const raw of cited) {
        const path = raw.replace(/[.]+$/, "");
        expect(existsSync(join(root, path)), `${name}: ${path}`).toBe(true);
      }
    }
  });

  it("the reference's SOURCE names the tag the skills cite", () => {
    const source = readFileSync(
      join(root, "docs/vendor/effect-migration/effect@4.1.2/SOURCE"),
      "utf8",
    );
    expect(source).toMatch(/^tag:\s+effect@4\.1\.2$/m);
    expect(read("effect4-lookup")).toContain("effect@4.1.2");
  });
});
