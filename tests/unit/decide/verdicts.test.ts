import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  bindVerdicts,
  parseVerdictsFile,
  questionFactsOfDocument,
  questionFactsOfHand,
  type GivenVerdict,
  type VerdictsFile,
} from "../../../src/domain/decide/verdicts.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  BOUND_FOLLOW,
  BOUND_HAND_Q1,
  FILE_EMPTY_NOTE,
  FILE_EMPTY_VERDICTS,
  FILE_EXTRA_KEY,
  FILE_NO_NOTE,
  FILE_NO_SCHEMA,
  FILE_NOT_JSON,
  FILE_OTHER_RELEASE,
  FILE_REVERSED,
  FILE_VALID,
  FILE_WRONG_FORMAT,
  HAND_FACTS,
  HAND_NO_QUESTIONS_PARSED,
  HAND_PARSED,
  HAND_Q1_RATIONALE,
  OTHER_RELEASE_URL,
  OTHER_SPEC_PATH,
  PLAN,
  PLAN_FACTS,
  SPEC,
  SPEC_DOCUMENT_URL,
  SPEC_FACTS,
  SPEC_KEEP_DECIDED,
  SPEC_KEEP_DECIDED_FACTS,
  SPEC_PATH,
} from "./verdictsFixtures.js";

// The pure contract of `phax artifact decide --verdicts`, as spec
// artifact-decide-verdicts states it: reading a verdicts file (§5.3), binding
// it to the artifact (§5.4, §5.5) and the order of what it reports. Every
// test is an oracle for the implementation that follows: it is expected to
// fail until then. Assertions are facts (paths and ids), never full wording.

const READ_URL = currentSchemaUrl("decide-verdicts");

function leftOf<A, E>(either: Either.Either<A, E>): E {
  if (Either.isRight(either)) throw new Error("expected a refusal");
  return either.left;
}

function rightOf<A, E>(either: Either.Either<A, E>): A {
  if (Either.isLeft(either))
    throw new Error(`expected a value, got ${JSON.stringify(either.left)}`);
  return either.right;
}

function file(...verdicts: GivenVerdict[]): VerdictsFile {
  return { artifact: SPEC_PATH, verdicts };
}

// A valid verdicts file's text as the decoded file parseVerdictsFile gives.
function fileOf(text: string): VerdictsFile {
  const { artifact, verdicts } = JSON.parse(text) as VerdictsFile;
  return { artifact, verdicts };
}

function bind(given: VerdictsFile) {
  return bindVerdicts({
    file: given,
    artifactPath: SPEC_PATH,
    questions: SPEC_FACTS,
    label: "verdicts.json",
  });
}

describe("parseVerdictsFile", () => {
  it.fails("decodes a valid file without its $schema", () => {
    expect(rightOf(parseVerdictsFile(FILE_VALID))).toEqual({
      artifact: SPEC_PATH,
      verdicts: [
        { question: "q-keep", chosen: "keep-10", note: "Ten logs cover a week of runs." },
        { question: "q-scope", chosen: "per-run", note: null },
      ],
    });
  });

  it.fails("refuses text that is not JSON, at the root", () => {
    expect(leftOf(parseVerdictsFile(FILE_NOT_JSON)).path).toBe("");
  });

  it.fails("refuses a file with no $schema, naming the URL phax reads", () => {
    const refusal = leftOf(parseVerdictsFile(FILE_NO_SCHEMA));
    expect(refusal.path).toBe("$schema");
    expect(refusal.message).toContain(READ_URL);
  });

  it.fails("refuses a $schema naming another format, quoting both URLs", () => {
    const refusal = leftOf(parseVerdictsFile(FILE_WRONG_FORMAT));
    expect(refusal.path).toBe("$schema");
    expect(refusal.message).toContain(SPEC_DOCUMENT_URL);
    expect(refusal.message).toContain(READ_URL);
  });

  it.fails("refuses a $schema naming another release, quoting both URLs", () => {
    const refusal = leftOf(parseVerdictsFile(FILE_OTHER_RELEASE));
    expect(refusal.path).toBe("$schema");
    expect(refusal.message).toContain(OTHER_RELEASE_URL);
    expect(refusal.message).toContain(READ_URL);
  });

  const violations: ReadonlyArray<readonly [string, string, string]> = [
    ["an extra key", FILE_EXTRA_KEY, "reason"],
    ["an empty verdicts list", FILE_EMPTY_VERDICTS, "verdicts[0]"],
    ["a verdict without note", FILE_NO_NOTE, "verdicts[0].note"],
    ["an empty note", FILE_EMPTY_NOTE, "verdicts[0].note"],
  ];

  it.fails.each(violations)(
    "refuses %s at the path of the first violation",
    (_name, text, path) => {
      expect(leftOf(parseVerdictsFile(text)).path).toBe(path);
    },
  );
});

