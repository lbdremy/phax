// The one store of phax's positioning: what phax says about itself, to a
// person and to an agent, the home page's four moments, every claim those
// make with the docs route or phax command that proves it, and the names phax
// is never given. `site/pages.ts` and `site/build/llms.ts` read from it; every
// other place (README.md, both package.json files, the CLI's summary and its
// usage spec, context7.json, the phax-cli skill, the agent page and the
// comparison pages) is
// compared with it word for word by the checks below. The module is pure:
// callers read the files and hand their text to the readers and the checks.
import type { Nodes } from "mdast";
import { readmeDescription } from "./generate.js";
import { parseMarkdown, plainText } from "./markdown.js";
import type { HomeFeature, PageMap } from "./pageMap.js";

/** The pitch to a person: README.md, both package.json files, the home tagline, the site description. */
export const PERSON_PITCH =
  "phax is verified delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a fate, and the history stays in Git.";

/** The one-sentence pitch to an agent: `phax --help`, the usage spec, the phax-cli skill, llms.txt, the agent page. */
export const AGENT_PITCH =
  "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.";

/** The list directly under the agent pitch on the agent page and in the phax-cli skill; never in `phax --help` or llms.txt. */
export const AGENT_DETAIL: ReadonlyArray<string> = [
  "Each phase runs in an isolated Git worktree.",
  "Its gate commands must exit 0 before the next phase starts.",
  "The files it touched are reconciled with the plan.",
  "Run state outlives your context: phax resume picks up where the run stopped.",
  "Every command answers JSON with a schema.",
];

/** The home page's four moments, in order: author, run, review, keep. */
export const HOME_FEATURES: ReadonlyArray<HomeFeature> = [
  {
    key: "author",
    title: "Author",
    details:
      "Specs and plans with a status and an approval, drafted headless from a brief, open questions decided with <code>phax artifact decide</code>, plans linted, estimated and checked for overlap.",
    link: "/guide/specs-and-plans",
  },
  {
    key: "run",
    title: "Run",
    details:
      "Each phase in its own worktree with the agent you pick; nothing moves until your gates pass; every file planned vs. done.",
    link: "/guide/run",
  },
  {
    key: "review",
    title: "Review",
    details:
      "A compliance verdict against the plan, a headless code review whose findings each get a fate, and a pull request that explains itself.",
    link: "/guide/review-and-land",
  },
  {
    key: "keep",
    title: "Keep",
    details: "Each phase's record on <code>phax/records/v1</code> and a cost ledger per run.",
    link: "/guide/records",
  },
];

/** What proves a claim: a route every build of the site renders, or a command of phax's tree (`phax …`). */
export type Proof =
  | { readonly kind: "route"; readonly route: string }
  | { readonly kind: "command"; readonly command: string };

/** What a claim backs: a pitch, the agent detail, or one home feature by its key. */
export type ClaimOf = "person pitch" | "agent pitch" | "agent detail" | `home feature ${string}`;

export interface Claim {
  readonly of: ClaimOf;
  /** Words the backed text says, matched case-insensitively. */
  readonly text: string;
  readonly proof: Proof;
}

const route = (path: string): Proof => ({ kind: "route", route: path });
const command = (path: `phax ${string}`): Proof => ({ kind: "command", command: path });

