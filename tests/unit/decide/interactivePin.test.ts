import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decideCommitMessage } from "../../../src/app/decideArtifact.js";
import type { SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import { type Doctrine, assembleDoctrine } from "../../../src/domain/decide/doctrine.js";
import { resolveDecideModel } from "../../../src/domain/decide/model.js";
import {
  buildDecidePrompt,
  buildDecideRetryPrompt,
  buildHandbackPrompt,
} from "../../../src/domain/decide/prompt.js";
import type { DecideScope } from "../../../src/domain/decide/revision.js";
import type { OpenQuestion } from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";

// Interactive decide as shipped (spec artifact-decide-verdicts): its prompts,
// its default model rule and its commit attribution stay as they are while
// verdicts mode lands. The fixtures and the doctrine are made up, never the
// bundled skill, so editing a skill moves nothing here. Each prompt is cut
// before its embedded JSON Schema section, which carries
// QUESTION_CHECKS_DESCRIPTION; the schema snapshot tests hold that text.
// No later phase edits this file.

/** The prompt without its closing "… JSON Schema" section: the heading to the end of the text. */
function withoutSchemaBlock(text: string): string {
  const heading = /^## .*JSON Schema$/m.exec(text);
  if (heading === null) throw new Error("no JSON Schema section in the prompt");
  return text.slice(0, heading.index).trimEnd();
}

// The sidecar JSON embeds the current spec-document stamp, which a release moves.
function stable(text: string): string {
  return text.replaceAll(
    schemaUrl("spec-document", CURRENT_STAMPS["spec-document"]),
    "<spec-document url>",
  );
}

function question(id: string): OpenQuestion {
  return {
    id,
    question: `Where do the ${id} logs go?`,
    options: [
      { id: `${id}-keep`, label: "Keep them", abandons: "disk space" },
      { id: `${id}-drop`, label: "Drop them", abandons: "the history" },
    ],
    recommendation: `${id}-keep`,
    rationale: "history is cheap",
  };
}

const DOCUMENT: SpecDocument = {
  kind: "spec",
  title: "Log rotation",
  ground: [],
  context: "Every run writes one log.",
  problem: "Logs pile up.",
  productGoal: { statement: "Keep logs bounded.", guidingRule: "A log is kept while useful." },
  terminology: [],
  requirements: [
    {
      id: "5.1",
      title: "Rotate",
      pattern: "event",
      statement: "WHEN a run ends THE system SHALL rotate its log.",
    },
  ],
  surface: [],
  nonGoals: [],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Logs rotate",
      given: "a finished run",
      when: "its log is rotated",
      // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
      then: "the log directory stays bounded",
      refs: ["5.1"],
    },
  ],
  openQuestions: [question("Q-old"), question("Q-new")],
  arbitratedQuestions: [
    {
      ...question("Q-done"),
      verdict: {
        kind: "decided",
        chosen: "Q-done-drop",
        abandoned: ["Q-done-keep"],
        why: "nobody reads them",
        advocate: "an audit might",
        principles: ["S1"],
        reversibility: "costly",
        by: { kind: "operator", name: "Ada Lovelace" },
        at: "2026-10-01T10:00:00Z",
        revised: ["§5.1"],
      },
      history: [],
    },
  ],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

const SIDECAR: SidecarDocument = { kind: "spec", document: DOCUMENT };

const ARTIFACT_PATH = "docs/specs/2609281200-log-rotation.md";

function doctrine(): Doctrine {
  const assembled = assembleDoctrine({
    skill: {
      name: "phax-decide-spec",
      source: "bundled",
      text: "# Spec doctrine\n\n- `S1` **Adopt the recommendation.**\n- `S2` **Argue the other side.**\n",
    },
    file: { path: "docs/doctrine.md", text: "- `X1` Prefer the cheaper option.\n" },
  });
  if (Either.isLeft(assembled)) throw new Error(assembled.left);
  return assembled.right;
}

