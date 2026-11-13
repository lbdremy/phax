import { Result } from "effect";
import { decodeCurrentDocumentSidecar } from "../../schemas/persisted.js";
import {
  type SidecarDocument,
  artifactBody,
  renderCurrent,
  sameRendering,
} from "../artifact/sidecar.js";
import type { ResolvedArbiter } from "../artifact/arbiter.js";
import {
  type RevisionRefusal,
  answerStampViolation,
  arraysOf,
  firstDifference,
  firstParseIssue,
  isObject,
  refusal,
  sameJson,
} from "../decide/revision.js";

// The pure core of `phax artifact revise` for a headless-authored Draft: how
// a revised answer is read, the freeze on every existing question, the
// no-change judgement and the commit message. The use case spawns the writer
// and writes; this module only decides.

/** A question a revision appended to the open questions. */
export interface AppendedQuestion {
  readonly id: string;
  readonly question: string;
}

/** Who asked for the revision: the operator or a machine and its grant. */
export type RevisionRequester = ResolvedArbiter;

const DECIDE_REMEDY = "a revision never touches a question; decide it with phax artifact decide";

function changed(id: string): string {
  return `the writer changed question ${id} — ${DECIDE_REMEDY}`;
}

/**
 * The first way a revised document changes an existing question, or
 * undefined. Checked in order, with document-relative paths: the kinds agree;
 * `arbitratedQuestions` is equal to the original's by structural JSON
 * equality; `openQuestions` begins with the original's, element for element;
 * each open question after that prefix has an id the artifact did not have.
 */
export function firstQuestionFreezeViolation(
  before: SidecarDocument,
  after: SidecarDocument,
): RevisionRefusal | undefined {
  if (before.kind !== after.kind) {
    return refusal(["kind"], `"${after.kind}" is not the artifact's kind "${before.kind}"`);
  }
  const was = arraysOf(before);
  const now = arraysOf(after);
  const arbitratedPath = [...now.basePath, "arbitratedQuestions"];
  const openPath = [...now.basePath, "openQuestions"];

  // (2) the arbitrated questions, exactly.
  for (const [i, question] of was.arbitratedQuestions.entries()) {
    const found = now.arbitratedQuestions[i];
    if (found === undefined) {
      return refusal(
        arbitratedPath,
        `the writer removed question ${question.id} — ${DECIDE_REMEDY}`,
      );
    }
    if (found.id !== question.id) {
      const moved = now.arbitratedQuestions.some((q) => q.id === question.id);
      return refusal(
        [...arbitratedPath, i, "id"],
        moved
          ? `the writer moved question ${question.id} — a revision never reorders a question`
          : changed(question.id),
      );
    }
    const differs = firstDifference(question, found, []);
    if (differs !== undefined) {
      return refusal([...arbitratedPath, i, ...differs], changed(question.id));
    }
  }
  if (now.arbitratedQuestions.length > was.arbitratedQuestions.length) {
    const extra = now.arbitratedQuestions[was.arbitratedQuestions.length];
    return refusal(
      [...arbitratedPath, was.arbitratedQuestions.length],
      `the writer added question ${extra?.id ?? ""} to arbitratedQuestions — new questions are appended to the open questions only`,
    );
  }

  // (3) the open questions begin with the original's.
  for (const [i, question] of was.openQuestions.entries()) {
    const found = now.openQuestions[i];
    if (found === undefined) {
      return refusal(openPath, `the writer removed question ${question.id} — ${DECIDE_REMEDY}`);
    }
    if (found.id !== question.id) {
      const moved = now.openQuestions.some((q) => q.id === question.id);
      return refusal(
        [...openPath, i, "id"],
        moved
          ? `the writer moved question ${question.id} — a revision never reorders a question; new questions are appended after the existing ones`
          : changed(question.id),
      );
    }
    if (!sameJson(question, found)) {
      const differs = firstDifference(question, found, []) ?? [];
      return refusal([...openPath, i, ...differs], changed(question.id));
    }
  }

  // (4) what follows is new, and its ids are new.
  const seen = new Set([...was.openQuestions, ...was.arbitratedQuestions].map((q) => q.id));
  for (const [i, question] of now.openQuestions.entries()) {
    if (i < was.openQuestions.length) continue;
    if (seen.has(question.id)) {
      return refusal(
        [...openPath, i, "id"],
        `"${question.id}" is already a question of the artifact — a new question takes a new id`,
      );
    }
    seen.add(question.id);
  }
  return undefined;
}

