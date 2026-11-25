// Runs the positioning checks against the repository's real files: every
// place that says what phax is, read the way the site build reads it. Each
// reader has its own list of places; a later phase adds a place by appending
// one entry to the list of its reader (or a new list run by the same checks).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LlmsTxtContext } from "@rspress/core";
import { describe, expect, it } from "vitest";
import pageMap from "../../../site/pages.js";
import { readmeDescription } from "../../../site/build/generate.js";
import { renderLlmsTxt } from "../../../site/build/llms.js";
import { OG_IMAGE_ALT, SITE_ORIGIN } from "../../../site/build/og.js";
import {
  AGENT_DETAIL,
  AGENT_PITCH,
  CLAIMS,
  PERSON_PITCH,
  builtRoutes,
  checkAgentDetail,
  checkClaims,
  checkName,
  checkPitches,
  checkRejectedNames,
  claimTexts,
  commandPaths,
  llmsIntroduction,
  packageDescription,
  paragraphStartingWith,
  readmeOpening,
  sectionOpening,
  skillDescription,
  usageAbout,
  type Place,
} from "../../../site/build/positioning.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";

const ROOT = resolve(import.meta.dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

const home = pageMap.readme.flatMap((entry) =>
  "route" in entry && entry.route === "/" && entry.home !== undefined ? [entry.home] : [],
)[0];

function pageDescription(route: string): string {
  const page = pageMap.files.find((entry) => "route" in entry && entry.route === route);
  return page !== undefined && "description" in page ? page.description : "";
}

/** The places that speak to a person: each carries the person pitch word for word. */
const PERSON_PLACES: ReadonlyArray<Place> = [
  { label: "README.md", reader: "person", text: readmeOpening(read("README.md")) },
  { label: "package.json", reader: "person", text: packageDescription(read("package.json")) },
  {
    label: "npm/package.json",
    reader: "person",
    text: packageDescription(read("npm/package.json")),
  },
  { label: "home tagline", reader: "person", text: home?.tagline ?? "" },
  { label: "site description", reader: "person", text: readmeDescription(read("README.md")) },
];

const ONE_LINE_DIFFERENCE = "The one-line difference";

/** The places that carry the name and no pitch: they name verified delegation. */
const NAME_PLACES: ReadonlyArray<Place> = [
  {
    label: "docs/comparisons/spec-kit-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/spec-kit-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/openspec-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/openspec-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/spec-kit-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/spec-kit-vs-phax.md"),
      "So Spec Kit is closer",
    ),
  },
  {
    label: "docs/comparisons/openspec-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/openspec-vs-phax.md"),
      "So OpenSpec is closer",
    ),
  },
  {
    label: "/compare/spec-kit-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/spec-kit-vs-phax"),
  },
  {
    label: "/compare/openspec-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/openspec-vs-phax"),
  },
  {
    label: "docs/comparisons/claude-code-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/claude-code-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/claude-code-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/claude-code-vs-phax.md"),
      "So Claude Code is closer",
    ),
  },
  {
    label: "/compare/claude-code-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/claude-code-vs-phax"),
  },
  {
    label: "docs/comparisons/codex-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/codex-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/codex-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/codex-vs-phax.md"), "So Codex is closer"),
  },
  {
    label: "/compare/codex-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/codex-vs-phax"),
  },
  {
    label: "docs/comparisons/kiro-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/kiro-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/kiro-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/kiro-vs-phax.md"), "So Kiro is closer"),
  },
  {
    label: "/compare/kiro-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/kiro-vs-phax"),
  },
  {
    label: "docs/comparisons/bmad-loop-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/bmad-loop-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/bmad-loop-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/bmad-loop-vs-phax.md"),
      "So BMad Loop is closer",
    ),
  },
  {
    label: "/compare/bmad-loop-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/bmad-loop-vs-phax"),
  },
  {
    label: "docs/comparisons/archon-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/archon-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/archon-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/archon-vs-phax.md"), "So Archon is closer"),
  },
  {
    label: "/compare/archon-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/archon-vs-phax"),
  },
  {
    label: "docs/comparisons/zeroshot-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/zeroshot-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/zeroshot-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/zeroshot-vs-phax.md"),
      "So zeroshot is closer",
    ),
  },
  {
    label: "/compare/zeroshot-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/zeroshot-vs-phax"),
  },
  {
    label: "docs/comparisons/fabro-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/fabro-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/fabro-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/fabro-vs-phax.md"), "So Fabro is closer"),
  },
  {
    label: "/compare/fabro-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/fabro-vs-phax"),
  },
  {
    label: "docs/comparisons/bernstein-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/bernstein-vs-phax.md"), ONE_LINE_DIFFERENCE)
      .paragraph,
  },
  {
    label: "docs/comparisons/bernstein-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/bernstein-vs-phax.md"),
      "So Bernstein is closer",
    ),
  },
  {
    label: "/compare/bernstein-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/bernstein-vs-phax"),
  },
  {
    label: "docs/comparisons/goose-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/goose-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/goose-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/goose-vs-phax.md"), "So Goose is closer"),
  },
  {
    label: "/compare/goose-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/goose-vs-phax"),
  },
  {
    label: "docs/comparisons/entire-vs-phax.md",
    reader: "name",
    text: sectionOpening(read("docs/comparisons/entire-vs-phax.md"), ONE_LINE_DIFFERENCE).paragraph,
  },
  {
    label: "docs/comparisons/entire-vs-phax.md key distinction",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/entire-vs-phax.md"), "So Entire is closer"),
  },
  {
    label: "/compare/entire-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/entire-vs-phax"),
  },
];

