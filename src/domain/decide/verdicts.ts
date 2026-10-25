import type { Either } from "effect";
import type { ParsedHandQuestions } from "../artifact/questions.js";
import type { SidecarDocument } from "../artifact/sidecar.js";
import type { ArtifactKind } from "../artifact/status.js";
import type { HandDecisionAnswer } from "../../schemas/handDecisionAnswer.js";
import type { RevisionRefusal } from "./revision.js";

// The pure contract of `phax artifact decide <artifact> --verdicts`: reading a
// verdicts file, binding it to the artifact's questions, and checking the
// writer session's transcription of it. The use case reads the file, spawns
// the session and writes; this module only decides. The types and signatures
// below are frozen by the oracles in tests/unit/decide/verdicts.test.ts and
// tests/unit/decide/transcription.test.ts; the functions are stubs until the
// phase that discharges those oracles implements them.

/** One verdict as the file gives it: the option chosen and the person's note. */
export type GivenVerdict = {
  readonly question: string;
  readonly chosen: string;
  readonly note: string | null;
};

/** A decoded verdicts file, without its `$schema`. */
export type VerdictsFile = {
  readonly artifact: string;
  readonly verdicts: readonly GivenVerdict[];
};

/** Why a verdicts file is refused: a path into the file (`""` at the root) and what is wrong there. */
export type VerdictsRefusal = { readonly path: string; readonly message: string };

/**
 * A verdicts file's text as a decoded file, or the first refusal: text that is
 * not JSON (path `""`), a missing `$schema` (path `$schema`, saying there is
 * none and naming the URL phax reads), a `$schema` naming another format or
 * release than the current `decide-verdicts` stamp (path `$schema`, quoting
 * the URL read and the URL phax reads), or the first decoder violation with
 * its path rendered like `verdicts[0].note`.
 */
export function parseVerdictsFile(_text: string): Either.Either<VerdictsFile, VerdictsRefusal> {
  throw new Error("not implemented: parseVerdictsFile");
}

/**
 * What a verdict is bound against: a question's id, its state, its option
 * ids, its recommendation and its rationale. For a hand-authored artifact,
 * `rationale` is the parser's whole rationale: the Recommendation line's text
 * after `<id> — ` plus its continuation paragraphs, up to the `Decision:`
 * line or the next block, joined with a blank line.
 */
export type QuestionFacts = {
  readonly id: string;
  readonly state: "open" | "arbitrated";
  readonly optionIds: readonly string[];
  readonly recommendation: string;
  readonly rationale: string;
};

/** The questions of a headless document: the open ones, then the arbitrated ones, each in document order. */
export function questionFactsOfDocument(_sidecar: SidecarDocument): readonly QuestionFacts[] {
  throw new Error("not implemented: questionFactsOfDocument");
}

/**
 * The questions of a hand-authored artifact's §9 sections: the open ones, then
 * the arbitrated ones, each in document order. `[]` for sections holding no
 * question; an artifact with no §9 section at all is not parsed and has no
 * facts to give.
 */
export function questionFactsOfHand(_parsed: ParsedHandQuestions): readonly QuestionFacts[] {
  throw new Error("not implemented: questionFactsOfHand");
}

/** A given verdict bound to its question. */
export type BoundVerdict = {
  readonly question: string;
  readonly state: "open" | "arbitrated";
  readonly chosen: string;
  readonly note: string | null;
  readonly recommendation: string;
  /** `chosen` differs from the recommendation; `other` always does. */
  readonly departs: boolean;
  /** The note verbatim, or the question's rationale when the note is null. */
  readonly why: string;
};

/** The verdicts of a file bound to an artifact, and the open questions it leaves out. */
export type BoundVerdicts = {
  /** In the artifact's document order, never the file's. */
  readonly verdicts: readonly BoundVerdict[];
  /** The ids of the open questions the file does not name, in document order. */
  readonly open: readonly string[];
};