export const CLAIMS: ReadonlyArray<Claim> = [
  {
    of: "person pitch",
    text: "hand work to Claude Code, OpenAI Codex or Mistral Vibe",
    proof: route("/guide/providers-and-security"),
  },
  { of: "person pitch", text: "every phase passed your checks", proof: route("/guide/run") },
  { of: "person pitch", text: "every file is accounted for", proof: route("/guide/concepts") },
  { of: "person pitch", text: "every finding has a fate", proof: route("/guide/findings") },
  { of: "person pitch", text: "the history stays in Git", proof: route("/guide/records") },
  { of: "agent pitch", text: "results you can verify", proof: route("/guide/delegating") },
  { of: "agent detail", text: AGENT_DETAIL[0] ?? "", proof: command("phax run") },
  { of: "agent detail", text: AGENT_DETAIL[1] ?? "", proof: route("/guide/set-up") },
  { of: "agent detail", text: AGENT_DETAIL[2] ?? "", proof: command("phax review-handoff") },
  { of: "agent detail", text: AGENT_DETAIL[3] ?? "", proof: command("phax resume") },
  { of: "agent detail", text: AGENT_DETAIL[4] ?? "", proof: route("/reference/json-output") },
  {
    of: "home feature author",
    text: "Specs and plans with a status and an approval",
    proof: route("/guide/specs-and-plans"),
  },
  {
    of: "home feature author",
    text: "open questions decided with phax artifact decide",
    proof: command("phax artifact decide"),
  },
  { of: "home feature author", text: "plans linted", proof: command("phax plans lint") },
  { of: "home feature author", text: "estimated", proof: command("phax plans estimate") },
  { of: "home feature author", text: "checked for overlap", proof: command("phax plans overlap") },
  { of: "home feature run", text: "Each phase in its own worktree", proof: command("phax run") },
  {
    of: "home feature run",
    text: "nothing moves until your gates pass",
    proof: route("/guide/run"),
  },
  { of: "home feature run", text: "every file planned vs. done", proof: route("/guide/concepts") },
  {
    of: "home feature review",
    text: "A compliance verdict against the plan",
    proof: command("phax review-compliance"),
  },
  {
    of: "home feature review",
    text: "a headless code review whose findings each get a fate",
    proof: route("/guide/findings"),
  },
  {
    of: "home feature review",
    text: "a pull request that explains itself",
    proof: command("phax publish-pr"),
  },
  {
    of: "home feature keep",
    text: "Each phase's record on phax/records/v1",
    proof: route("/guide/records"),
  },
  { of: "home feature keep", text: "a cost ledger per run", proof: command("phax cost") },
];

/** Names phax is never given, matched as whole words in any letter case, plural included. */
export const REJECTED_NAMES: ReadonlyArray<string> = [
  "harness",
  "orchestrator",
  "orchestration engine",
  "control plane",
  "software factory",
];

/** Who a place speaks to: a person, an agent, or no one in particular (it carries the name but no pitch). */
export type Reader = "person" | "agent" | "name";

/** What one place says about phax. `label` is what a finding names: a file path or a surface. */
export interface Place {
  readonly label: string;
  readonly reader: Reader;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Readers: a source text in, what the place says out.

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** README.md's opening: its first paragraph that is not badges, the site's description too. */
export function readmeOpening(readme: string): string {
  return readmeDescription(readme);
}

/** A JSON file's `description` field (package.json, context7.json); empty when there is none. */
export function packageDescription(jsonText: string): string {
  const parsed: unknown = JSON.parse(jsonText);
  if (typeof parsed !== "object" || parsed === null || !("description" in parsed)) return "";
  return typeof parsed.description === "string" ? normalise(parsed.description) : "";
}

const KDL_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  s: " ",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/** The string of a usage spec's top-level `about "…"` line, unescaped; empty when there is none. */
export function usageAbout(kdlText: string): string {
  for (const line of kdlText.split("\n")) {
    const match = /^about\s+"((?:[^"\\]|\\.)*)"/.exec(line);
    if (match === null) continue;
    return normalise(
      (match[1] ?? "").replace(
        /\\(.)/g,
        (_all, escaped: string) => KDL_ESCAPES[escaped] ?? escaped,
      ),
    );
  }
  return "";
}

export interface SectionOpening {
  /** The first paragraph under the heading, as one line of plain text. */
  readonly paragraph: string;
  /** The items of the list directly after that paragraph; empty when the next node is not a list. */
  readonly list: ReadonlyArray<string>;
}

/**
 * The opening of a Markdown section: the first paragraph under the heading
 * whose plain text is `heading` (the `#` title included) and the list right
 * after it. A missing heading or paragraph reads as empty.
 */