/**
 * Sentences that say what phax is without naming it, so they carry no name:
 * only the rejected-names check reads them.
 */
const UNNAMED_SENTENCES: ReadonlyArray<Place> = [
  {
    label: "docs/comparisons/spec-kit-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/spec-kit-vs-phax.md"),
      "They are composable",
    ),
  },
  {
    label: "docs/comparisons/openspec-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/openspec-vs-phax.md"),
      "They are composable",
    ),
  },
  {
    label: "docs/comparisons/kiro-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/kiro-vs-phax.md"), "They are composable"),
  },
  {
    label: "docs/comparisons/bmad-loop-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/bmad-loop-vs-phax.md"),
      "They are composable",
    ),
  },
  {
    label: "docs/comparisons/archon-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/archon-vs-phax.md"), "They are composable"),
  },
  {
    label: "docs/comparisons/zeroshot-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(
      read("docs/comparisons/zeroshot-vs-phax.md"),
      "They are composable",
    ),
  },
  {
    label: "docs/comparisons/goose-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/goose-vs-phax.md"), "They are composable"),
  },
  {
    label: "docs/comparisons/entire-vs-phax.md composability note",
    reader: "name",
    text: paragraphStartingWith(read("docs/comparisons/entire-vs-phax.md"), "They are composable"),
  },
];

const SKILL_PATH = ".claude/skills/phax-cli/SKILL.md";
const HELP_FIXTURE_PATH = "tests/fixtures/help/phax-root-help.txt";

const skillOpening = sectionOpening(read(SKILL_PATH), "What phax is");

const AGENT_PAGE_PATH = "docs/delegating.md";
const AGENT_PAGE_ROUTE = "/guide/delegating";
const agentPage = read(AGENT_PAGE_PATH);
const agentPageOpening = sectionOpening(agentPage, "Delegating from an agent");

/** An llms.txt context as Rspress hands it to the renderer: one section, one page per route. */
function llmsContext(routes: ReadonlyArray<string>): LlmsTxtContext {
  return {
    title: "phax",
    description: PERSON_PITCH,
    lang: "",
    version: "",
    base: "/",
    siteOrigin: SITE_ORIGIN,
    sections: [
      {
        title: "Docs",
        pages: routes.map((route) => ({
          routePath: route,
          link: `${SITE_ORIGIN}${route}.md`,
          title: route,
          frontmatter: {},
          lang: "",
          version: "",
        })),
      },
    ],
  };
}

const llmsTxt = await renderLlmsTxt(llmsContext([AGENT_PAGE_ROUTE]));

/** The places that speak to an agent: each carries the agent pitch word for word. */
const AGENT_PLACES: ReadonlyArray<Place> = [
  { label: "llms.txt", reader: "agent", text: llmsIntroduction(llmsTxt) },
  { label: AGENT_PAGE_PATH, reader: "agent", text: agentPageOpening.paragraph },
  { label: "phax --help", reader: "agent", text: phaxProgram.summary ?? "" },
  { label: "context7.json", reader: "agent", text: packageDescription(read("context7.json")) },
  {
    label: "phax.usage.kdl",
    reader: "agent",
    text: usageAbout(read("phax.usage.kdl")),
  },
  {
    label: "phax-cli skill",
    reader: "agent",
    text: skillOpening.paragraph,
  },
];

const PLACES: ReadonlyArray<Place> = [...PERSON_PLACES, ...NAME_PLACES, ...AGENT_PLACES];

describe("the person places", () => {
  it("carry the person pitch word for word", () => {
    expect(checkPitches(PERSON_PLACES)).toEqual([]);
  });
});

