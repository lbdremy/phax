import { describe, expect, it } from "vitest";
import { definePageMap, INTRO } from "../../../site/build/pageMap.js";
import {
  AGENT_DETAIL,
  AGENT_PITCH,
  builtRoutes,
  checkAgentDetail,
  checkClaims,
  checkName,
  checkPitches,
  checkRejectedNames,
  CLAIMS,
  claimTexts,
  commandPaths,
  HOME_FEATURES,
  llmsIntroduction,
  packageDescription,
  PERSON_PITCH,
  readmeOpening,
  REJECTED_NAMES,
  sectionOpening,
  skillDescription,
  usageAbout,
  type Claim,
  type Place,
  type Shipped,
} from "../../../site/build/positioning.js";

/** Every route and command the store's claims name, so the fixtures ship them all. */
function shippedByStore(): Shipped {
  return {
    routes: new Set(
      CLAIMS.flatMap((claim) => (claim.proof.kind === "route" ? [claim.proof.route] : [])),
    ),
    commands: new Set(
      CLAIMS.flatMap((claim) => (claim.proof.kind === "command" ? [claim.proof.command] : [])),
    ),
  };
}

describe("checkPitches", () => {
  it("reports a person place edited away from the person pitch, naming README.md", () => {
    const places: ReadonlyArray<Place> = [
      { label: "README.md", reader: "person", text: PERSON_PITCH.replace("facts", "results") },
      { label: "package.json", reader: "person", text: PERSON_PITCH },
    ];
    expect(checkPitches(places)).toEqual([
      "✗ README.md: does not carry the person pitch word for word",
    ]);
  });

  it("reports an agent place that does not carry the agent pitch, and ignores name places", () => {
    const places: ReadonlyArray<Place> = [
      { label: "phax --help", reader: "agent", text: PERSON_PITCH },
      { label: "llms.txt", reader: "agent", text: AGENT_PITCH },
      { label: "docs/comparisons/spec-kit-vs-phax.md", reader: "name", text: "anything" },
    ];
    expect(checkPitches(places)).toEqual([
      "✗ phax --help: does not carry the agent pitch word for word",
    ]);
  });
});

describe("checkName", () => {
  it("reports a place without the words verified delegation", () => {
    expect(
      checkName([{ label: "/compare/x description", reader: "name", text: "phax runs plans." }]),
    ).toEqual(["✗ /compare/x description: does not name verified delegation"]);
  });

  it("accepts a place with the words verified delegation", () => {
    expect(
      checkName([
        { label: "docs/comparisons/x.md", reader: "name", text: "phax is verified delegation." },
      ]),
    ).toEqual([]);
  });
});

describe("checkRejectedNames", () => {
  const casings = (word: string): ReadonlyArray<string> => [
    word,
    word.toUpperCase(),
    word.replace(/\b\w/g, (letter) => letter.toUpperCase()),
  ];

  it.each(REJECTED_NAMES.flatMap((name) => casings(name).map((written) => [name, written])))(
    "reports %s written as %s, naming the place and the word",
    (_name, written) => {
      const place: Place = {
        label: "README.md",
        reader: "person",
        text: `phax is a ${written} for agents.`,
      };
      expect(checkRejectedNames([place])).toEqual([`✗ README.md: names phax "${written}"`]);
    },
  );

  it("matches orchestrators, the plural, and only whole words", () => {
    expect(
      checkRejectedNames([
        { label: "llms.txt", reader: "agent", text: "Unlike orchestrators, phax unharnessed." },
      ]),
    ).toEqual(['✗ llms.txt: names phax "orchestrators"']);
  });

  it("reports every rejected name a place uses", () => {
    expect(
      checkRejectedNames([
        {
          label: "phax --help",
          reader: "agent",
          text: "An orchestration engine and a harness.",
        },
      ]),
    ).toEqual([
      '✗ phax --help: names phax "orchestration engine"',
      '✗ phax --help: names phax "harness"',
    ]);
  });

  it("finds none in the pitches", () => {
    expect(
      checkRejectedNames([
        { label: "person", reader: "person", text: PERSON_PITCH },
        { label: "agent", reader: "agent", text: [AGENT_PITCH, ...AGENT_DETAIL].join(" ") },
      ]),
    ).toEqual([]);
  });
});

