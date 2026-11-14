// A plan path: the schemas built on the pure rule in src/domain/plan/planPath.ts.
// `PlanPath` admits a canonical path only; `PlanPathFromWritten` rewrites a
// rewritable path and refuses an unplannable one. The schemas hold no rule of
// their own. Imports phax's rule and refusal adapter beside `effect`.
import { Schema, SchemaGetter } from "effect";
import { describePlanPathProblem, readPlanPath } from "../domain/plan/planPath.js";
import { refusalMessage } from "./refusal/adapter.js";

const SEGMENT = "(?:[^/\\\\.][^/\\\\]*|\\.[^/\\\\.][^/\\\\]*|\\.\\.[^/\\\\]+)";

/** A pattern without lookaround matching exactly the canonical paths. */
export const PLAN_PATH_PATTERN = `^${SEGMENT}(?:/${SEGMENT})*$`;

const PLAN_PATH_DESCRIPTION =
  "A file path relative to the repository root, in canonical form: `/` separators, no empty, `.` or `..` segment, no leading or trailing `/`, no backslash, e.g. `src/widget.ts`. phax refuses any other spelling, naming the canonical one when it exists.";

/** A canonical plan path; any other spelling is refused, naming its canonical form or reason. */
export const PlanPath = Schema.String.check(
  Schema.makeFilter(
    (written: string) => {
      const reading = readPlanPath(written);
      return reading.kind === "canonical" ? true : describePlanPathProblem(reading);
    },
    {
      description: PLAN_PATH_DESCRIPTION,
      toJsonSchema: () => ({ pattern: PLAN_PATH_PATTERN }),
      ...refusalMessage((actual) => {
        if (typeof actual !== "string") return "a plan path is a string";
        const reading = readPlanPath(actual);
        return reading.kind === "canonical" ? "" : describePlanPathProblem(reading);
      }),
    },
  ),
);

/**
 * Any written path: a rewritable one decodes to its canonical form, an
 * unplannable one reaches `PlanPath` unchanged and is refused with its reason.
 */
export const PlanPathFromWritten = Schema.String.annotate({
  description:
    "A file path relative to the repository root. phax rewrites `./`, empty and `.` segments and resolves `..` segments; it refuses an empty, absolute or directory path, one that leaves the repository, and one with a backslash.",
}).pipe(
  Schema.decodeTo(PlanPath, {
    decode: SchemaGetter.transform((written: string) => {
      const reading = readPlanPath(written);
      return reading.kind === "rewritable" ? reading.canonical : written;
    }),
    encode: SchemaGetter.passthrough(),
  }),
);