export function sectionOpening(markdown: string, heading: string): SectionOpening {
  const nodes: ReadonlyArray<Nodes> = parseMarkdown(markdown).children;
  const start = nodes.findIndex(
    (node) => node.type === "heading" && normalise(plainText(node)) === heading,
  );
  const empty: SectionOpening = { paragraph: "", list: [] };
  const opener = nodes[start];
  if (opener?.type !== "heading") return empty;
  for (let index = start + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) break;
    if (node.type === "heading" && node.depth <= opener.depth) break;
    if (node.type !== "paragraph") continue;
    const next = nodes[index + 1];
    return {
      paragraph: normalise(plainText(node)),
      list: next?.type === "list" ? next.children.map((item) => normalise(plainText(item))) : [],
    };
  }
  return empty;
}

/**
 * The first paragraph of a Markdown document, at any depth (a list item's
 * included), whose plain text starts with `prefix`, as one line; empty when
 * there is none.
 */
export function paragraphStartingWith(markdown: string, prefix: string): string {
  const found = (node: Nodes): string => {
    if (node.type === "paragraph") {
      const text = normalise(plainText(node));
      return text.startsWith(prefix) ? text : "";
    }
    if (!("children" in node)) return "";
    for (const child of node.children) {
      const text = found(child);
      if (text !== "") return text;
    }
    return "";
  };
  return found(parseMarkdown(markdown));
}

/** The `description` of a skill's frontmatter, unquoted; empty when there is none. */
export function skillDescription(skillText: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillText);
  if (frontmatter === null) return "";
  const line = /^description:[ \t]*(.*)$/m.exec(frontmatter[1] ?? "");
  if (line === null) return "";
  const value = (line[1] ?? "").trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return normalise(quoted === null ? value : (quoted[2] ?? ""));
}

/** The introduction of an llms.txt: the first `> ` line after its `# ` title; empty when there is none. */
export function llmsIntroduction(llmsText: string): string {
  const lines = llmsText.split("\n");
  const title = lines.findIndex((line) => line.startsWith("# "));
  if (title === -1) return "";
  const quote = lines.slice(title + 1).find((line) => line.startsWith("> "));
  return quote === undefined ? "" : normalise(quote.slice(2));
}

// ---------------------------------------------------------------------------
// Proofs: what the site builds and what phax has.

/** The routes every build renders: each README page and file page of the map with no `holdUntil`. */
export function builtRoutes(pageMap: PageMap): ReadonlySet<string> {
  const routes = new Set<string>();
  for (const entry of [...pageMap.readme, ...pageMap.files]) {
    if ("route" in entry && entry.holdUntil === undefined) routes.add(entry.route);
  }
  return routes;
}

/** The group a flattened command stands in, and the group that one stands in when nested. */
export interface CommandGroup {
  readonly name: string;
  readonly parent?: CommandGroup;
}

/**
 * A command of the program's tree, or a group holding more of them; typed by
 * shape so `src/cli` is never imported. `defineProgram` flattens its groups:
 * each command then carries its `group` chain instead of sitting in a group.
 */
export type CommandNode =
  | { readonly name: string; readonly group?: CommandGroup }
  | { readonly name: string; readonly commands: ReadonlyArray<CommandNode> };

export interface CommandTree {
  readonly name: string;
  readonly commands: ReadonlyArray<CommandNode>;
}

/** Every command's and group's path, `phax <word> …`. */
export function commandPaths(tree: CommandTree): ReadonlySet<string> {
  const paths = new Set<string>();
  // A flattened command's groups, outermost first, each one's path added.
  const groupPrefix = (prefix: string, group: CommandGroup | undefined): string => {
    if (group === undefined) return prefix;
    const path = `${groupPrefix(prefix, group.parent)} ${group.name}`;
    paths.add(path);
    return path;
  };
  const visit = (prefix: string, nodes: ReadonlyArray<CommandNode>): void => {
    for (const node of nodes) {
      if ("commands" in node) {
        const path = `${prefix} ${node.name}`;
        paths.add(path);
        visit(path, node.commands);
      } else {
        paths.add(`${groupPrefix(prefix, node.group)} ${node.name}`);
      }
    }
  };
  visit(tree.name, tree.commands);
  return paths;
}