describe("checkAgentDetail", () => {
  it("accepts the store's detail, item for item", () => {
    expect(checkAgentDetail("docs/delegating.md", [...AGENT_DETAIL])).toEqual([]);
  });

  it("reports a reordered, shortened or reworded list", () => {
    const finding = "✗ docs/delegating.md: the agent detail under the pitch differs from the store";
    expect(checkAgentDetail("docs/delegating.md", AGENT_DETAIL.toReversed())).toEqual([finding]);
    expect(checkAgentDetail("docs/delegating.md", AGENT_DETAIL.slice(1))).toEqual([finding]);
    expect(checkAgentDetail("docs/delegating.md", [])).toEqual([finding]);
  });
});

describe("checkClaims", () => {
  it("gives no finding when every proof is shipped and every claim is said", () => {
    expect(checkClaims(CLAIMS, shippedByStore(), claimTexts())).toEqual([]);
  });

  it("reports a claim whose command or route proof is not shipped", () => {
    const claims: ReadonlyArray<Claim> = [
      {
        of: "agent detail",
        text: "Every command answers JSON with a schema.",
        proof: { kind: "command", command: "phax inbox" },
      },
      {
        of: "agent detail",
        text: "Every command answers JSON with a schema.",
        proof: { kind: "route", route: "/guide/inbox" },
      },
    ];
    expect(checkClaims(claims, shippedByStore(), claimTexts())).toEqual([
      '✗ claim "Every command answers JSON with a schema." (agent detail): proof phax inbox is not a command phax has',
      '✗ claim "Every command answers JSON with a schema." (agent detail): proof /guide/inbox is not a route the site builds',
    ]);
  });

  it("reports a claim its backed text does not say", () => {
    const claim: Claim = {
      of: "person pitch",
      text: "every run is free",
      proof: { kind: "route", route: "/guide/run" },
    };
    expect(checkClaims([claim], shippedByStore(), claimTexts())).toEqual([
      '✗ claim "every run is free" (person pitch): not said by its person pitch',
    ]);
  });

  it("accepts proofs from a page map and a command tree, a group path counting as a command", () => {
    const pageMap = definePageMap({
      repository: "https://example.test/phax",
      readme: [
        { route: "/", title: "phax", sections: [INTRO] },
        { omit: ["License"], why: "fixture" },
      ],
      files: [
        { route: "/guide/run", source: "docs/run.md", description: "Running." },
        {
          route: "/guide/later",
          source: "docs/later.md",
          description: "Held.",
          holdUntil: "9.0.0",
        },
        { omit: "docs/internal.md", why: "fixture" },
      ],
    });
    const tree = {
      name: "phax",
      commands: [
        { name: "run" },
        { name: "cost", commands: [{ name: "show" }] },
        { name: "plans", commands: [{ name: "lint" }] },
      ],
    };
    const shipped: Shipped = { routes: builtRoutes(pageMap), commands: commandPaths(tree) };
    expect([...shipped.routes]).toEqual(["/", "/guide/run"]);
    expect([...shipped.commands].toSorted()).toEqual([
      "phax cost",
      "phax cost show",
      "phax plans",
      "phax plans lint",
      "phax run",
    ]);
    const claims = CLAIMS.filter((claim) =>
      claim.proof.kind === "route"
        ? claim.proof.route === "/guide/run"
        : ["phax run", "phax cost", "phax plans lint"].includes(claim.proof.command),
    );
    expect(claims.length).toBeGreaterThan(3);
    expect(checkClaims(claims, shipped, claimTexts())).toEqual([]);
    expect(
      checkClaims(
        [
          {
            of: "agent pitch",
            text: "results you can verify",
            proof: { kind: "route", route: "/guide/later" },
          },
        ],
        shipped,
        claimTexts(),
      ),
    ).toEqual([
      '✗ claim "results you can verify" (agent pitch): proof /guide/later is not a route the site builds',
    ]);
  });

  it("reads a flattened tree's commands through their group chains", () => {
    const plans = { name: "plans" };
    const tree = {
      name: "phax",
      commands: [
        { name: "run" },
        { name: "lint", group: plans },
        { name: "show", group: { name: "ledger", parent: { name: "cost" } } },
      ],
    };
    expect([...commandPaths(tree)].toSorted()).toEqual([
      "phax cost",
      "phax cost ledger",
      "phax cost ledger show",
      "phax plans",
      "phax plans lint",
      "phax run",
    ]);
  });
});