describe("the agent places", () => {
  it("carry the agent pitch word for word", () => {
    expect(checkPitches(AGENT_PLACES)).toEqual([]);
  });

  it("show the agent detail right after the pitch in the skill", () => {
    expect(checkAgentDetail("phax-cli skill", skillOpening.list)).toEqual([]);
  });

  it("carry none of the agent detail in phax --help", () => {
    for (const item of AGENT_DETAIL) {
      expect(phaxProgram.summary ?? "").not.toContain(item);
    }
  });

  it("the skill description names verified delegation and keeps its Use when sentence", () => {
    const description = skillDescription(read(SKILL_PATH));
    expect(description).toMatch(/\bverified delegation\b/i);
    expect(description).toMatch(/\bUse when\b/);
    expect(
      checkRejectedNames([
        { label: "phax-cli skill description", reader: "name", text: description },
      ]),
    ).toEqual([]);
  });

  it("the fixture's paragraph under Usage:, its lines wrapped at 80 columns and joined, is only the pitch", () => {
    const fixture = read(HELP_FIXTURE_PATH);
    const lines = fixture.split("\n");
    expect(lines[0]).toBe("Usage: phax [options] [command]");
    expect(lines[1]).toBe("");
    const blankAfter = lines.findIndex((line, index) => index >= 2 && line === "");
    const paragraph = lines.slice(2, blankAfter);
    for (const line of paragraph) expect(line.length).toBeLessThanOrEqual(80);
    expect(paragraph.join(" ")).toBe(AGENT_PITCH);
  });

  it("the agent-detail claims name a shipped route or command", () => {
    const shipped = { routes: builtRoutes(pageMap), commands: commandPaths(phaxProgram) };
    const claims = CLAIMS.filter((claim) => claim.of === "agent detail");
    expect(claims.length).toBe(AGENT_DETAIL.length);
    expect(checkClaims(claims, shipped, claimTexts(home?.features))).toEqual([]);
  });
});

describe("the agent page and llms.txt", () => {
  it("open with the agent pitch, while the site's description keeps the person pitch", () => {
    expect(llmsIntroduction(llmsTxt)).toBe(AGENT_PITCH);
    expect(agentPageOpening.paragraph).toBe(AGENT_PITCH);
    expect(readmeDescription(read("README.md"))).toBe(PERSON_PITCH);
  });

  it("show the agent detail right after the pitch on the agent page", () => {
    expect(checkAgentDetail(AGENT_PAGE_PATH, agentPageOpening.list)).toEqual([]);
  });

  it("carry none of the agent detail in llms.txt", () => {
    for (const item of AGENT_DETAIL) expect(llmsTxt).not.toContain(item);
  });

  it("the page map renders the agent page from docs/delegating.md on every build", () => {
    const entry = pageMap.files.find(
      (candidate) => "route" in candidate && candidate.route === AGENT_PAGE_ROUTE,
    );
    expect(entry !== undefined && "source" in entry ? entry.source : undefined).toBe(
      AGENT_PAGE_PATH,
    );
    expect(builtRoutes(pageMap).has(AGENT_PAGE_ROUTE)).toBe(true);
  });

  it("the agent page shows --json, --json-schema, phax --usage and links the exit codes", () => {
    expect(agentPage).toContain("--json");
    expect(agentPage).toContain("--json-schema");
    expect(agentPage).toContain("phax --usage");
    expect(agentPage).toContain("](../README.md#exit-codes)");
  });

  it("the llms.txt renderer links every route it is given, the agent page's included", async () => {
    const text = await renderLlmsTxt(llmsContext([...builtRoutes(pageMap)]));
    expect(text).toContain(`](${SITE_ORIGIN}${AGENT_PAGE_ROUTE}.md)`);
  });
});

