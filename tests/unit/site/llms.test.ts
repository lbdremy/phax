import type { LlmsTxtContext, LlmsTxtPage } from "@rspress/core";
import { describe, expect, it } from "vitest";
import { renderLlmsTxt } from "../../../site/build/llms.js";
import { AGENT_PITCH, PERSON_PITCH } from "../../../site/build/positioning.js";

const ORIGIN = "https://docs.example.dev";

function page(routePath: string, title: string, description?: string): LlmsTxtPage {
  return {
    routePath,
    link: `${ORIGIN}${routePath}.md`,
    title,
    ...(description === undefined ? {} : { description }),
    frontmatter: {},
    lang: "",
    version: "",
  };
}

function context(overrides: Partial<LlmsTxtContext> = {}): LlmsTxtContext {
  return {
    title: "phax",
    description: PERSON_PITCH,
    lang: "",
    version: "",
    base: "/",
    siteOrigin: ORIGIN,
    sections: [
      {
        title: "Guide",
        pages: [
          page("/guide/delegating", "Delegating from an agent", "Delegate a change."),
          page("/guide/run", "Running a plan"),
        ],
      },
      {
        title: "Reference",
        pages: [page("/reference/cli", "CLI reference", "Every phax command.")],
      },
    ],
    ...overrides,
  };
}

describe("renderLlmsTxt", () => {
  it("renders Rspress's default layout with the agent pitch as the introduction", async () => {
    expect(await renderLlmsTxt(context())).toBe(
      [
        "# phax",
        "",
        `> ${AGENT_PITCH}`,
        "",
        "## Guide",
        "",
        `- [Delegating from an agent](${ORIGIN}/guide/delegating.md): Delegate a change.`,
        `- [Running a plan](${ORIGIN}/guide/run.md)`,
        "",
        "## Reference",
        "",
        `- [CLI reference](${ORIGIN}/reference/cli.md): Every phax command.`,
      ].join("\n"),
    );
  });

  it("keeps the introduction the agent pitch whatever the site's description", async () => {
    const text = await renderLlmsTxt(context({ description: undefined }));
    expect(text.split("\n")[2]).toBe(`> ${AGENT_PITCH}`);
    expect(text).not.toContain(PERSON_PITCH);
  });

  it("renders the title and introduction alone when no section has a page", async () => {
    expect(await renderLlmsTxt(context({ sections: [] }))).toBe(`# phax\n\n> ${AGENT_PITCH}`);
  });
});