// ---------------------------------------------------------------------------
// Checks: each returns `✗ …` findings, empty when sound.

const PITCHES: Readonly<Record<Exclude<Reader, "name">, string>> = {
  person: PERSON_PITCH,
  agent: AGENT_PITCH,
};

/** A person or agent place that does not carry its reader's pitch word for word. */
export function checkPitches(places: ReadonlyArray<Place>): ReadonlyArray<string> {
  return places.flatMap((place) =>
    place.reader !== "name" && place.text !== PITCHES[place.reader]
      ? [`✗ ${place.label}: does not carry the ${place.reader} pitch word for word`]
      : [],
  );
}

/** A place that does not say "verified delegation". */
export function checkName(places: ReadonlyArray<Place>): ReadonlyArray<string> {
  return places.flatMap((place) =>
    /\bverified\s+delegation\b/i.test(place.text)
      ? []
      : [`✗ ${place.label}: does not name verified delegation`],
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REJECTED_PATTERN = new RegExp(
  `\\b(?:${REJECTED_NAMES.map((name) => escapeRegExp(name).replace(/ /g, "\\s+")).join("|")})(?:e?s)?\\b`,
  "gi",
);

/** Each rejected name a place uses, as written in its text. */
export function checkRejectedNames(places: ReadonlyArray<Place>): ReadonlyArray<string> {
  return places.flatMap((place) =>
    [...place.text.matchAll(REJECTED_PATTERN)].map(
      (match) => `✗ ${place.label}: names phax "${match[0]}"`,
    ),
  );
}

/** A list under the agent pitch that is not AGENT_DETAIL, item for item and in order. */
export function checkAgentDetail(
  label: string,
  items: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const same =
    items.length === AGENT_DETAIL.length &&
    items.every((item, index) => item === AGENT_DETAIL[index]);
  return same ? [] : [`✗ ${label}: the agent detail under the pitch differs from the store`];
}

/** What the site builds and what phax has, the proofs a claim may name. */
export interface Shipped {
  readonly routes: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** The text each claim of the store backs: the pitches, the joined detail, each feature's title and details untagged. */
export function claimTexts(
  features: ReadonlyArray<HomeFeature> = HOME_FEATURES,
): Readonly<Record<string, string>> {
  const texts: Record<string, string> = {
    "person pitch": PERSON_PITCH,
    "agent pitch": AGENT_PITCH,
    "agent detail": AGENT_DETAIL.join(" "),
  };
  for (const feature of features) {
    texts[`home feature ${feature.key}`] = `${feature.title} ${stripTags(feature.details)}`;
  }
  return texts;
}

/** A claim whose proof is not shipped, or whose words the text it backs does not say. */
export function checkClaims(
  claims: ReadonlyArray<Claim>,
  shipped: Shipped,
  texts: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  return claims.flatMap((claim) => {
    const findings: Array<string> = [];
    const name = `claim "${claim.text}" (${claim.of})`;
    if (claim.proof.kind === "route" && !shipped.routes.has(claim.proof.route)) {
      findings.push(`✗ ${name}: proof ${claim.proof.route} is not a route the site builds`);
    }
    if (claim.proof.kind === "command" && !shipped.commands.has(claim.proof.command)) {
      findings.push(`✗ ${name}: proof ${claim.proof.command} is not a command phax has`);
    }
    const backed = texts[claim.of];
    if (
      backed === undefined ||
      !normalise(backed).toLowerCase().includes(normalise(claim.text).toLowerCase())
    ) {
      findings.push(`✗ ${name}: not said by its ${claim.of}`);
    }
    return findings;
  });
}
