import { describe, expect, it } from "vitest";
import {
  groupAgents,
  locateAtHead,
  permalink,
  renderPrFooter,
  type PrFooterInput,
} from "../../../src/domain/publish/prFooter.js";

const WEB = "https://github.com/example/repo";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PLAN = "docs/plans/archive/2610101200-greet-cli-plan.md";
const SPEC = "docs/specs/archive/2610091100-greet-cli.md";

const full: PrFooterInput = {
  version: "9.8.7",
  plan: { kind: "permalink", path: PLAN, url: `${WEB}/blob/${SHA}/${PLAN}` },
  spec: { kind: "permalink", path: SPEC, url: `${WEB}/blob/${SHA}/${SPEC}` },
  agents: [
    { provider: "claude", model: "claude-made-up-1", effort: "medium", phases: 2 },
    { provider: "codex", model: "gpt-made-up", effort: "high", phases: 1 },
  ],
  qualifiedName: "acme.greet-cli",
};

describe("renderPrFooter", () => {
  it("renders every fact of a full input, one per line", () => {
    expect(renderPrFooter(full)).toBe(
      [
        "---",
        "",
        "🛤️ Generated with [phax](https://docs.phax.run) 9.8.7 — the golden path, just facts\\",
        `**Plan** [\`${PLAN}\`](${WEB}/blob/${SHA}/${PLAN}) · **Spec** [\`${SPEC}\`](${WEB}/blob/${SHA}/${SPEC})\\`,
        "**Agents** claude `claude-made-up-1` at medium: 2 phases; codex `gpt-made-up` at high: 1 phase\\",
        "**Run** `acme.greet-cli`",
      ].join("\n"),
    );
  });

  it("leaves the Spec part out when there is none", () => {
    const footer = renderPrFooter({ ...full, spec: { kind: "none" } });
    expect(footer).toContain(`**Plan** [\`${PLAN}\`](${WEB}/blob/${SHA}/${PLAN})\\\n`);
    expect(footer).not.toContain("**Spec**");
  });

  it("writes a plain path as a code span, with no link", () => {
    const footer = renderPrFooter({
      ...full,
      plan: { kind: "path", path: PLAN },
      spec: { kind: "path", path: SPEC },
    });
    expect(footer).toContain(`**Plan** \`${PLAN}\` · **Spec** \`${SPEC}\`\\\n`);
    expect(footer).not.toContain("/blob/");
  });

  it("writes an unrecorded plan as loose plan", () => {
    const footer = renderPrFooter({
      ...full,
      plan: { kind: "unrecorded" },
      spec: { kind: "none" },
    });
    expect(footer).toContain("\n**Plan** loose plan\\\n");
  });

  it("leaves the Agents line out when no phase has a binding", () => {
    const footer = renderPrFooter({ ...full, agents: [] });
    expect(footer).not.toContain("**Agents**");
    expect(footer.endsWith("\\\n**Run** `acme.greet-cli`")).toBe(true);
  });
});

describe("groupAgents", () => {
  it("groups in order of first appearance and counts each assignment", () => {
    expect(
      groupAgents([
        { provider: "codex", model: "gpt-made-up", effort: "high" },
        { provider: "claude", model: "claude-made-up-1", effort: "medium" },
        { provider: "codex", model: "gpt-made-up", effort: "high" },
        { provider: "codex", model: "gpt-made-up", effort: "low" },
      ]),
    ).toEqual([
      { provider: "codex", model: "gpt-made-up", effort: "high", phases: 2 },
      { provider: "claude", model: "claude-made-up-1", effort: "medium", phases: 1 },
      { provider: "codex", model: "gpt-made-up", effort: "low", phases: 1 },
    ]);
  });

  it("returns no group for no phase", () => {
    expect(groupAgents([])).toEqual([]);
  });
});

describe("permalink", () => {
  it("joins the web URL, /blob/, the sha and the path", () => {
    expect(permalink(`${WEB}/`, SHA, PLAN)).toBe(`${WEB}/blob/${SHA}/${PLAN}`);
  });

  it("URI-encodes each path segment and keeps the slashes", () => {
    expect(permalink(WEB, SHA, "docs/my plans/a#b.md")).toBe(
      `${WEB}/blob/${SHA}/docs/my%20plans/a%23b.md`,
    );
  });
});

describe("locateAtHead", () => {
  const live = "docs/plans/2610101200-greet-cli-plan.md";
  const archived = "docs/plans/archive/2610101200-greet-cli-plan.md";
  it.each([
    ["the recorded path when the tree holds it", live, [live, archived], live],
    ["its archive counterpart when only that is held", live, [archived], archived],
    ["null when the tree holds neither", live, ["README.md"], null],
    ["an archived recorded path as it is", archived, [archived], archived],
    ["null for a loose path, never an archive", "notes/plan.md", ["notes/archive/plan.md"], null],
    ["a loose path the tree holds", "notes/plan.md", ["notes/plan.md"], "notes/plan.md"],
  ])("returns %s", (_label, recorded, paths, expected) => {
    expect(locateAtHead(recorded, new Set(paths))).toBe(expected);
  });
});
