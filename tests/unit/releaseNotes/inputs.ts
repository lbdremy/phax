// Made-up inputs of the release notes builder and the exact documents it must
// write from them. Every expected document is a literal list of lines, written
// out by hand from the layout in the plan: none is computed by a helper, so an
// oracle cannot agree with the builder by sharing its mistake.
import type {
  ReleaseCommit,
  ReleaseNotesInput,
  ReleasePlan,
  ReleaseSpec,
  ReleaseSurface,
} from "../../../scripts/releaseNotes.js";

const REPOSITORY = "https://github.com/acme/tool";

// An upgrading file with no `### 4.2.0` entry.
const UPGRADING_WITHOUT_ENTRY = [
  "# Upgrading",
  "",
  "Steps for each release.",
  "",
  "### 4.1.0",
  "",
  "- Older step.",
  "",
].join("\n");

export const NO_ENTRY_WARNING =
  'docs/upgrading.md has no "### 4.2.0" entry: the notes have no Upgrading section';

export function inputWith(overrides: Partial<ReleaseNotesInput>): ReleaseNotesInput {
  return {
    version: "4.2.0",
    previous: "4.1.0",
    repository: REPOSITORY,
    upgrading: UPGRADING_WITHOUT_ENTRY,
    plans: [],
    commits: [],
    ...overrides,
  };
}

// The title and the Changes line every document opens with.
export const HEAD: ReadonlyArray<string> = [
  "# phax 4.2.0",
  "",
  "Changes since 4.1.0: [v4.1.0...v4.2.0](https://github.com/acme/tool/compare/v4.1.0...v4.2.0).",
  "",
];

export function specNamed(title: string, surface: ReadonlyArray<ReleaseSurface>): ReleaseSpec {
  return {
    path: "docs/specs/archive/2601010009-table.md",
    title,
    guidingRule: null,
    surface,
  };
}

export function completingPlan(title: string, spec: ReleaseSpec): ReleasePlan {
  return {
    path: "docs/plans/archive/2601010009-table-plan.md",
    title,
    firstParagraph: "Not shown for a plan that has a spec.",
    spec,
    completesSpec: true,
  };
}

// --- fullInput ---------------------------------------------------------------

const FULL_UPGRADING = [
  "# Upgrading",
  "",
  "Steps for each release.",
  "",
  "### 4.2.0",
  "",
  "- **Rename the option.** Read [the bounds](bounds.md#limits) first, then [the readme](../README.md#install).",
  "- Jump to [the checks](#after-every-upgrade) or to [security](/docs/security.md).",
  "- Upstream notes live at [the project](https://example.com/notes).",
  "",
  "#### After every upgrade",
  "",
  "Run `tool doctor`.",
  "",
  "### 4.1.0",
  "",
  "- Older step.",
  "",
].join("\n");

const ALPHA_SPEC: ReleaseSpec = {
  path: "docs/specs/archive/2601010000-alpha.md",
  title: "Alpha spec — big idea",
  guidingRule: "Alpha never runs twice.",
  surface: [],
};

const BETA_SURFACES: ReadonlyArray<ReleaseSurface> = [
  {
    surface: "cli: tool ship <name>",
    summary: "You can ship a named thing.",
    before: null,
    after: "tool ship acme\nshipped acme",
  },
  {
    surface: "api: shipThing(name)",
    summary: "A function ships a thing.",
    before: null,
    after: "shipThing('acme')",
  },
  {
    surface: "config: `tool.json` key `ship`",
    summary: "You turn shipping on in the config.",
    before: "{}",
    after: '{ "ship": true }',
  },
  {
    surface: "package: @acme/tool exports shipThing",
    summary: "The package exports the function.",
    before: null,
    after: "export { shipThing }",
  },
  {
    surface: "file: tool.log",
    summary: "The log records each shipment.",
    before: "old line",
    after: "```sh\ntool ship\n```",
  },
  {
    surface: "internal: src/ship.ts",
    summary: "The shipping module.",
    before: null,
    after: "export const ship = 1;",
  },
];

const BETA_SPEC: ReleaseSpec = {
  path: "docs/specs/archive/2601010001-beta.md",
  title: "Ship things — make shipping easy — and fast",
  guidingRule: "Shipping never changes what the tool already did.",
  surface: BETA_SURFACES,
};