/**
 * A verdicts file bound to the artifact's questions, or why it cannot be. The
 * message carries no `Decide refused:` prefix. Checked in this order, and each
 * names:
 * 1. a different artifact: both paths;
 * 2. an unknown question: the artifact's question ids;
 * 3. a question named twice: that id;
 * 4. a chosen id neither listed nor `other`: the question's option ids and `other`;
 * 5. a departing verdict, `other` included, with a null note: the question and its recommendation.
 */
export function bindVerdicts(_input: {
  readonly file: VerdictsFile;
  readonly artifactPath: string;
  readonly questions: readonly QuestionFacts[];
  readonly label: string;
}): Either.Either<BoundVerdicts, string> {
  throw new Error("not implemented: bindVerdicts");
}

/** A verdict as it landed in the document, with who set it. */
export type TranscribedVerdict = {
  readonly question: string;
  readonly chosen: string;
  readonly recommendation: string;
  readonly departs: boolean;
  readonly why: string;
  readonly revised: readonly string[];
  readonly by: { readonly kind: "operator"; readonly name: string };
};

/**
 * A writer's answer for a headless document as a checked document, or the
 * first refusal, with the landed verdicts in document order. Before decoding,
 * phax overwrites `why` (from the bound verdict), `by` and `at` on each named
 * question's verdict and restores a plan's `sourceSpec` and `completesSpec`.
 * The answer is then refused unless it is stamped with the document format's
 * current shape and passes the current-shape decoder (question checks,
 * traceability, a plan verdict's phase), and:
 * - the question set is unchanged;
 * - every named question is arbitrated with a decided verdict whose `chosen`
 *   is the given one, `other` included, and whose `abandoned` is every other
 *   listed option;
 * - every question keeps its id, question, options, recommendation and rationale;
 * - a named question that was open has history `[]`; one that was arbitrated
 *   has its earlier history followed by its previous verdict, even when the
 *   new choice equals the old one;
 * - every unnamed question is unchanged and keeps its place;
 * - cited principles are loaded ids;
 * - a departing verdict names a non-empty `revised`, and a following verdict
 *   has `revised: []`, refused at that verdict's `revised` path;
 * - when no given verdict departs, every field outside the two question
 *   arrays is unchanged.
 */
export function checkTranscription(_input: {
  readonly original: SidecarDocument;
  readonly answer: unknown;
  readonly bound: BoundVerdicts;
  readonly operator: { readonly name: string };
  readonly atIso: string;
  readonly principleIds: ReadonlySet<string>;
}): Either.Either<
  { readonly document: SidecarDocument; readonly verdicts: readonly TranscribedVerdict[] },
  RevisionRefusal
> {
  throw new Error("not implemented: checkTranscription");
}

/**
 * A writer's answer for a hand-authored artifact, checked the same way: its
 * decisions are exactly the named questions, each once; its frontmatter,
 * question sections and decision log are returned unchanged; and when no
 * verdict departs its markdown equals the artifact's. On success `md` is the
 * artifact's Markdown with the decisions written in place (each named block
 * moved to the arbitrated section with its Decision block, one decision-log
 * entry per verdict), and `answer` is the decoded answer with `why`, `by` and
 * `at` set by phax.
 */
export function checkHandTranscription(_input: {
  readonly kind: ArtifactKind;
  readonly md: string;
  readonly parsed: ParsedHandQuestions;
  readonly answer: unknown;
  readonly bound: BoundVerdicts;
  readonly operator: { readonly name: string };
  readonly atIso: string;
  readonly principleIds: ReadonlySet<string>;
  readonly phaseIds: readonly string[];
}): Either.Either<
  {
    readonly answer: HandDecisionAnswer;
    readonly md: string;
    readonly verdicts: readonly TranscribedVerdict[];
  },
  RevisionRefusal
> {
  throw new Error("not implemented: checkHandTranscription");
}
