// The four documents of a declared interactive stop: the first reading and
// the interactive handoff a phase's turns answer, and the interactive session
// and review stop phax writes. Each is born with `$schema`: no pre-schema
// shape, and a document without `$schema` is unreadable. Each refuses a key it
// does not name. The current shape, named by `CURRENT_SHAPES`, is phax's own
// file schema and decoder.
import {
  FirstReadingFileSchema,
  decodeFirstReadingFile,
  type FirstReading,
  type FirstReadingFile,
} from "../../../../src/schemas/firstReading.js";
import {
  InteractiveHandoffFileSchema,
  decodeInteractiveHandoffFile,
  type InteractiveHandoff,
  type InteractiveHandoffFile,
} from "../../../../src/schemas/interactiveHandoff.js";
import {
  InteractiveSessionFileSchema,
  decodeInteractiveSessionFile,
  type InteractiveSession,
  type InteractiveSessionFile,
} from "../../../../src/schemas/interactiveSession.js";
import {
  ReviewStopFileSchema,
  decodeReviewStopFile,
  type ReviewStop,
  type ReviewStopFile,
} from "../../../../src/schemas/reviewStop.js";
import {
  RunListFileSchema,
  decodeRunListFile,
  type RunList,
  type RunListFile,
} from "../../../../src/schemas/runList.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// ── first reading

export type FirstReadingShapes = {
  [K in CurrentShapeName<"first-reading">]: FirstReadingFile;
};

/** The id of every first reading shape the package reads. */
export type FirstReadingShape = keyof FirstReadingShapes;

export const firstReadingFormat = defineFormat<FirstReadingShapes>({
  id: "first-reading",
  label: "first reading",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["first-reading"],
    shape: { schema: FirstReadingFileSchema, decode: decodeFirstReadingFile },
  },
});

/** Reads the answer of a declared interactive phase's first turn. Never throws. */
export const parseFirstReading: (input: unknown) => ParsedShape<FirstReadingShapes> =
  firstReadingFormat.parse;

/** The latest first reading: phax's in-memory value, with no `$schema`. */
export type LatestFirstReading = FirstReading;

/** Upgrades a parsed first reading in memory: drops `$schema`, keeps every other fact. */
export function toLatestFirstReading(value: FirstReadingFile): LatestFirstReading {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── interactive handoff

export type InteractiveHandoffShapes = {
  [K in CurrentShapeName<"interactive-handoff">]: InteractiveHandoffFile;
};

/** The id of every interactive handoff shape the package reads. */
export type InteractiveHandoffShape = keyof InteractiveHandoffShapes;

export const interactiveHandoffFormat = defineFormat<InteractiveHandoffShapes>({
  id: "interactive-handoff",
  label: "interactive handoff",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["interactive-handoff"],
    shape: { schema: InteractiveHandoffFileSchema, decode: decodeInteractiveHandoffFile },
  },
});

/** Reads the answer of a declared interactive phase's closing turn. Never throws. */
export const parseInteractiveHandoff: (input: unknown) => ParsedShape<InteractiveHandoffShapes> =
  interactiveHandoffFormat.parse;

/** The latest interactive handoff: phax's in-memory value, with no `$schema`. */
export type LatestInteractiveHandoff = InteractiveHandoff;

/** Upgrades a parsed interactive handoff in memory: drops `$schema`, keeps every other fact. */
export function toLatestInteractiveHandoff(
  value: InteractiveHandoffFile,
): LatestInteractiveHandoff {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── interactive session

export type InteractiveSessionShapes = {
  [K in CurrentShapeName<"interactive-session">]: InteractiveSessionFile;
};

/** The id of every interactive session shape the package reads. */
export type InteractiveSessionShape = keyof InteractiveSessionShapes;

export const interactiveSessionFormat = defineFormat<InteractiveSessionShapes>({
  id: "interactive-session",
  label: "interactive session",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["interactive-session"],
    shape: { schema: InteractiveSessionFileSchema, decode: decodeInteractiveSessionFile },
  },
});

/** Reads a phase's `interactive-session.json`. Never throws. */
export const parseInteractiveSession: (input: unknown) => ParsedShape<InteractiveSessionShapes> =
  interactiveSessionFormat.parse;

/** The latest interactive session: phax's in-memory value, with no `$schema`. */
export type LatestInteractiveSession = InteractiveSession;

/** Upgrades a parsed interactive session in memory: drops `$schema`, keeps every other fact. */
export function toLatestInteractiveSession(
  value: InteractiveSessionFile,
): LatestInteractiveSession {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── review stop

export type ReviewStopShapes = {
  [K in CurrentShapeName<"review-stop">]: ReviewStopFile;
};

/** The id of every review stop shape the package reads. */
export type ReviewStopShape = keyof ReviewStopShapes;

export const reviewStopFormat = defineFormat<ReviewStopShapes>({
  id: "review-stop",
  label: "review stop",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["review-stop"],
    shape: { schema: ReviewStopFileSchema, decode: decodeReviewStopFile },
  },
});

/** Reads a run's `review-stop.json`. Never throws. */
export const parseReviewStop: (input: unknown) => ParsedShape<ReviewStopShapes> =
  reviewStopFormat.parse;

/** The latest review stop: phax's in-memory value, with no `$schema`. */
export type LatestReviewStop = ReviewStop;

/** Upgrades a parsed review stop in memory: drops `$schema`, keeps every other fact. */
export function toLatestReviewStop(value: ReviewStopFile): LatestReviewStop {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── run list

export type RunListShapes = {
  [K in CurrentShapeName<"run-list">]: RunListFile;
};

/** The id of every run list shape the package reads. */
export type RunListShape = keyof RunListShapes;

export const runListFormat = defineFormat<RunListShapes>({
  id: "run-list",
  label: "run list",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["run-list"],
    shape: { schema: RunListFileSchema, decode: decodeRunListFile },
  },
});

/** Reads what `phax ls --json` printed. Never throws. */
export const parseRunList: (input: unknown) => ParsedShape<RunListShapes> = runListFormat.parse;

/** The latest run list: phax's in-memory value, with no `$schema`. */
export type LatestRunList = RunList;

/** Upgrades a parsed run list in memory: drops `$schema`, keeps every other fact. */
export function toLatestRunList(value: RunListFile): LatestRunList {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}