/** The open questions after the original's, in order. */
export function appendedOpenQuestions(
  before: SidecarDocument,
  after: SidecarDocument,
): ReadonlyArray<AppendedQuestion> {
  const start = arraysOf(before).openQuestions.length;
  return arraysOf(after)
    .openQuestions.slice(start)
    .map(({ id, question }) => ({ id, question }));
}

/**
 * Sets a plan's `sourceSpec` and `completesSpec` from the original on an
 * object answer: the lineage is not revised. A spec, or anything that is not
 * an object, is returned as it is. The input is never mutated.
 */
export function restoreLineage(json: unknown, original: SidecarDocument): unknown {
  if (original.kind !== "plan" || !isObject(json)) return json;
  return {
    ...json,
    sourceSpec: original.document.sourceSpec,
    completesSpec: original.document.completesSpec,
  };
}

/** A decoded revised answer and the open questions it appended. */
export interface DecodedRevision {
  readonly document: SidecarDocument;
  readonly newQuestions: ReadonlyArray<AppendedQuestion>;
}

/**
 * A writer's parsed answer as a current-shape document of the original's
 * kind, or the first refusal: the `$schema` stamp, then the current decoder
 * of the kind (a spec's traceability, a plan's checks) over the answer with
 * the plan's lineage restored, then the question freeze.
 */
export function decodeRevisedAnswer(
  json: unknown,
  original: SidecarDocument,
): Result.Result<DecodedRevision, RevisionRefusal> {
  const { kind } = original;
  const stampViolation = answerStampViolation(kind, json);
  if (stampViolation !== undefined) {
    return Result.fail({ path: isObject(json) ? "$schema" : "", message: stampViolation });
  }
  return Result.flatMap(
    Result.mapError(
      decodeCurrentDocumentSidecar(kind, restoreLineage(json, original)),
      firstParseIssue,
    ),
    (document) => {
      const violation = firstQuestionFreezeViolation(original, document);
      return violation === undefined
        ? Result.succeed({ document, newQuestions: appendedOpenQuestions(original, document) })
        : Result.fail(violation);
    },
  );
}

/** Whether the document renders the body the artifact already has. */
export function rendersSameBody(currentMd: string, after: SidecarDocument): boolean {
  return sameRendering(artifactBody(currentMd), renderCurrent(after));
}

/** The `Revised-By` trailer's value. */
export function revisedByTrailer(requester: RevisionRequester): string {
  return requester.kind === "operator"
    ? `operator (${requester.name})`
    : `machine (${requester.grant})`;
}

export interface ReviseCommitInput {
  readonly kind: "spec" | "plan";
  readonly slug: string;
  readonly path: string;
  readonly amendment: string;
  readonly model: string;
  readonly effort: string;
  readonly provider: string;
  readonly requester: RevisionRequester;
  readonly revisionId: string;
}

/** The revision's commit: the amendment verbatim, then the three trailers. */
export function reviseCommitMessage(input: ReviseCommitInput): {
  readonly subject: string;
  readonly body: string;
} {
  const scope = input.kind === "spec" ? "specs" : "plans";
  return {
    subject: `docs(${scope}): revise ${input.slug}`,
    body: [
      `Revised headless (${input.model} / ${input.effort}, ${input.provider}) from this amendment:`,
      "",
      input.amendment.replace(/\s+$/, ""),
      "",
      `Artifact: ${input.path}`,
      `Revised-By: ${revisedByTrailer(input.requester)}`,
      `Revision-Id: ${input.revisionId}`,
    ].join("\n"),
  };
}