describe("questionFactsOfDocument", () => {
  it.fails("gives a spec's questions in document order", () => {
    expect(questionFactsOfDocument(SPEC)).toEqual(SPEC_FACTS);
  });

  it.fails("gives the open questions, then the arbitrated ones", () => {
    expect(questionFactsOfDocument(SPEC_KEEP_DECIDED)).toEqual(SPEC_KEEP_DECIDED_FACTS);
  });

  it.fails("gives a plan's questions from its preamble", () => {
    expect(questionFactsOfDocument(PLAN)).toEqual(PLAN_FACTS);
  });
});

describe("questionFactsOfHand", () => {
  it.fails("gives the §9 questions with the parser's whole rationale", () => {
    const facts = questionFactsOfHand(HAND_PARSED);
    expect(facts).toEqual(HAND_FACTS);
    expect(facts[0]?.rationale).toBe(HAND_Q1_RATIONALE);
  });

  it.fails("gives nothing for sections that hold no question", () => {
    expect(questionFactsOfHand(HAND_NO_QUESTIONS_PARSED)).toEqual([]);
  });
});

describe("bindVerdicts: the artifact and the questions (§5.4)", () => {
  const refusals: ReadonlyArray<readonly [string, VerdictsFile, readonly string[]]> = [
    [
      "another artifact's path",
      {
        artifact: OTHER_SPEC_PATH,
        verdicts: [{ question: "q-keep", chosen: "keep-10", note: null }],
      },
      [OTHER_SPEC_PATH, SPEC_PATH],
    ],
    [
      "an absolute path to the same artifact",
      {
        artifact: `/work/repo/${SPEC_PATH}`,
        verdicts: [{ question: "q-keep", chosen: "keep-10", note: null }],
      },
      [`/work/repo/${SPEC_PATH}`, SPEC_PATH],
    ],
    [
      "an unknown question",
      file({ question: "q-nine", chosen: "keep-10", note: null }),
      ["q-nine", "q-keep", "q-scope", "q-names"],
    ],
    [
      "a question named twice",
      file(
        { question: "q-keep", chosen: "keep-10", note: null },
        { question: "q-keep", chosen: "keep-20", note: "A fortnight." },
      ),
      ["q-keep"],
    ],
    [
      "a chosen id the question does not list",
      file({ question: "q-keep", chosen: "keep-30", note: null }),
      ["q-keep", "keep-30", "keep-10", "keep-20", "other"],
    ],
  ];

  it.fails.each(refusals)("refuses %s, naming what the caller needs", (_name, given, named) => {
    const message = leftOf(bind(given));
    for (const fact of named) expect(message).toContain(fact);
  });

  it.fails("checks the artifact before the questions", () => {
    const message = leftOf(
      bind({
        artifact: OTHER_SPEC_PATH,
        verdicts: [{ question: "q-nine", chosen: "keep-10", note: null }],
      }),
    );
    expect(message).toContain(OTHER_SPEC_PATH);
    expect(message).not.toContain("q-nine");
  });

  it.fails("checks an unlisted chosen id before a missing note", () => {
    const message = leftOf(bind(file({ question: "q-keep", chosen: "keep-30", note: null })));
    expect(message).toContain("keep-20");
  });
});

