import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  BEGIN_POLICY_MARKER,
  END_MARKER,
  END_POLICY_MARKER,
  POLICY_MARKERS,
  applyToContent,
  hasStaleRegion,
  renderCatalogTable,
  renderPhaseModelPolicy,
  rewriteMarkerRegion,
} from "../../scripts/generate-model-catalog.js";
import { PHASE_MODEL_POLICY } from "../../src/domain/routing/phaseModelPolicy.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";

const smallCatalog: ProviderConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      executable: "claude",
      families: {
        "claude-sonnet": {
          models: [
            {
              id: "claude-sonnet-4-6",
              efforts: ["low", "medium", "high", "max"],
              status: "active",
            },
          ],
        },
        "claude-opus": {
          models: [
            {
              id: "claude-opus-4-8",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
            {
              id: "claude-opus-old",
              efforts: ["low", "medium"],
              status: "deprecated",
            },
          ],
        },
      },
    },
    "codex-cli": {
      enabled: false,
      executable: "codex",
      families: {
        "openai-gpt": {
          models: [
            {
              id: "gpt-5.5",
              efforts: ["low", "medium", "high", "xhigh"],
              status: "active",
            },
          ],
        },
      },
    },
  },
};

describe("renderCatalogTable", () => {
  it("produces a header row and separator", () => {
    const table = renderCatalogTable(smallCatalog);
    expect(table).toContain("| ID | Family | Status | Efforts |");
    expect(table).toContain("| --- | --- | --- | --- |");
  });

  it("emits one row per catalog entry", () => {
    const table = renderCatalogTable(smallCatalog);
    const rows = table.split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
    // 1 header row + 4 model entries
    expect(rows).toHaveLength(5);
  });

  it("formats efforts joined with escaped pipes", () => {
    const table = renderCatalogTable(smallCatalog);
    expect(table).toContain("`low` \\| `medium` \\| `high` \\| `max`");
  });

  it("includes the deprecated status for deprecated entries", () => {
    const table = renderCatalogTable(smallCatalog);
    expect(table).toContain("| `claude-opus-old` | `claude-opus` | deprecated |");
  });

  it("renders a provider with no families without crashing", () => {
    const cfg: ProviderConfig = {
      providers: {
        bare: { enabled: true, executable: "bare" },
      },
    };
    const table = renderCatalogTable(cfg);
    // Only header + separator, no data rows
    const lines = table.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("matches snapshot for the small catalog", () => {
    expect(renderCatalogTable(smallCatalog)).toMatchInlineSnapshot(`
      "| ID | Family | Status | Efforts |
      | --- | --- | --- | --- |
      | \`claude-sonnet-4-6\` | \`claude-sonnet\` | active | \`low\` \\| \`medium\` \\| \`high\` \\| \`max\` |
      | \`claude-opus-4-8\` | \`claude-opus\` | active | \`low\` \\| \`medium\` \\| \`high\` \\| \`xhigh\` \\| \`max\` \\| \`ultracode\` |
      | \`claude-opus-old\` | \`claude-opus\` | deprecated | \`low\` \\| \`medium\` |
      | \`gpt-5.5\` | \`openai-gpt\` | active | \`low\` \\| \`medium\` \\| \`high\` \\| \`xhigh\` |"
    `);
  });
});

describe("rewriteMarkerRegion", () => {
  const skeleton = `# Skill\n\n${BEGIN_MARKER}\n${END_MARKER}\n\n## Next section`;

  it("replaces the region between markers", () => {
    const result = rewriteMarkerRegion(skeleton, "new content");
    expect(result).toBe(
      `# Skill\n\n${BEGIN_MARKER}\nnew content\n${END_MARKER}\n\n## Next section`,
    );
  });

  it("is idempotent when content already matches", () => {
    const withContent = `# Skill\n\n${BEGIN_MARKER}\nold content\n${END_MARKER}\n\n## Next`;
    const result = rewriteMarkerRegion(withContent, "old content");
    expect(result).toBe(`# Skill\n\n${BEGIN_MARKER}\nold content\n${END_MARKER}\n\n## Next`);
  });

  it("throws when BEGIN_MARKER is absent", () => {
    expect(() => rewriteMarkerRegion("no markers here", "x")).toThrow(
      "Model catalog markers not found",
    );
  });

  it("throws when END_MARKER is absent", () => {
    expect(() => rewriteMarkerRegion(`${BEGIN_MARKER}`, "x")).toThrow(
      "Model catalog markers not found",
    );
  });
});

describe("applyToContent", () => {
  const LEGACY = `# Skill\n\n## Model IDs\n\nold content\n\n## Required commands declaration\n`;
  const WITH_MARKERS = `# Skill\n\n${BEGIN_MARKER}\nold table\n${END_MARKER}\n\n## Next\n`;

  it("rewrites existing markers when present", () => {
    const result = applyToContent(WITH_MARKERS, "new table");
    expect(result).toContain("new table");
    expect(result).not.toContain("old table");
  });

  it("replaces the legacy sections when markers are absent", () => {
    const result = applyToContent(LEGACY, "generated table");
    expect(result).toContain(BEGIN_MARKER);
    expect(result).toContain(END_MARKER);
    expect(result).toContain("generated table");
    expect(result).toContain("## Model catalog");
    expect(result).not.toContain("## Model IDs");
  });

  it("throws when neither markers nor legacy anchor are found", () => {
    expect(() => applyToContent("no known structure", "t")).toThrow(
      "Cannot locate model catalog section",
    );
  });
});

function makeContent(inner: string): string {
  return `# Skill\n\n${BEGIN_MARKER}\n${inner}\n${END_MARKER}\n`;
}

describe("hasStaleRegion", () => {
  it("returns false when the region matches", () => {
    expect(hasStaleRegion(makeContent("my table"), "my table")).toBe(false);
  });

  it("returns true when the region differs", () => {
    expect(hasStaleRegion(makeContent("old table"), "new table")).toBe(true);
  });

  it("returns true when BEGIN_MARKER is absent", () => {
    expect(hasStaleRegion("no markers", "anything")).toBe(true);
  });

  it("returns true when END_MARKER is absent", () => {
    expect(hasStaleRegion(`${BEGIN_MARKER}\nsome content`, "some content")).toBe(true);
  });
});

describe("renderPhaseModelPolicy", () => {
  it("renders the three policy bullets from the shipped policy", () => {
    expect(renderPhaseModelPolicy(PHASE_MODEL_POLICY)).toMatchInlineSnapshot(`
      "- Default: \`claude-sonnet-5-5\` at \`medium\`.
      - Stronger (a higher effort, or \`claude-opus-5-5\`): the phase must design something no code in the repository shows yet — a new state machine, an adapter to a system the code does not reach yet, a choice that crosses several parts of the architecture.
      - Lighter (\`claude-haiku-5-5\`): the phase reproduces a pattern the code already holds, and a configured gate checks it."
    `);
  });
});

describe("phase model policy region", () => {
  const policy = renderPhaseModelPolicy(PHASE_MODEL_POLICY);
  const skill =
    `# Skill\n\n${BEGIN_POLICY_MARKER}\n${policy}\n${END_POLICY_MARKER}\n\n` +
    `${BEGIN_MARKER}\ncatalog table\n${END_MARKER}\n`;

  it("is fresh when the region matches the rendered policy", () => {
    expect(hasStaleRegion(skill, policy, POLICY_MARKERS)).toBe(false);
  });

  it("is stale when the block is hand-edited to another default", () => {
    const edited = skill.replace("`claude-sonnet-5-5`", "`claude-sonnet-5`");
    expect(edited).not.toBe(skill);
    expect(hasStaleRegion(edited, policy, POLICY_MARKERS)).toBe(true);
  });

  it("is stale when the policy markers are missing", () => {
    const catalogOnly = `${BEGIN_MARKER}\nx\n${END_MARKER}\n`;
    expect(hasStaleRegion(catalogOnly, policy, POLICY_MARKERS)).toBe(true);
  });

  it("rewrites idempotently and leaves the catalog region alone", () => {
    const stale = skill.replace(policy, "old bullets");
    const once = rewriteMarkerRegion(stale, policy, POLICY_MARKERS);
    expect(once).toBe(skill);
    expect(rewriteMarkerRegion(once, policy, POLICY_MARKERS)).toBe(once);
    expect(hasStaleRegion(once, "catalog table")).toBe(false);
  });

  it("names the phase model policy when its markers are absent", () => {
    expect(() => rewriteMarkerRegion("no markers", policy, POLICY_MARKERS)).toThrow(
      "Phase model policy markers not found",
    );
  });
});