const GAMMA_SPEC: ReleaseSpec = {
  path: "docs/specs/archive/2601010002-gamma.md",
  title: "Gamma stands alone",
  guidingRule: null,
  surface: [],
};

const ALPHA_FIRST_PLAN: ReleasePlan = {
  path: "docs/plans/archive/2601010002-alpha-first.md",
  title: "Alpha first step",
  firstParagraph: "The first step of the alpha spec.",
  spec: ALPHA_SPEC,
  completesSpec: false,
};

const BETA_FINAL_PLAN: ReleasePlan = {
  path: "docs/plans/archive/2601010003-beta-final.md",
  title: "Beta final step",
  firstParagraph: "The last step of the beta spec.",
  spec: BETA_SPEC,
  completesSpec: true,
};

const BETA_FIRST_PLAN: ReleasePlan = {
  path: "docs/plans/archive/2601010004-beta-first.md",
  title: "Beta first step",
  firstParagraph: "The first step of the beta spec.",
  spec: BETA_SPEC,
  completesSpec: false,
};

export const LOOSE_PLAN: ReleasePlan = {
  path: "docs/plans/archive/2601010005-loose-plan.md",
  title: "Loose plan",
  firstParagraph: [
    "Adds a `thing` command. See [the spec](../specs/2601010000-made-up.md), [the context](#context),",
    "[the readme](/README.md#install) and [the docs](https://example.com/docs).",
  ].join("\n"),
  spec: null,
  completesSpec: false,
};

const GAMMA_PLAN: ReleasePlan = {
  path: "docs/plans/archive/2601010006-gamma-only.md",
  title: "Gamma plan",
  firstParagraph: "The only step of the gamma spec.",
  spec: GAMMA_SPEC,
  completesSpec: true,
};

const hash = (pair: string): string => pair.repeat(20);

export const COMMITS: ReadonlyArray<ReleaseCommit> = [
  { hash: hash("01"), subject: "fix: handle the empty range" },
  { hash: hash("02"), subject: "fix(scope): name the missing tag" },
  { hash: hash("03"), subject: "fix: keep <tag> and a_b [x] intact" },
  { hash: hash("04"), subject: "Fix: capital letters count" },
  { hash: hash("05"), subject: "feat(scope)!: drop the old flag" },
  { hash: hash("06"), subject: "perf: read the tags once" },
  { hash: hash("07"), subject: "revert: bring back the old banner" },
  { hash: hash("08"), subject: "docs: reword the guide" },
  { hash: hash("09"), subject: "test: cover the empty range" },
  { hash: hash("0a"), subject: "chore(plans): approve the plan" },
  { hash: hash("0b"), subject: "refactor: split the reader" },
  { hash: hash("0c"), subject: "style: format the scripts" },
  { hash: hash("0d"), subject: "build: bump the compiler" },
  { hash: hash("0e"), subject: "ci: fetch the tags" },
  { hash: hash("0f"), subject: "wip: half a change" },
  { hash: hash("10"), subject: "Tidy things up a little" },
];

export const fullInput: ReleaseNotesInput = {
  version: "4.2.0",
  previous: "4.1.0",
  repository: REPOSITORY,
  upgrading: FULL_UPGRADING,
  plans: [ALPHA_FIRST_PLAN, BETA_FINAL_PLAN, BETA_FIRST_PLAN, LOOSE_PLAN, GAMMA_PLAN],
  commits: COMMITS,
};

export const fullExpectedWarnings: ReadonlyArray<string> = [];

