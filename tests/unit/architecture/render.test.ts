import { describe, expect, it } from "vitest";
import { renderArchitectureReport } from "../../../src/domain/architecture/render.js";
import type { ArchitectureReport } from "../../../src/schemas/architecture.js";

const PARTS: ArchitectureReport["parts"] = [
  {
    id: "core-decide",
    name: "core · decide",
    description: "The pure decision logic.",
    globs: ["src/core/decide/**"],
  },
  {
    id: "http-requests",
    name: "http · requests",
    description: "Request handlers.",
    globs: ["src/http/**", "src/*/schemas/**"],
  },
  { id: "docs", name: "docs", description: "The docs.", globs: ["docs/**"] },
];

describe("renderArchitectureReport", () => {
  it("is exactly the body when there are no parts", () => {
    expect(renderArchitectureReport({ body: "# Architecture — acme-billing", parts: [] })).toBe(
      "# Architecture — acme-billing",
    );
  });

  it("renders the body, then each part in order", () => {
    expect(renderArchitectureReport({ body: "# Architecture — acme-billing", parts: PARTS })).toBe(
      [
        "# Architecture — acme-billing",
        "",
        "## Parts",
        "",
        "### core · decide (`core-decide`)",
        "The pure decision logic.",
        "- `src/core/decide/**`",
        "",
        "### http · requests (`http-requests`)",
        "Request handlers.",
        "- `src/http/**`",
        "- `src/*/schemas/**`",
        "",
        "### docs (`docs`)",
        "The docs.",
        "- `docs/**`",
      ].join("\n"),
    );
  });

  it("strips the body's trailing newlines", () => {
    expect(renderArchitectureReport({ body: "# A\n\n\n", parts: [] })).toBe("# A");
    expect(renderArchitectureReport({ body: "# A\n\n", parts: [PARTS[2]!] })).toBe(
      "# A\n\n## Parts\n\n### docs (`docs`)\nThe docs.\n- `docs/**`",
    );
  });

  it("folds a name or description onto one line", () => {
    const out = renderArchitectureReport({
      body: "# A",
      parts: [{ ...PARTS[2]!, name: "do\ncs", description: "The\n\n## Fake\ndocs." }],
    });
    expect(out).toBe("# A\n\n## Parts\n\n### do cs (`docs`)\nThe ## Fake docs.\n- `docs/**`");
  });
});