/** Each command path of the usage spec, `phax <word> …`, with the long flags it declares, globals included. */
function usageFlags(kdl: string): ReadonlyMap<string, ReadonlySet<string>> {
  const flags = new Map<string, Set<string>>();
  const stack: Array<string> = [];
  const globals = new Set<string>();
  for (const line of kdl.split("\n")) {
    const depth = (/^ */.exec(line)?.[0].length ?? 0) / 4;
    const command = /^\s*cmd\s+"?([a-z][a-z0-9-]*)"?/.exec(line);
    if (command !== null) {
      stack.length = depth;
      stack.push(command[1] ?? "");
      flags.set(["phax", ...stack].join(" "), new Set());
      continue;
    }
    const flag = /^\s*flag\s+"?([^"\s]+(?:\s[^"\s]+)*)"?/.exec(line);
    if (flag === null) continue;
    const longs = (flag[1] ?? "").match(/--[a-z][a-z0-9-]*/g) ?? [];
    const owner = depth === 0 ? globals : flags.get(["phax", ...stack.slice(0, depth)].join(" "));
    for (const long of longs) owner?.add(long);
  }
  for (const set of flags.values()) for (const long of globals) set.add(long);
  return flags;
}

/** The `phax …` lines of a Markdown document's `sh` blocks, in order, as words. */
function shCommands(markdown: string): ReadonlyArray<ReadonlyArray<string>> {
  const blocks = [...markdown.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
  return blocks
    .flatMap((block) => block.split("\n"))
    .filter((line) => line.startsWith("phax "))
    .map((line) => line.split(/\s+/));
}

describe("the agent page's delegation sequence", () => {
  const usage = usageFlags(read("phax.usage.kdl"));
  const commands = shCommands(agentPage);
  const pathOf = (words: ReadonlyArray<string>): string => {
    let path = "";
    for (let end = words.length; end > 0 && path === ""; end -= 1) {
      const candidate = words.slice(0, end).join(" ");
      if (usage.has(candidate)) path = candidate;
    }
    return path;
  };

  it("names only commands phax has, each with flags it declares", () => {
    expect(commands.length).toBeGreaterThan(0);
    for (const words of commands) {
      const path = pathOf(words);
      expect(path, words.join(" ")).not.toBe("");
      for (const word of words.filter((candidate) => candidate.startsWith("--"))) {
        expect(usage.get(path)?.has(word), `${words.join(" ")}: ${word}`).toBe(true);
      }
    }
  });

  it("runs without a terminal: every approve and decide names its arbiter", () => {
    for (const words of commands) {
      const path = pathOf(words);
      if (path === "phax artifact approve") expect(words, words.join(" ")).toContain("--by");
      if (path === "phax artifact decide") {
        expect(words.slice(words.indexOf("--by"), words.indexOf("--by") + 2)).toEqual([
          "--by",
          "operator",
        ]);
      }
    }
  });

  it("approves the spec before the plan, and the plan before the run", () => {
    const at = (path: string, argument: string): number =>
      commands.findIndex((words) => pathOf(words) === path && words.includes(argument));
    const spec = at("phax artifact approve", "<spec>");
    const plan = at("phax artifact approve", "<plan>");
    expect(spec).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(spec);
    expect(at("phax run", "<plan>")).toBeGreaterThan(plan);
  });
});

describe("every place", () => {
  it("reads something from each source", () => {
    for (const place of [...PLACES, ...UNNAMED_SENTENCES]) {
      expect(place.text, place.label).not.toBe("");
    }
  });

  it("names verified delegation", () => {
    expect(checkName(PLACES)).toEqual([]);
  });

  it("gives phax no rejected name", () => {
    expect(checkRejectedNames([...PLACES, ...UNNAMED_SENTENCES])).toEqual([]);
  });
});

describe("the home page", () => {
  it("keeps its text and the open-graph alt text", () => {
    expect(home?.text).toBe("The golden path, just facts.");
    expect(OG_IMAGE_ALT).toBe("phax — the golden path, just facts");
  });

  it("shows the four moments, each linking to its guide", () => {
    expect(home?.features.map((feature) => feature.key)).toEqual([
      "author",
      "run",
      "review",
      "keep",
    ]);
    expect(home?.features.map((feature) => feature.link)).toEqual([
      "/guide/specs-and-plans",
      "/guide/run",
      "/guide/review-and-land",
      "/guide/records",
    ]);
  });
});

describe("the claims", () => {
  const shipped = { routes: builtRoutes(pageMap), commands: commandPaths(phaxProgram) };

  it("each name a shipped route or command and are said by the text they back", () => {
    expect(CLAIMS.length).toBeGreaterThan(0);
    expect(checkClaims(CLAIMS, shipped, claimTexts(home?.features))).toEqual([]);
  });
});

describe("every check over every place and claim", () => {
  it("finds nothing", () => {
    const shipped = { routes: builtRoutes(pageMap), commands: commandPaths(phaxProgram) };
    expect([
      ...checkPitches(PLACES),
      ...checkName(PLACES),
      ...checkRejectedNames([...PLACES, ...UNNAMED_SENTENCES]),
      ...checkAgentDetail("phax-cli skill", skillOpening.list),
      ...checkAgentDetail(AGENT_PAGE_PATH, agentPageOpening.list),
      ...checkClaims(CLAIMS, shipped, claimTexts(home?.features)),
    ]).toEqual([]);
  });
});