export const fullExpected = [
  "# phax 4.2.0",
  "",
  "Changes since 4.1.0: [v4.1.0...v4.2.0](https://github.com/acme/tool/compare/v4.1.0...v4.2.0).",
  "",
  "## Upgrading",
  "",
  "- **Rename the option.** Read [the bounds](https://github.com/acme/tool/blob/v4.2.0/docs/bounds.md#limits) first, then [the readme](https://github.com/acme/tool/blob/v4.2.0/README.md#install).",
  "- Jump to [the checks](https://github.com/acme/tool/blob/v4.2.0/docs/upgrading.md#after-every-upgrade) or to [security](https://github.com/acme/tool/blob/v4.2.0/docs/security.md).",
  "- Upstream notes live at [the project](https://example.com/notes).",
  "",
  "#### After every upgrade",
  "",
  "Run `tool doctor`.",
  "",
  "## Specs",
  "",
  "### Ship things",
  "",
  "Make shipping easy — and fast.",
  "",
  "> Shipping never changes what the tool already did.",
  "",
  "Plans: Beta final step, Beta first step.",
  "",
  "`cli: tool ship <name>` — You can ship a named thing.",
  "",
  "<details>",
  "<summary>After</summary>",
  "",
  "```text",
  "tool ship acme",
  "shipped acme",
  "```",
  "",
  "</details>",
  "",
  "`` config: `tool.json` key `ship` `` — You turn shipping on in the config.",
  "",
  "<details>",
  "<summary>Before and after</summary>",
  "",
  "Before:",
  "",
  "```text",
  "{}",
  "```",
  "",
  "After:",
  "",
  "```text",
  '{ "ship": true }',
  "```",
  "",
  "</details>",
  "",
  "`file: tool.log` — The log records each shipment.",
  "",
  "<details>",
  "<summary>Before and after</summary>",
  "",
  "Before:",
  "",
  "```text",
  "old line",
  "```",
  "",
  "After:",
  "",
  "````text",
  "```sh",
  "tool ship",
  "```",
  "````",
  "",
  "</details>",
  "",
  "### Gamma stands alone",
  "",
  "Plans: Gamma plan.",
  "",
  "## Specs in progress",
  "",
  "- Part of Alpha spec: Alpha first step",
  "",
  "## Plans",
  "",
  "### Loose plan",
  "",
  "Adds a `thing` command. See [the spec](https://github.com/acme/tool/blob/v4.2.0/docs/specs/2601010000-made-up.md), [the context](https://github.com/acme/tool/blob/v4.2.0/docs/plans/archive/2601010005-loose-plan.md#context),",
  "[the readme](https://github.com/acme/tool/blob/v4.2.0/README.md#install) and [the docs](https://example.com/docs).",
  "",
  "## Fixes",
  "",
  "- fix: handle the empty range ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "- fix(scope): name the missing tag ([0202020](https://github.com/acme/tool/commit/0202020202020202020202020202020202020202))",
  "- fix: keep \\<tag\\> and a\\_b \\[x\\] intact ([0303030](https://github.com/acme/tool/commit/0303030303030303030303030303030303030303))",
  "- Fix: capital letters count ([0404040](https://github.com/acme/tool/commit/0404040404040404040404040404040404040404))",
  "",
  "## Other",
  "",
  "- feat(scope)!: drop the old flag ([0505050](https://github.com/acme/tool/commit/0505050505050505050505050505050505050505))",
  "- perf: read the tags once ([0606060](https://github.com/acme/tool/commit/0606060606060606060606060606060606060606))",
  "- revert: bring back the old banner ([0707070](https://github.com/acme/tool/commit/0707070707070707070707070707070707070707))",
  "- wip: half a change ([0f0f0f0](https://github.com/acme/tool/commit/0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f))",
  "- Tidy things up a little ([1010101](https://github.com/acme/tool/commit/1010101010101010101010101010101010101010))",
  "",
].join("\n");

// `githubReleaseBody(fullExpected, "4.2.0")`: the folded blocks gone, the site
// link after the Changes line.
export const fullExpectedShort = [
  "# phax 4.2.0",
  "",
  "Changes since 4.1.0: [v4.1.0...v4.2.0](https://github.com/acme/tool/compare/v4.1.0...v4.2.0).",
  "",
  "Read the full notes, with each surface's before and after, on [docs.phax.run/releases/4-2-0](https://docs.phax.run/releases/4-2-0).",
  "",
  "## Upgrading",
  "",
  "- **Rename the option.** Read [the bounds](https://github.com/acme/tool/blob/v4.2.0/docs/bounds.md#limits) first, then [the readme](https://github.com/acme/tool/blob/v4.2.0/README.md#install).",
  "- Jump to [the checks](https://github.com/acme/tool/blob/v4.2.0/docs/upgrading.md#after-every-upgrade) or to [security](https://github.com/acme/tool/blob/v4.2.0/docs/security.md).",
  "- Upstream notes live at [the project](https://example.com/notes).",
  "",
  "#### After every upgrade",
  "",
  "Run `tool doctor`.",
  "",
  "## Specs",
  "",
  "### Ship things",
  "",
  "Make shipping easy — and fast.",
  "",
  "> Shipping never changes what the tool already did.",
  "",
  "Plans: Beta final step, Beta first step.",
  "",
  "`cli: tool ship <name>` — You can ship a named thing.",
  "",
  "`` config: `tool.json` key `ship` `` — You turn shipping on in the config.",
  "",
  "`file: tool.log` — The log records each shipment.",
  "",
  "### Gamma stands alone",
  "",
  "Plans: Gamma plan.",
  "",
  "## Specs in progress",
  "",
  "- Part of Alpha spec: Alpha first step",
  "",
  "## Plans",
  "",
  "### Loose plan",
  "",
  "Adds a `thing` command. See [the spec](https://github.com/acme/tool/blob/v4.2.0/docs/specs/2601010000-made-up.md), [the context](https://github.com/acme/tool/blob/v4.2.0/docs/plans/archive/2601010005-loose-plan.md#context),",
  "[the readme](https://github.com/acme/tool/blob/v4.2.0/README.md#install) and [the docs](https://example.com/docs).",
  "",
  "## Fixes",
  "",
  "- fix: handle the empty range ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "- fix(scope): name the missing tag ([0202020](https://github.com/acme/tool/commit/0202020202020202020202020202020202020202))",
  "- fix: keep \\<tag\\> and a\\_b \\[x\\] intact ([0303030](https://github.com/acme/tool/commit/0303030303030303030303030303030303030303))",
  "- Fix: capital letters count ([0404040](https://github.com/acme/tool/commit/0404040404040404040404040404040404040404))",
  "",
  "## Other",
  "",
  "- feat(scope)!: drop the old flag ([0505050](https://github.com/acme/tool/commit/0505050505050505050505050505050505050505))",
  "- perf: read the tags once ([0606060](https://github.com/acme/tool/commit/0606060606060606060606060606060606060606))",
  "- revert: bring back the old banner ([0707070](https://github.com/acme/tool/commit/0707070707070707070707070707070707070707))",
  "- wip: half a change ([0f0f0f0](https://github.com/acme/tool/commit/0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f))",
  "- Tidy things up a little ([1010101](https://github.com/acme/tool/commit/1010101010101010101010101010101010101010))",
  "",
].join("\n");

// --- (b) the surface table ---------------------------------------------------

export interface SurfaceRow {
  readonly name: string;
  readonly element: ReleaseSurface;
  readonly expected: string;
}

export const surfaceRows: ReadonlyArray<SurfaceRow> = [
  {
    name: "cli",
    element: { surface: "cli: tool run", summary: "You can run it.", before: null, after: "ran" },
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Surfaces",
      "",
      "Plans: Surface plan.",
      "",
      "`cli: tool run` — You can run it.",
      "",
      "<details>",
      "<summary>After</summary>",
      "",
      "```text",
      "ran",
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
  },
  {
    name: "config",
    element: {
      surface: "config: tool.json key run",
      summary: "You set it.",
      before: "{}",
      after: '{ "run": 1 }',
    },
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Surfaces",
      "",
      "Plans: Surface plan.",
      "",
      "`config: tool.json key run` — You set it.",
      "",
      "<details>",
      "<summary>Before and after</summary>",
      "",
      "Before:",
      "",
      "```text",
      "{}",
      "```",
      "",
      "After:",
      "",
      "```text",
      '{ "run": 1 }',
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
  },
  {
    name: "file",
    element: { surface: "file: tool.log", summary: "You read it.", before: null, after: "line" },
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Surfaces",
      "",
      "Plans: Surface plan.",
      "",
      "`file: tool.log` — You read it.",
      "",
      "<details>",
      "<summary>After</summary>",
      "",
      "```text",
      "line",
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
  },
  ...["api: run()", "package: @acme/tool", "internal: src/run.ts"].map(
    (surface): SurfaceRow => ({
      name: surface.slice(0, surface.indexOf(":")),
      element: { surface, summary: "Left out.", before: null, after: "x" },
      expected: [...HEAD, "## Specs", "", "### Surfaces", "", "Plans: Surface plan.", ""].join(
        "\n",
      ),
    }),
  ),
];

// --- (c) the title table -----------------------------------------------------

export interface TitleRow {
  readonly title: string;
  readonly expected: string;
}

export const titleRows: ReadonlyArray<TitleRow> = [
  {
    title: "Plain title",
    expected: [...HEAD, "## Specs", "", "### Plain title", "", "Plans: Titled plan.", ""].join(
      "\n",
    ),
  },
  {
    title: "Name — a lede",
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Name",
      "",
      "A lede.",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
  },
  {
    title: "Name — first part — second part",
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Name",
      "",
      "First part — second part.",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
  },
  {
    title: "Name — ends with a full stop.",
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Name",
      "",
      "Ends with a full stop.",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
  },
  {
    title: "Name — is it a question?",
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Name",
      "",
      "Is it a question?",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
  },
  {
    title: "Name — shout it out!",
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Name",
      "",
      "Shout it out!",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
  },
];

// --- (d) the commit table ----------------------------------------------------

export type CommitPlace = "fixes" | "other" | "neither";

export const commitPlaces: ReadonlyArray<{
  readonly subject: string;
  readonly place: CommitPlace;
}> = [
  { subject: "fix: handle the empty range", place: "fixes" },
  { subject: "fix(scope): name the missing tag", place: "fixes" },
  { subject: "fix: keep <tag> and a_b [x] intact", place: "fixes" },
  { subject: "Fix: capital letters count", place: "fixes" },
  { subject: "feat(scope)!: drop the old flag", place: "other" },
  { subject: "perf: read the tags once", place: "other" },
  { subject: "revert: bring back the old banner", place: "other" },
  { subject: "docs: reword the guide", place: "neither" },
  { subject: "test: cover the empty range", place: "neither" },
  { subject: "chore(plans): approve the plan", place: "neither" },
  { subject: "refactor: split the reader", place: "neither" },
  { subject: "style: format the scripts", place: "neither" },
  { subject: "build: bump the compiler", place: "neither" },
  { subject: "ci: fetch the tags", place: "neither" },
  { subject: "wip: half a change", place: "other" },
  { subject: "Tidy things up a little", place: "other" },
];

// The expected line of each subject of `COMMITS`, in the same order; empty for
// a subject the notes leave out.
export const commitLines: ReadonlyArray<string> = [
  "- fix: handle the empty range ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "- fix(scope): name the missing tag ([0202020](https://github.com/acme/tool/commit/0202020202020202020202020202020202020202))",
  "- fix: keep \\<tag\\> and a\\_b \\[x\\] intact ([0303030](https://github.com/acme/tool/commit/0303030303030303030303030303030303030303))",
  "- Fix: capital letters count ([0404040](https://github.com/acme/tool/commit/0404040404040404040404040404040404040404))",
  "- feat(scope)!: drop the old flag ([0505050](https://github.com/acme/tool/commit/0505050505050505050505050505050505050505))",
  "- perf: read the tags once ([0606060](https://github.com/acme/tool/commit/0606060606060606060606060606060606060606))",
  "- revert: bring back the old banner ([0707070](https://github.com/acme/tool/commit/0707070707070707070707070707070707070707))",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "- wip: half a change ([0f0f0f0](https://github.com/acme/tool/commit/0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f))",
  "- Tidy things up a little ([1010101](https://github.com/acme/tool/commit/1010101010101010101010101010101010101010))",
];

// A subject with every character the builder escapes.
export const escapeCommit: ReleaseCommit = {
  hash: "aa".repeat(20),
  subject: "fix: a `b` *c* ~d~ e|f & g\\h <i> [j] k_l",
};

export const escapeExpected = [
  ...HEAD,
  "## Fixes",
  "",
  "- fix: a \\`b\\` \\*c\\* \\~d\\~ e\\|f \\& g\\\\h \\<i\\> \\[j\\] k\\_l ([aaaaaaa](https://github.com/acme/tool/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
  "",
].join("\n");

// --- (e) upgrading -----------------------------------------------------------

export const LAST_ENTRY_UPGRADING = ["# Upgrading", "", "### 4.2.0", "", "- Last one.", ""].join(
  "\n",
);

export const lastEntryExpected = [...HEAD, "## Upgrading", "", "- Last one.", ""].join("\n");

export const LEAVING_UPGRADING = [
  "# Upgrading",
  "",
  "### 4.2.0",
  "",
  "- See [elsewhere](../../x.md).",
  "",
].join("\n");

export const leavingExpected = [
  ...HEAD,
  "## Upgrading",
  "",
  "- See [elsewhere](../../x.md).",
  "",
].join("\n");

export const LEAVING_WARNING =
  "docs/upgrading.md: the link ../../x.md leaves the repository and is kept as written";

// --- (f) intermediate plans --------------------------------------------------

const JOINED_SPEC: ReleaseSpec = {
  path: "docs/specs/archive/2601010001-beta.md",
  title: "Beta spec",
  guidingRule: null,
  surface: [],
};

export const joinedFinal: ReleasePlan = {
  path: "docs/plans/archive/2601010003-beta-final.md",
  title: "Beta final step",
  firstParagraph: "The last step.",
  spec: JOINED_SPEC,
  completesSpec: true,
};

export const joinedFirst: ReleasePlan = {
  path: "docs/plans/archive/2601010004-beta-first.md",
  title: "Beta first step",
  firstParagraph: "The first step.",
  spec: JOINED_SPEC,
  completesSpec: false,
};

export const joinedFirstBeforeExpected = [
  ...HEAD,
  "## Specs",
  "",
  "### Beta spec",
  "",
  "Plans: Beta first step, Beta final step.",
  "",
].join("\n");

export const joinedFirstAfterExpected = [
  ...HEAD,
  "## Specs",
  "",
  "### Beta spec",
  "",
  "Plans: Beta final step, Beta first step.",
  "",
].join("\n");

// --- (g) refusals ------------------------------------------------------------

export const DUPLICATE_SECOND_PLAN: ReleasePlan = {
  ...joinedFinal,
  path: "docs/plans/archive/2601010007-beta-again.md",
  title: "Beta again",
};

export const duplicateMessage =
  "docs/specs/archive/2601010001-beta.md is announced in full twice: docs/plans/archive/2601010003-beta-final.md and docs/plans/archive/2601010007-beta-again.md both say completes-spec: true";

export function placeholderSpec(surface: string, placeholder: string): ReleaseSpec {
  return {
    path: "docs/specs/archive/2601010008-placeholder.md",
    title: "Placeholder spec",
    guidingRule: null,
    surface: [{ surface, summary: placeholder, before: null, after: "x" }],
  };
}

export const placeholderMessage =
  'docs/specs/archive/2601010008-placeholder.json: the surface element "cli: tool run" still has the placeholder summary — write it before the release';

// --- (j) the GitHub body -----------------------------------------------------

const LINK_PARAGRAPH =
  "Read the full notes, with each surface's before and after, on [docs.phax.run/releases/4-2-0](https://docs.phax.run/releases/4-2-0).";

export const noDetailsDocument = [
  ...HEAD,
  "## Fixes",
  "",
  "- fix: one ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "",
].join("\n");

export const noDetailsShort = [
  ...HEAD,
  LINK_PARAGRAPH,
  "",
  "## Fixes",
  "",
  "- fix: one ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "",
].join("\n");

// A fenced `after` that holds a line `</details>`.
export const fencedCloserDocument = [
  ...HEAD,
  "## Specs",
  "",
  "### Fenced",
  "",
  "Plans: Fenced plan.",
  "",
  "`cli: tool run` — You can run it.",
  "",
  "<details>",
  "<summary>After</summary>",
  "",
  "```text",
  "first",
  "</details>",
  "last",
  "```",
  "",
  "</details>",
  "",
  "`file: tool.log` — You read it.",
  "",
].join("\n");

export const fencedCloserShort = [
  ...HEAD,
  LINK_PARAGRAPH,
  "",
  "## Specs",
  "",
  "### Fenced",
  "",
  "Plans: Fenced plan.",
  "",
  "`cli: tool run` — You can run it.",
  "",
  "`file: tool.log` — You read it.",
  "",
].join("\n");

// --- (k) the GitHub body limit -----------------------------------------------

export const GITHUB_BODY_LIMIT = 125000;

// A notes document whose short form is `codePoints` code points long: the
// fixed lines, then one paragraph of emoji (one code point, two UTF-16 units).
export function documentOfShortLength(codePoints: number): string {
  const fixed = [...HEAD, LINK_PARAGRAPH, "", ""].join("\n");
  const fixedLength = [...fixed].length + 1;
  return [...HEAD, "😀".repeat(codePoints - fixedLength), ""].join("\n");
}

export const limitMessage =
  "the GitHub release body of 4.2.0 has 125001 characters, over GitHub's limit of 125000 — shorten the notes";

// --- (h) minimal documents ---------------------------------------------------

export const minimalExpected = HEAD.join("\n");

export const onlyFixCommit: ReleaseCommit = {
  hash: "01".repeat(20),
  subject: "fix: one",
};

export const onlyFixExpected = [
  ...HEAD,
  "## Fixes",
  "",
  "- fix: one ([0101010](https://github.com/acme/tool/commit/0101010101010101010101010101010101010101))",
  "",
].join("\n");

// --- (i) plan paragraph links ------------------------------------------------

export const loosePlanSection = [
  "Adds a `thing` command. See [the spec](https://github.com/acme/tool/blob/v4.2.0/docs/specs/2601010000-made-up.md), [the context](https://github.com/acme/tool/blob/v4.2.0/docs/plans/archive/2601010005-loose-plan.md#context),",
  "[the readme](https://github.com/acme/tool/blob/v4.2.0/README.md#install) and [the docs](https://example.com/docs).",
].join("\n");

// --- (l) spec links ------------------------------------------------------------

// The spec of every row is archived at docs/specs/archive/2601010009-table.md:
// an anchor names that file, a relative destination resolves from docs/specs/,
// where the spec was written.
export interface SpecLinkRow {
  readonly name: string;
  readonly spec: ReleaseSpec;
  readonly expected: string;
  readonly warnings: ReadonlyArray<string>;
}

export const specLinkRows: ReadonlyArray<SpecLinkRow> = [
  {
    name: "the guiding rule",
    spec: {
      ...specNamed("Linked", []),
      guidingRule:
        "Read [the bounds](bounds.md#limits) and [the goal](#goal).\nSee [the readme](/README.md).",
    },
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Linked",
      "",
      "> Read [the bounds](https://github.com/acme/tool/blob/v4.2.0/docs/specs/bounds.md#limits) and [the goal](https://github.com/acme/tool/blob/v4.2.0/docs/specs/archive/2601010009-table.md#goal).",
      "> See [the readme](https://github.com/acme/tool/blob/v4.2.0/README.md).",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
    warnings: [],
  },
  {
    name: "the lede",
    spec: specNamed("Linked — reads [the plan](../plans/2601010009-table-plan.md)", []),
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Linked",
      "",
      "Reads [the plan](https://github.com/acme/tool/blob/v4.2.0/docs/plans/2601010009-table-plan.md).",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
    warnings: [],
  },
  {
    name: "a surface summary",
    spec: specNamed("Linked", [
      {
        surface: "cli: tool run",
        summary:
          "You can run it, see [the context](#context) and [the docs](https://example.com/docs).",
        before: null,
        after: "ran",
      },
    ]),
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Linked",
      "",
      "Plans: Titled plan.",
      "",
      "`cli: tool run` — You can run it, see [the context](https://github.com/acme/tool/blob/v4.2.0/docs/specs/archive/2601010009-table.md#context) and [the docs](https://example.com/docs).",
      "",
      "<details>",
      "<summary>After</summary>",
      "",
      "```text",
      "ran",
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
    warnings: [],
  },
  {
    name: "a link that leaves the repository",
    spec: { ...specNamed("Linked", []), guidingRule: "Never [leave](../../../x.md)." },
    expected: [
      ...HEAD,
      "## Specs",
      "",
      "### Linked",
      "",
      "> Never [leave](../../../x.md).",
      "",
      "Plans: Titled plan.",
      "",
    ].join("\n"),
    warnings: [
      "docs/specs/archive/2601010009-table.md: the link ../../../x.md leaves the repository and is kept as written",
    ],
  },
];