describe("readers", () => {
  it("reads README.md's opening past a badge paragraph, as one line", () => {
    const readme = [
      "# phax",
      "",
      "[![CI](https://example.test/ci.svg)](https://example.test/ci)",
      "",
      "phax is verified",
      "delegation.",
      "",
      "## Install",
    ].join("\n");
    expect(readmeOpening(readme)).toBe("phax is verified delegation.");
  });

  it("reads a package.json description", () => {
    expect(packageDescription('{ "name": "phax", "description": "phax is it." }')).toBe(
      "phax is it.",
    );
    expect(packageDescription('{ "name": "phax" }')).toBe("");
  });

  it("reads the top-level about line of a usage spec, unescaped", () => {
    const kdl = [
      "name phax",
      "cmd run {",
      '  about "not this one"',
      "}",
      'about "phax says \\"verified\\" delegation"',
    ].join("\n");
    expect(usageAbout(kdl)).toBe('phax says "verified" delegation');
    expect(usageAbout("name phax")).toBe("");
  });

  it("reads a section's wrapped opening paragraph and the list right after it", () => {
    const markdown = [
      "# phax CLI skill",
      "",
      "The map.",
      "",
      "## What phax is",
      "",
      "phax is verified delegation",
      "for agents.",
      "",
      "- One `item`.",
      "- Two",
      "  wrapped.",
      "",
      "More text.",
      "",
      "## Next",
    ].join("\n");
    expect(sectionOpening(markdown, "What phax is")).toEqual({
      paragraph: "phax is verified delegation for agents.",
      list: ["One item.", "Two wrapped."],
    });
    expect(sectionOpening(markdown, "phax CLI skill")).toEqual({ paragraph: "The map.", list: [] });
    expect(sectionOpening(markdown, "Missing")).toEqual({ paragraph: "", list: [] });
    expect(sectionOpening("## Empty\n\n## Next\n\nText.", "Empty")).toEqual({
      paragraph: "",
      list: [],
    });
  });

  it("reads a skill's frontmatter description, plain or quoted", () => {
    expect(skillDescription("---\nname: phax-cli\ndescription: Operate phax.\n---\n\n# x\n")).toBe(
      "Operate phax.",
    );
    expect(skillDescription('---\ndescription: "Operate: phax."\n---\n')).toBe("Operate: phax.");
    expect(skillDescription("# no frontmatter\n")).toBe("");
  });

  it("reads the blockquote after an llms.txt's title", () => {
    const llms = ["# phax", "", `> ${AGENT_PITCH}`, "", "## Guide", "", "> not this"].join("\n");
    expect(llmsIntroduction(llms)).toBe(AGENT_PITCH);
    expect(llmsIntroduction("> before a title\n")).toBe("");
  });
});

describe("the store", () => {
  it("lists the four moments in order with their links", () => {
    expect(HOME_FEATURES.map((feature) => [feature.key, feature.link])).toEqual([
      ["author", "/guide/specs-and-plans"],
      ["run", "/guide/run"],
      ["review", "/guide/review-and-land"],
      ["keep", "/guide/records"],
    ]);
  });

  it("has every claim said by what it backs", () => {
    const texts = claimTexts();
    const unsaid = CLAIMS.filter(
      (claim) => !(texts[claim.of] ?? "").toLowerCase().includes(claim.text.toLowerCase()),
    );
    expect(unsaid).toEqual([]);
  });

  it("backs every home feature and every agent-detail item with a claim", () => {
    for (const feature of HOME_FEATURES) {
      expect(CLAIMS.some((claim) => claim.of === `home feature ${feature.key}`)).toBe(true);
    }
    for (const item of AGENT_DETAIL) {
      expect(CLAIMS.some((claim) => claim.of === "agent detail" && claim.text === item)).toBe(true);
    }
  });

  it("names every command proof as a phax command", () => {
    for (const claim of CLAIMS) {
      if (claim.proof.kind === "command") expect(claim.proof.command).toMatch(/^phax \S/);
    }
  });

  it("names verified delegation in both pitches", () => {
    expect(
      checkName([
        { label: "person", reader: "person", text: PERSON_PITCH },
        { label: "agent", reader: "agent", text: AGENT_PITCH },
      ]),
    ).toEqual([]);
  });
});