describe("bindVerdicts: a departing verdict needs a note (§5.5)", () => {
  const refusals: ReadonlyArray<readonly [string, string]> = [
    ["keep-20, which departs from the recommendation", "keep-20"],
    ["other, which always departs", "other"],
  ];

  it.fails.each(refusals)(
    "refuses %s with a null note, naming the question and its recommendation",
    (_name, chosen) => {
      const message = leftOf(bind(file({ question: "q-keep", chosen, note: null })));
      expect(message).toContain("q-keep");
      expect(message).toContain("keep-10");
    },
  );

  it.fails("accepts a following verdict with a null note", () => {
    const bound = rightOf(bind(file({ question: "q-keep", chosen: "keep-10", note: null })));
    expect(bound.verdicts.map((v) => v.departs)).toEqual([false]);
  });
});

describe("bindVerdicts: what is bound", () => {
  it.fails("binds a note as the why, and the rationale when there is none", () => {
    expect(rightOf(bind(fileOf(FILE_VALID)))).toEqual(BOUND_FOLLOW);
  });

  it.fails("binds other with a note as a departing verdict whose why is the note", () => {
    const bound = rightOf(
      bind(
        file({
          question: "q-names",
          chosen: "other",
          note: "Name each log by its date and its phase.",
        }),
      ),
    );
    expect(bound.verdicts).toEqual([
      {
        question: "q-names",
        state: "open",
        chosen: "other",
        note: "Name each log by its date and its phase.",
        recommendation: "by-date",
        departs: true,
        why: "Name each log by its date and its phase.",
      },
    ]);
  });

  it.fails("lists the open questions the file does not name", () => {
    const bound = rightOf(
      bind(
        file(
          { question: "q-keep", chosen: "keep-10", note: null },
          { question: "q-scope", chosen: "per-run", note: null },
        ),
      ),
    );
    expect(bound.open).toEqual(["q-names"]);
  });

  it.fails("lists no open question when the file names them all", () => {
    const bound = rightOf(
      bind(
        file(
          { question: "q-keep", chosen: "keep-10", note: null },
          { question: "q-scope", chosen: "per-run", note: null },
          { question: "q-names", chosen: "by-date", note: null },
        ),
      ),
    );
    expect(bound.open).toEqual([]);
  });

  it.fails("binds in the artifact's document order, never the file's", () => {
    const bound = rightOf(bind(fileOf(FILE_REVERSED)));
    expect(bound.verdicts.map((v) => v.question)).toEqual(["q-keep", "q-scope"]);
  });

  it.fails("binds an arbitrated question as arbitrated, departing from its recommendation", () => {
    const bound = rightOf(
      bindVerdicts({
        file: file({ question: "q-keep", chosen: "keep-20", note: "A fortnight of runs." }),
        artifactPath: SPEC_PATH,
        questions: SPEC_KEEP_DECIDED_FACTS,
        label: "verdicts.json",
      }),
    );
    expect(bound.verdicts.map((v) => [v.question, v.state, v.departs])).toEqual([
      ["q-keep", "arbitrated", true],
    ]);
    expect(bound.open).toEqual(["q-scope", "q-names"]);
  });

  it.fails("binds a hand-authored question with its whole rationale as the why", () => {
    const bound = rightOf(
      bindVerdicts({
        file: {
          artifact: SPEC_PATH,
          verdicts: [{ question: "Q1", chosen: "keep-10", note: null }],
        },
        artifactPath: SPEC_PATH,
        questions: HAND_FACTS,
        label: "stdin",
      }),
    );
    expect(bound).toEqual(BOUND_HAND_Q1);
  });
});