// A hand-authored spec: no sidecar, its questions in its §9 sections.
const HAND_SPEC = [
  "---",
  "status: Draft",
  "---",
  "# Log rotation",
  "",
  "## 9. Open questions",
  "",
  "### Q-new — Where do the Q-new logs go?",
  "",
  "- Q-new-keep — Keep them — abandons: disk space",
  "- Q-new-drop — Drop them — abandons: the history",
  "",
  "Recommendation: Q-new-keep — history is cheap",
  "",
].join("\n");

const headlessPrompt = (scope: DecideScope): string =>
  stable(
    withoutSchemaBlock(
      buildDecidePrompt({
        kind: "spec",
        artifactPath: ARTIFACT_PATH,
        doctrine: doctrine(),
        scope,
        authoring: { variant: "headless", document: SIDECAR },
      }),
    ),
  );

const handPrompt = (scope: DecideScope): string =>
  withoutSchemaBlock(
    buildDecidePrompt({
      kind: "spec",
      artifactPath: ARTIFACT_PATH,
      doctrine: doctrine(),
      scope,
      authoring: { variant: "hand", markdown: HAND_SPEC },
    }),
  );

describe("interactive decide, as shipped", () => {
  it("prompts for a headless spec", () => {
    expect(headlessPrompt({ presented: ["Q-new", "Q-old"], reArbitrated: null }))
      .toMatchInlineSnapshot(`
      "# phax artifact decide — spec \`docs/specs/2609281200-log-rotation.md\`

      You facilitate this session, and the operator decides. Propose, argue and ask; never decide in the operator's place.

      Never write a file, and never run a command that changes the repository. phax writes and commits the artifact itself, once the operator accepts the body diff.

      ## 1. Framing first

      Before any question, raise these framing questions with the operator, one at a time, and let the operator correct the framing. Carry every correction into the questions that follow.

      - F1: who consumes this, and what exactly does it read?
      - F2: what persists, and how is it read in a year?
      - F3: how is a thing identified without its location?
      - F4: what can be removed?
      - F5: does the cited doctrine still say what the operator intends?

      ## 2. The questions

      Then present each question below, in this order: Q-new, Q-old. Give its options, what each abandons, and the recommendation; argue the strongest case for an abandoned option before the operator chooses. A question the operator does not decide stays as it is.

      ### Q-new — Where do the Q-new logs go?

      - Q-new-keep — Keep them — abandons: disk space
      - Q-new-drop — Drop them — abandons: the history

      Recommendation: Q-new-keep — history is cheap

      ### Q-old — Where do the Q-old logs go?

      - Q-old-keep — Keep them — abandons: disk space
      - Q-old-drop — Drop them — abandons: the history

      Recommendation: Q-old-keep — history is cheap

      ## 3. Each verdict

      For each verdict the operator gives, gather:

      - chosen: the id of the option chosen;
      - why: the reason, in the operator's terms;
      - advocate: the strongest case for an abandoned option;
      - principles: the doctrine principle ids the verdict rests on, only ids the doctrine below defines (S1, S2, X1);
      - reversibility: cheap, costly or irreversible — the cost of undoing the verdict;
      - revised: the body sections the verdict changed, or none.

      ## 4. Departures revise the body

      When a verdict departs from the recommendation, propose the body revisions it implies (requirements, surface, acceptance criteria, planning note), agree them with the operator, and name each revised section in \`revised\`. A verdict that follows the recommendation changes no other part of the document unless the operator asks.

      ## 5. Ending the session

      When the operator is done, tell them to exit the session. phax then resumes it and asks for the revised document; do not return it before.

      ## Doctrine

      # Spec doctrine

      - \`S1\` **Adopt the recommendation.**
      - \`S2\` **Argue the other side.**

      ## Project doctrine (docs/doctrine.md)

      - \`X1\` Prefer the cheaper option.

      ## The spec document (sidecar of \`docs/specs/2609281200-log-rotation.md\`)

      \`\`\`json
      {
        "$schema": "<spec-document url>",
        "kind": "spec",
        "title": "Log rotation",
        "ground": [],
        "context": "Every run writes one log.",
        "problem": "Logs pile up.",
        "productGoal": {
          "statement": "Keep logs bounded.",
          "guidingRule": "A log is kept while useful."
        },
        "terminology": [],
        "requirements": [
          {
            "id": "5.1",
            "title": "Rotate",
            "pattern": "event",
            "statement": "WHEN a run ends THE system SHALL rotate its log."
          }
        ],
        "surface": [],
        "nonGoals": [],
        "acceptanceCriteria": [
          {
            "id": "AC-1",
            "name": "Logs rotate",
            "given": "a finished run",
            "when": "its log is rotated",
            "then": "the log directory stays bounded",
            "refs": [
              "5.1"
            ]
          }
        ],
        "openQuestions": [
          {
            "id": "Q-old",
            "question": "Where do the Q-old logs go?",
            "options": [
              {
                "id": "Q-old-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-old-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-old-keep",
            "rationale": "history is cheap"
          },
          {
            "id": "Q-new",
            "question": "Where do the Q-new logs go?",
            "options": [
              {
                "id": "Q-new-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-new-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-new-keep",
            "rationale": "history is cheap"
          }
        ],
        "arbitratedQuestions": [
          {
            "id": "Q-done",
            "question": "Where do the Q-done logs go?",
            "options": [
              {
                "id": "Q-done-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-done-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-done-keep",
            "rationale": "history is cheap",
            "verdict": {
              "kind": "decided",
              "chosen": "Q-done-drop",
              "abandoned": [
                "Q-done-keep"
              ],
              "why": "nobody reads them",
              "advocate": "an audit might",
              "principles": [
                "S1"
              ],
              "reversibility": "costly",
              "by": {
                "kind": "operator",
                "name": "Ada Lovelace"
              },
              "at": "2026-10-01T10:00:00Z",
              "revised": [
                "§5.1"
              ]
            },
            "history": []
          }
        ],
        "planningNote": {
          "settled": [],
          "open": [],
          "constraints": []
        },
        "docsPage": {
          "kind": "none",
          "why": "the CLI reference covers it"
        }
      }
      \`\`\`"
    `);
    expect(headlessPrompt({ presented: ["Q-done"], reArbitrated: "Q-done" }))
      .toMatchInlineSnapshot(`
      "# phax artifact decide — spec \`docs/specs/2609281200-log-rotation.md\`

      You facilitate this session, and the operator decides. Propose, argue and ask; never decide in the operator's place.

      Never write a file, and never run a command that changes the repository. phax writes and commits the artifact itself, once the operator accepts the body diff.

      ## 1. Framing first

      Before any question, raise these framing questions with the operator, one at a time, and let the operator correct the framing. Carry every correction into the questions that follow.

      - F1: who consumes this, and what exactly does it read?
      - F2: what persists, and how is it read in a year?
      - F3: how is a thing identified without its location?
      - F4: what can be removed?
      - F5: does the cited doctrine still say what the operator intends?

      ## 2. The questions

      Then present each question below, in this order: Q-done. Give its options, what each abandons, and the recommendation; argue the strongest case for an abandoned option before the operator chooses. A question the operator does not decide stays as it is.

      ### Q-done — Where do the Q-done logs go?

      - Q-done-keep — Keep them — abandons: disk space
      - Q-done-drop — Drop them — abandons: the history

      Recommendation: Q-done-keep — history is cheap

      Current verdict (decided, by the operator (Ada Lovelace), at 2026-10-01T10:00:00Z): Q-done-drop — nobody reads them

      This question is being re-arbitrated: a new verdict replaces this one, which phax keeps in its history.

      ## 3. Each verdict

      For each verdict the operator gives, gather:

      - chosen: the id of the option chosen;
      - why: the reason, in the operator's terms;
      - advocate: the strongest case for an abandoned option;
      - principles: the doctrine principle ids the verdict rests on, only ids the doctrine below defines (S1, S2, X1);
      - reversibility: cheap, costly or irreversible — the cost of undoing the verdict;
      - revised: the body sections the verdict changed, or none.

      ## 4. Departures revise the body

      When a verdict departs from the recommendation, propose the body revisions it implies (requirements, surface, acceptance criteria, planning note), agree them with the operator, and name each revised section in \`revised\`. A verdict that follows the recommendation changes no other part of the document unless the operator asks.

      ## 5. Ending the session

      When the operator is done, tell them to exit the session. phax then resumes it and asks for the revised document; do not return it before.

      ## Doctrine

      # Spec doctrine

      - \`S1\` **Adopt the recommendation.**
      - \`S2\` **Argue the other side.**

      ## Project doctrine (docs/doctrine.md)

      - \`X1\` Prefer the cheaper option.

      ## The spec document (sidecar of \`docs/specs/2609281200-log-rotation.md\`)

      \`\`\`json
      {
        "$schema": "<spec-document url>",
        "kind": "spec",
        "title": "Log rotation",
        "ground": [],
        "context": "Every run writes one log.",
        "problem": "Logs pile up.",
        "productGoal": {
          "statement": "Keep logs bounded.",
          "guidingRule": "A log is kept while useful."
        },
        "terminology": [],
        "requirements": [
          {
            "id": "5.1",
            "title": "Rotate",
            "pattern": "event",
            "statement": "WHEN a run ends THE system SHALL rotate its log."
          }
        ],
        "surface": [],
        "nonGoals": [],
        "acceptanceCriteria": [
          {
            "id": "AC-1",
            "name": "Logs rotate",
            "given": "a finished run",
            "when": "its log is rotated",
            "then": "the log directory stays bounded",
            "refs": [
              "5.1"
            ]
          }
        ],
        "openQuestions": [
          {
            "id": "Q-old",
            "question": "Where do the Q-old logs go?",
            "options": [
              {
                "id": "Q-old-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-old-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-old-keep",
            "rationale": "history is cheap"
          },
          {
            "id": "Q-new",
            "question": "Where do the Q-new logs go?",
            "options": [
              {
                "id": "Q-new-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-new-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-new-keep",
            "rationale": "history is cheap"
          }
        ],
        "arbitratedQuestions": [
          {
            "id": "Q-done",
            "question": "Where do the Q-done logs go?",
            "options": [
              {
                "id": "Q-done-keep",
                "label": "Keep them",
                "abandons": "disk space"
              },
              {
                "id": "Q-done-drop",
                "label": "Drop them",
                "abandons": "the history"
              }
            ],
            "recommendation": "Q-done-keep",
            "rationale": "history is cheap",
            "verdict": {
              "kind": "decided",
              "chosen": "Q-done-drop",
              "abandoned": [
                "Q-done-keep"
              ],
              "why": "nobody reads them",
              "advocate": "an audit might",
              "principles": [
                "S1"
              ],
              "reversibility": "costly",
              "by": {
                "kind": "operator",
                "name": "Ada Lovelace"
              },
              "at": "2026-10-01T10:00:00Z",
              "revised": [
                "§5.1"
              ]
            },
            "history": []
          }
        ],
        "planningNote": {
          "settled": [],
          "open": [],
          "constraints": []
        },
        "docsPage": {
          "kind": "none",
          "why": "the CLI reference covers it"
        }
      }
      \`\`\`"
    `);
  });

  it("prompts for a hand-authored spec", () => {
    expect(handPrompt({ presented: ["Q-new"], reArbitrated: null })).toMatchInlineSnapshot(`
      "# phax artifact decide — spec \`docs/specs/2609281200-log-rotation.md\`

      You facilitate this session, and the operator decides. Propose, argue and ask; never decide in the operator's place.

      Never write a file, and never run a command that changes the repository. phax writes and commits the artifact itself, once the operator accepts the body diff.

      ## 1. Framing first

      Before any question, raise these framing questions with the operator, one at a time, and let the operator correct the framing. Carry every correction into the questions that follow.

      - F1: who consumes this, and what exactly does it read?
      - F2: what persists, and how is it read in a year?
      - F3: how is a thing identified without its location?
      - F4: what can be removed?
      - F5: does the cited doctrine still say what the operator intends?

      ## 2. The questions

      Then present each question below, in this order: Q-new. Give its options, what each abandons, and the recommendation; argue the strongest case for an abandoned option before the operator chooses. A question the operator does not decide stays as it is.

      - Q-new — under \`### Q-new — …\` in the artifact below.

      ## 3. Each verdict

      For each verdict the operator gives, gather:

      - chosen: the id of the option chosen;
      - why: the reason, in the operator's terms;
      - advocate: the strongest case for an abandoned option;
      - principles: the doctrine principle ids the verdict rests on, only ids the doctrine below defines (S1, S2, X1);
      - reversibility: cheap, costly or irreversible — the cost of undoing the verdict;
      - revised: the body sections the verdict changed, or none.

      ## 4. Departures revise the body

      When a verdict departs from the recommendation, propose the body revisions it implies (requirements, surface, acceptance criteria, planning note), agree them with the operator, and name each revised section in \`revised\`. A verdict that follows the recommendation changes no other part of the document unless the operator asks.

      ## 5. Ending the session

      When the operator is done, tell them to exit the session. phax then resumes it and asks for the revised document; do not return it before.

      ## Doctrine

      # Spec doctrine

      - \`S1\` **Adopt the recommendation.**
      - \`S2\` **Argue the other side.**

      ## Project doctrine (docs/doctrine.md)

      - \`X1\` Prefer the cheaper option.

      ## The spec artifact (\`docs/specs/2609281200-log-rotation.md\`, hand-authored)

      It has no sidecar: its questions are its \`## 9. Open questions\`, \`## 9b. Arbitrated questions\` and \`## 12. Decision log\` sections, which phax writes itself.

      \`\`\`markdown
      ---
      status: Draft
      ---
      # Log rotation

      ## 9. Open questions

      ### Q-new — Where do the Q-new logs go?

      - Q-new-keep — Keep them — abandons: disk space
      - Q-new-drop — Drop them — abandons: the history

      Recommendation: Q-new-keep — history is cheap
      \`\`\`"
    `);
  });

  it("hands back for both variants", () => {
    const url = "https://example.test/schemas/answer/1.0.0.json";
    expect(buildHandbackPrompt({ kind: "spec", variant: "headless", schemaUrl: url }))
      .toMatchInlineSnapshot(`
      "The operator has ended the decide session.

      Return now, as your final message alone, the artifact's whole revised spec document in its sidecar form: one JSON object valid against the revised spec document JSON Schema you were given, with \`$schema\` first, set to \`https://example.test/schemas/answer/1.0.0.json\`. No code fence, no Markdown, no commentary before or after the JSON.

      - Move each question the operator decided in this session from \`openQuestions\` to \`arbitratedQuestions\`, keeping every field it had, with a \`decided\` verdict and \`history: []\`.
      - A re-arbitrated question keeps its place; its new verdict replaces the current one, which moves to the end of its \`history\`.
      - Revise the body as the verdicts imply, and name the revised sections in each verdict's \`revised\`.
      - phax sets each verdict's \`by\` and \`at\`.
      - Leave every other question exactly as it was.
      - When nothing was decided, return the document unchanged.
      "
    `);
    expect(buildHandbackPrompt({ kind: "spec", variant: "hand", schemaUrl: url }))
      .toMatchInlineSnapshot(`
      "The operator has ended the decide session.

      Return now, as your final message alone, one JSON object valid against the hand decision answer JSON Schema you were given, with \`$schema\` first, set to \`https://example.test/schemas/answer/1.0.0.json\`. No code fence, no Markdown, no commentary before or after the JSON.

      - \`kind\`: \`spec\`.
      - \`decisions\`: one \`{ id, verdict }\` per question the operator decided in this session, with a \`decided\` verdict; \`[]\` when nothing was decided.
      - \`markdown\`: the artifact's whole revised Markdown. Leave its frontmatter, its \`## 9. Open questions\`, \`## 9b. Arbitrated questions\` and \`## 12. Decision log\` sections exactly as they were: phax moves each decided question, writes its Decision block and appends to the decision log itself.
      - Revise the body only as the verdicts imply, and name the revised sections in each verdict's \`revised\`.
      - phax sets each verdict's \`by\` and \`at\`.
      - When nothing was decided, return the Markdown unchanged.
      "
    `);
    expect(buildHandbackPrompt({ kind: "plan", variant: "hand", schemaUrl: url }))
      .toMatchInlineSnapshot(`
      "The operator has ended the decide session.

      Return now, as your final message alone, one JSON object valid against the hand decision answer JSON Schema you were given, with \`$schema\` first, set to \`https://example.test/schemas/answer/1.0.0.json\`. No code fence, no Markdown, no commentary before or after the JSON.

      - \`kind\`: \`plan\`.
      - \`decisions\`: one \`{ id, verdict }\` per question the operator decided in this session, with a \`decided\` verdict naming its \`phase\`; \`[]\` when nothing was decided.
      - \`markdown\`: the artifact's whole revised Markdown. Leave its frontmatter, its \`## Open questions\`, \`## Arbitrated questions\` and \`## Decision log\` sections exactly as they were: phax moves each decided question, writes its Decision block and appends to the decision log itself.
      - Revise the body only as the verdicts imply, and name the revised sections in each verdict's \`revised\`.
      - phax sets each verdict's \`by\` and \`at\`.
      - When nothing was decided, return the Markdown unchanged.
      "
    `);
  });

  it("retries for both variants", () => {
    expect(buildDecideRetryPrompt("headless", "openQuestions[0]: made-up refusal"))
      .toMatchInlineSnapshot(`
      "Your revised document was refused, and phax wrote nothing.

      Refusal: openQuestions[0]: made-up refusal

      Return the whole revised document again as your final message: one JSON object valid against the schema you were given, \`$schema\` first, with no code fence and no commentary. This is your only retry.
      "
    `);
    expect(buildDecideRetryPrompt("hand", "decisions[0]: made-up refusal")).toMatchInlineSnapshot(`
      "Your hand decision answer was refused, and phax wrote nothing.

      Refusal: decisions[0]: made-up refusal

      Return the whole hand decision answer again as your final message — its \`kind\`, its \`decisions\` and the artifact's whole revised \`markdown\`: one JSON object valid against the schema you were given, \`$schema\` first, with no code fence and no commentary. This is your only retry.
      "
    `);
  });

  it("defaults the model to claude-opus-5-5 / high from the catalog", () => {
    expect(resolveDecideModel(undefined, undefined)).toEqual(
      Either.right({
        model: "claude-opus-5-5",
        effort: "high",
        modelSource: "catalog default",
        effortSource: "catalog default",
      }),
    );
  });

  it("refuses a model outside Claude Code, naming Claude Code", () => {
    const refused = resolveDecideModel("gpt-6-luna", undefined);
    expect(Either.isLeft(refused)).toBe(true);
    if (Either.isLeft(refused)) {
      expect(refused.left).toContain("gpt-6-luna");
      expect(refused.left).toContain("Claude Code");
    }
  });

  it("commits as an interactive decide, with no Decided-Via", () => {
    const { subject, body } = decideCommitMessage({
      kind: "spec",
      slug: "log-rotation",
      path: ARTIFACT_PATH,
      decided: ["Q-new", "Q-old"],
      model: "claude-opus-5-5",
      effort: "high",
      operator: "Ada Lovelace",
      decisionId: "2609281200-log-rotation/01",
    });
    expect(subject).toBe("docs(specs): decide log-rotation Q-new, Q-old");
    expect(body).toMatchInlineSnapshot(`
      "Decided in an interactive session (claude-opus-5-5 / high).

      Artifact: docs/specs/2609281200-log-rotation.md
      Decided-By: operator (Ada Lovelace)
      Decision-Id: 2609281200-log-rotation/01"
    `);
    expect(body).not.toContain("Decided-Via");
  });
});
