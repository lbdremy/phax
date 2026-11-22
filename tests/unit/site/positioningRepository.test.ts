// Runs the positioning checks against the repository's real files: every
// place that says what phax is, read the way the site build reads it. Each
// reader has its own list of places; a later phase adds a place by appending
// one entry to the list of its reader (or a new list run by the same checks).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pageMap from "../../../site/pages.js";
import { readmeDescription } from "../../../site/build/generate.js";
import { OG_IMAGE_ALT } from "../../../site/build/og.js";
import {
  AGENT_DETAIL,
  AGENT_PITCH,
  CLAIMS,
  builtRoutes,
  checkAgentDetail,
  checkClaims,
  checkName,
  checkPitches,
  checkRejectedNames,
  claimTexts,
  commandPaths,
  packageDescription,
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
    label: "/compare/spec-kit-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/spec-kit-vs-phax"),
  },
  {
    label: "/compare/openspec-vs-phax description",
    reader: "name",
    text: pageDescription("/compare/openspec-vs-phax"),
  },
];

const SKILL_PATH = ".claude/skills/phax-cli/SKILL.md";
const HELP_FIXTURE_PATH = "tests/fixtures/help/phax-root-help.txt";

const skillOpening = sectionOpening(read(SKILL_PATH), "What phax is");

/** The places that speak to an agent: each carries the agent pitch word for word. */
const AGENT_PLACES: ReadonlyArray<Place> = [
  { label: "phax --help", reader: "agent", text: phaxProgram.summary ?? "" },
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

  it("the fixture's paragraph under Usage: is only the pitch, wrapped by the command library at 80 columns", () => {
    const fixture = read(HELP_FIXTURE_PATH);
    const lines = fixture.split("\n");
    expect(lines[0]).toBe("Usage: phax [options] [command]");
    expect(lines[1]).toBe("");
    const blankAfter = lines.findIndex((line, index) => index >= 2 && line === "");
    expect(lines.slice(2, blankAfter).join(" ")).toBe(AGENT_PITCH);
  });

  it("the agent-detail claims name a shipped route or command", () => {
    const shipped = { routes: builtRoutes(pageMap), commands: commandPaths(phaxProgram) };
    const claims = CLAIMS.filter((claim) => claim.of === "agent detail");
    expect(claims.length).toBe(AGENT_DETAIL.length);
    expect(checkClaims(claims, shipped, claimTexts(home?.features))).toEqual([]);
  });
});

describe("every place", () => {
  it("reads something from each source", () => {
    for (const place of PLACES) expect(place.text, place.label).not.toBe("");
  });

  it("names verified delegation", () => {
    expect(checkName(PLACES)).toEqual([]);
  });

  it("gives phax no rejected name", () => {
    expect(checkRejectedNames(PLACES)).toEqual([]);
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

  it("of the person pitch and the home features name a shipped route or command", () => {
    const claims = CLAIMS.filter(
      (claim) => claim.of === "person pitch" || claim.of.startsWith("home feature "),
    );
    expect(claims.length).toBeGreaterThan(0);
    expect(checkClaims(claims, shipped, claimTexts(home?.features))).toEqual([]);
  });
});
