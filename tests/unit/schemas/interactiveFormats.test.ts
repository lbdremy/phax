// The four documents of a declared interactive stop (plan
// declared-interactive-stop, phase-01): each is born with `$schema`, has every
// key required, refuses any other key, and has exactly the keys of its
// variant. Fixtures are made up: the invoice-export run, its credit-note
// phase and the session ids.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeFirstReadingFile } from "../../../src/schemas/firstReading.js";
import { decodeInteractiveHandoffFile } from "../../../src/schemas/interactiveHandoff.js";
import { decodeInteractiveSessionFile } from "../../../src/schemas/interactiveSession.js";
import {
  currentSchemaUrl,
  readFirstReadingAnswer,
  readInteractiveHandoffAnswer,
  readInteractiveSessionFile,
  readReviewStopFile,
  withSchemaUrl,
} from "../../../src/schemas/persisted.js";
import { decodeReviewStopFile } from "../../../src/schemas/reviewStop.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const SESSION = "4f6c1a52-0000-4000-8000-000000000001";
const WORKTREE = "/example/worktrees/invoice-export/phase-03";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const AT = "2026-10-22T09:10:00.000Z";

const accepted = (result: Either.Either<unknown, unknown>) => Either.isRight(result);

// ── first reading

const firstReading = {
  pattern: ["Each export row is built by one pure function over the invoice."],
  copiedBy: [{ phase: "phase-02", what: "the credit-note rows copy the row builder" }],
  toCheck: ["Whether the credit-note rows round per line or per invoice."],
};
const stampedFirstReading = (value: object) => withSchemaUrl("first-reading", value);

describe("first-reading", () => {
  it("decodes a valid document, and one with no copiedBy and no toCheck", () => {
    expect(accepted(decodeFirstReadingFile(stampedFirstReading(firstReading)))).toBe(true);
    expect(
      accepted(
        decodeFirstReadingFile(stampedFirstReading({ ...firstReading, copiedBy: [], toCheck: [] })),
      ),
    ).toBe(true);
  });

  it.each([
    ["a missing $schema", firstReading],
    ["an unknown release", { $schema: schemaUrl("registry", "0.17.0"), ...firstReading }],
    ["an unknown key", stampedFirstReading({ ...firstReading, extra: true })],
    ["an empty pattern", stampedFirstReading({ ...firstReading, pattern: [] })],
    ["a blank pattern item", stampedFirstReading({ ...firstReading, pattern: [""] })],
    [
      "a copiedBy phase that is not a phase id",
      stampedFirstReading({ ...firstReading, copiedBy: [{ phase: "two", what: "x" }] }),
    ],
    [
      "a copiedBy item with an unknown key",
      stampedFirstReading({
        ...firstReading,
        copiedBy: [{ phase: "phase-02", what: "x", why: "y" }],
      }),
    ],
  ])("refuses %s", (_name, document) => {
    expect(accepted(decodeFirstReadingFile(document))).toBe(false);
  });

  it("is read as a turn's answer under its own $schema only", () => {
    expect(accepted(readFirstReadingAnswer(stampedFirstReading(firstReading)))).toBe(true);
    const missing = readFirstReadingAnswer(firstReading);
    expect(Either.isLeft(missing) && missing.left.kind).toBe("malformed");
    const other = readFirstReadingAnswer(withSchemaUrl("interactive-handoff", firstReading));
    expect(Either.isLeft(other) && JSON.stringify(other.left)).toContain("interactive-handoff");
    const newer = readFirstReadingAnswer(
      { ...firstReading, $schema: schemaUrl("first-reading", "99.0.0") },
      { current: "0.26.0", running: "0.26.0" },
    );
    expect(Either.isLeft(newer) && newer.left.kind).toBe("newer");
    const older = readFirstReadingAnswer(
      { ...firstReading, $schema: schemaUrl("first-reading", "0.25.0") },
      { current: "0.26.0", running: "0.26.0" },
    );
    expect(Either.isLeft(older) && older.left.kind).toBe("older");
  });
});

// ── interactive handoff

const handoff = {
  corrections: [
    {
      what: "Rounded per line, not per invoice.",
      guard: { kind: "test", ref: "tests/unit/exportRows.test.ts" },
    },
    {
      what: "Renamed the row builder.",
      guard: { kind: "none", reason: "The typechecker guards it." },
    },
  ],
  patternFromNowOn: ["Round each line, then sum."],
  nextPhasesNeedToKnow: [],
};
const stampedHandoff = (value: object) => withSchemaUrl("interactive-handoff", value);

describe("interactive-handoff", () => {
  it.each(["test", "lint", "gate-step"])("decodes a %s guard", (kind) => {
    const document = stampedHandoff({
      ...handoff,
      corrections: [{ what: "x", guard: { kind, ref: "some-ref" } }],
    });
    expect(accepted(decodeInteractiveHandoffFile(document))).toBe(true);
  });

  it("decodes a valid document", () => {
    expect(accepted(decodeInteractiveHandoffFile(stampedHandoff(handoff)))).toBe(true);
  });

  it.each([
    ["a missing $schema", handoff],
    ["an unknown release", { $schema: schemaUrl("review-stop", "0.26.0"), ...handoff }],
    ["an unknown key", stampedHandoff({ ...handoff, extra: true })],
    ["no corrections", stampedHandoff({ ...handoff, corrections: [] })],
    [
      "a none guard without a reason",
      stampedHandoff({ ...handoff, corrections: [{ what: "x", guard: { kind: "none" } }] }),
    ],
    [
      "a none guard with a ref",
      stampedHandoff({
        ...handoff,
        corrections: [{ what: "x", guard: { kind: "none", reason: "r", ref: "t" } }],
      }),
    ],
    [
      "a test guard without a ref",
      stampedHandoff({ ...handoff, corrections: [{ what: "x", guard: { kind: "test" } }] }),
    ],
    [
      "a guard kind outside the enum",
      stampedHandoff({
        ...handoff,
        corrections: [{ what: "x", guard: { kind: "review", ref: "t" } }],
      }),
    ],
    [
      "a correction with an unknown key",
      stampedHandoff({
        ...handoff,
        corrections: [{ what: "x", guard: { kind: "none", reason: "r" }, why: "y" }],
      }),
    ],
    ["a missing patternFromNowOn", stampedHandoff({ ...handoff, patternFromNowOn: undefined })],
  ])("refuses %s", (_name, document) => {
    expect(accepted(decodeInteractiveHandoffFile(document))).toBe(false);
  });

  it("is read as a turn's answer under its own $schema only", () => {
    expect(accepted(readInteractiveHandoffAnswer(stampedHandoff(handoff)))).toBe(true);
    expect(accepted(readInteractiveHandoffAnswer(handoff))).toBe(false);
    expect(accepted(readInteractiveHandoffAnswer(withSchemaUrl("first-reading", handoff)))).toBe(
      false,
    );
  });
});

// ── interactive session

const session = {
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  effort: "medium",
  sessionId: SESSION,
  startedAt: AT,
  origin: "first-turn",
};
const interactiveSession = {
  phaseId: "phase-03",
  provider: "claude-code",
  interactiveResume: "verified",
  current: session,
  history: [],
  firstTurns: [],
  turnInProgress: null,
};
const stampedSession = (value: object) => withSchemaUrl("interactive-session", value);

const answered = {
  outcome: "answered",
  origin: "first-turn",
  startedAt: AT,
  endedAt: AT,
  sessionId: SESSION,
};
const refusedChange = {
  outcome: "refused-change",
  origin: "new-session",
  startedAt: AT,
  endedAt: AT,
  changedPaths: ["src/export.ts"],
  keptAt: "/example/runs/invoice-export/phase-03/refused-turn-01",
};
const failed = {
  outcome: "failed",
  origin: "first-turn",
  startedAt: AT,
  endedAt: AT,
  reason: "rate-limit",
  detail: "The five-hour window is full.",
  resetAt: null,
};

describe("interactive-session", () => {
  it("decodes a valid document with no session yet", () => {
    expect(accepted(decodeInteractiveSessionFile(stampedSession(interactiveSession)))).toBe(true);
    expect(
      accepted(
        decodeInteractiveSessionFile(stampedSession({ ...interactiveSession, current: null })),
      ),
    ).toBe(true);
  });

  it.each([
    ["answered", answered],
    ["refused-change", refusedChange],
    ["failed", failed],
    ["failed with a reset time", { ...failed, reason: "usage-limit", resetAt: AT }],
  ])("decodes a %s first turn with exactly its own keys", (_name, turn) => {
    const document = stampedSession({ ...interactiveSession, firstTurns: [turn] });
    expect(accepted(decodeInteractiveSessionFile(document))).toBe(true);
  });

  it.each([
    ["an answered turn with a failed turn's reason", { ...answered, reason: "rate-limit" }],
    ["an answered turn with changed paths", { ...answered, changedPaths: ["a.ts"] }],
    ["an answered turn without a session id", { ...answered, sessionId: undefined }],
    ["a refused turn with a session id", { ...refusedChange, sessionId: SESSION }],
    ["a refused turn without changed paths", { ...refusedChange, changedPaths: [] }],
    ["a refused turn without keptAt", { ...refusedChange, keptAt: undefined }],
    ["a failed turn with a session id", { ...failed, sessionId: SESSION }],
    ["a failed turn with a reason outside the enum", { ...failed, reason: "crashed" }],
    ["a failed turn without resetAt", { ...failed, resetAt: undefined }],
    ["a turn with an outcome outside the enum", { ...answered, outcome: "skipped" }],
    ["a turn with an origin outside the enum", { ...answered, origin: "builder" }],
  ])("refuses %s", (_name, turn) => {
    const document = stampedSession({ ...interactiveSession, firstTurns: [turn] });
    expect(accepted(decodeInteractiveSessionFile(document))).toBe(false);
  });

  it("decodes turnInProgress both null and set", () => {
    const inProgress = {
      kind: "first-turn",
      turn: 1,
      origin: "first-turn",
      beforeTree: HEAD,
      personHandoffBefore: null,
      startedAt: AT,
    };
    expect(accepted(decodeInteractiveSessionFile(stampedSession(interactiveSession)))).toBe(true);
    for (const turnInProgress of [
      inProgress,
      { ...inProgress, kind: "closing-turn" },
      { ...inProgress, personHandoffBefore: "a".repeat(64) },
    ]) {
      expect(
        accepted(
          decodeInteractiveSessionFile(stampedSession({ ...interactiveSession, turnInProgress })),
        ),
      ).toBe(true);
    }
    expect(
      accepted(
        decodeInteractiveSessionFile(
          stampedSession({
            ...interactiveSession,
            turnInProgress: { ...inProgress, personHandoffBefore: "not-a-digest" },
          }),
        ),
      ),
    ).toBe(false);
    const { kind: _kind, ...noKind } = inProgress;
    for (const turnInProgress of [noKind, { ...inProgress, kind: "fix-turn" }]) {
      expect(
        accepted(
          decodeInteractiveSessionFile(stampedSession({ ...interactiveSession, turnInProgress })),
        ),
      ).toBe(false);
    }
  });

  it.each([
    ["a missing $schema", interactiveSession],
    ["an unknown key", stampedSession({ ...interactiveSession, extra: true })],
    ["a provider outside the enum", stampedSession({ ...interactiveSession, provider: "gpt" })],
    [
      "a session origin outside first-turn and new-session",
      stampedSession({ ...interactiveSession, current: { ...session, origin: "builder" } }),
    ],
    [
      "a session with an unknown key",
      stampedSession({ ...interactiveSession, current: { ...session, cost: 1 } }),
    ],
    [
      "an interactiveResume outside the enum",
      stampedSession({ ...interactiveSession, interactiveResume: "yes" }),
    ],
  ])("refuses %s", (_name, document) => {
    expect(accepted(decodeInteractiveSessionFile(document))).toBe(false);
  });

  it("is read through its bridge reader", () => {
    const read = readInteractiveSessionFile(
      "interactive-session.json",
      stampedSession({ ...interactiveSession, firstTurns: [answered] }),
    );
    expect(Either.getOrThrow(read).firstTurns).toEqual([answered]);
    expect(Either.getOrThrow(read)).not.toHaveProperty("$schema");
    expect(
      Either.isLeft(readInteractiveSessionFile("interactive-session.json", interactiveSession)),
    ).toBe(true);
  });
});

// ── review stop

const command = { cwd: WORKTREE, argv: ["claude", "--resume", SESSION], env: {} };
const reviewStop = {
  run: "example.invoice-export",
  state: "awaiting_review",
  cause: "declared",
  phase: {
    id: "phase-03",
    title: "Export the credit notes",
    mode: "interactive",
    position: 3,
    of: 4,
  },
  firstReading: null,
  worktree: WORKTREE,
  seed: `${WORKTREE}/.phax-context/review-seed.md`,
  session: {
    provider: "claude-code",
    sessionId: SESSION,
    origin: "first-turn",
    interactiveResume: "verified",
  },
  commands: {
    continue: command,
    freshStart: { cwd: WORKTREE, argv: ["claude"], env: { CLAUDE_CODE_EXAMPLE: "1" } },
    enterPhase: {
      cwd: "/example/repo",
      argv: ["phax", "enter-phase", "invoice-export", "phase-03"],
      env: {},
    },
    close: { cwd: "/example/repo", argv: ["phax", "resume", "invoice-export"], env: {} },
    reset: {
      cwd: "/example/repo",
      argv: ["phax", "reset-phase", "invoice-export", "phase-03"],
      env: {},
    },
  },
  lastClose: null,
  closeBase: null,
};
const stampedStop = (value: object) => withSchemaUrl("review-stop", value);

const lastCloses = [
  [
    "gate-failed",
    { result: "gate-failed", at: AT, exitCode: 4, log: "/example/runs/checks-attempt-01.log" },
  ],
  ["worktree-changed", { result: "worktree-changed", at: AT, exitCode: 1, paths: ["src/a.ts"] }],
  [
    "closing-turn-edited",
    { result: "closing-turn-edited", at: AT, exitCode: 5, paths: ["src/a.ts"] },
  ],
  [
    "handoff-invalid",
    { result: "handoff-invalid", at: AT, exitCode: 1, defects: ["corrections is empty"] },
  ],
  [
    "closing-answer-invalid",
    { result: "closing-answer-invalid", at: AT, exitCode: 5, reason: "no $schema" },
  ],
  ["limit", { result: "limit", at: AT, exitCode: 8, resetAt: null }],
  ["limit with a reset time", { result: "limit", at: AT, exitCode: 8, resetAt: AT }],
  [
    "close-error at the closing turn",
    {
      result: "close-error",
      at: AT,
      exitCode: 5,
      step: "closing-turn",
      detail: "provider exited 1",
    },
  ],
  [
    "close-error at the gate",
    { result: "close-error", at: AT, exitCode: 1, step: "gate", detail: "spawn failed" },
  ],
  [
    "close-error at the commit",
    { result: "close-error", at: AT, exitCode: 1, step: "commit", detail: "update-ref failed" },
  ],
  [
    "close-error at the files",
    { result: "close-error", at: AT, exitCode: 1, step: "files", detail: "read failed" },
  ],
  ["interrupted", { result: "interrupted", at: AT, exitCode: 130 }],
] as const;

describe("review-stop", () => {
  it("decodes a valid document, with a first reading and without a continue command", () => {
    expect(accepted(decodeReviewStopFile(stampedStop(reviewStop)))).toBe(true);
    const withoutSession = {
      ...reviewStop,
      firstReading: `${WORKTREE}/../first-reading.md`,
      session: null,
      commands: { ...reviewStop.commands, continue: null },
    };
    expect(accepted(decodeReviewStopFile(stampedStop(withoutSession)))).toBe(true);
  });

  it.each(lastCloses)("decodes a %s lastClose with exactly its own keys", (_name, lastClose) => {
    expect(accepted(decodeReviewStopFile(stampedStop({ ...reviewStop, lastClose })))).toBe(true);
  });

  it("decodes closeBase both null and set", () => {
    expect(accepted(decodeReviewStopFile(stampedStop(reviewStop)))).toBe(true);
    expect(accepted(decodeReviewStopFile(stampedStop({ ...reviewStop, closeBase: HEAD })))).toBe(
      true,
    );
  });

  it.each([
    ["gate-failed with another variant's paths", { ...lastCloses[0][1], paths: ["a.ts"] }],
    ["gate-failed with the wrong exit code", { ...lastCloses[0][1], exitCode: 1 }],
    ["worktree-changed with the wrong exit code", { ...lastCloses[1][1], exitCode: 5 }],
    ["worktree-changed with a log", { ...lastCloses[1][1], log: "x" }],
    ["worktree-changed with no paths", { ...lastCloses[1][1], paths: [] }],
    ["closing-turn-edited with the wrong exit code", { ...lastCloses[2][1], exitCode: 1 }],
    [
      "handoff-invalid with paths instead of defects",
      { result: "handoff-invalid", at: AT, exitCode: 1, paths: ["a"] },
    ],
    ["limit with the wrong exit code", { ...lastCloses[5][1], exitCode: 4 }],
    ["limit without resetAt", { result: "limit", at: AT, exitCode: 8 }],
    ["interrupted with the wrong exit code", { ...lastCloses[11][1], exitCode: 1 }],
    ["a result outside the enum", { result: "gate-error", at: AT, exitCode: 4 }],
    [
      "close-error with a step outside its list",
      { result: "close-error", at: AT, exitCode: 1, step: "resume", detail: "x" },
    ],
    [
      "close-error at the closing turn exiting 1",
      { result: "close-error", at: AT, exitCode: 1, step: "closing-turn", detail: "x" },
    ],
    [
      "close-error at the gate exiting 5",
      { result: "close-error", at: AT, exitCode: 5, step: "gate", detail: "x" },
    ],
  ])("refuses a lastClose of %s", (_name, lastClose) => {
    expect(accepted(decodeReviewStopFile(stampedStop({ ...reviewStop, lastClose })))).toBe(false);
  });

  it("refuses a phaseCommit: the declared variant has no committed phase", () => {
    expect(accepted(decodeReviewStopFile(stampedStop({ ...reviewStop, phaseCommit: HEAD })))).toBe(
      false,
    );
  });

  it.each([
    ["a missing $schema", reviewStop],
    ["an unknown release", { $schema: schemaUrl("first-reading", "0.26.0"), ...reviewStop }],
    ["a cause other than declared", stampedStop({ ...reviewStop, cause: "held" })],
    ["a state other than awaiting_review", stampedStop({ ...reviewStop, state: "running" })],
    [
      "a headless phase",
      stampedStop({ ...reviewStop, phase: { ...reviewStop.phase, mode: "headless" } }),
    ],
    [
      "a missing freshStart",
      stampedStop({ ...reviewStop, commands: { ...reviewStop.commands, freshStart: undefined } }),
    ],
    [
      "an empty argv",
      stampedStop({
        ...reviewStop,
        commands: { ...reviewStop.commands, close: { ...command, argv: [] } },
      }),
    ],
    [
      "a command with an unknown key",
      stampedStop({
        ...reviewStop,
        commands: { ...reviewStop.commands, close: { ...command, shell: true } },
      }),
    ],
    [
      "a session origin outside the enum",
      stampedStop({ ...reviewStop, session: { ...reviewStop.session, origin: "builder" } }),
    ],
    ["an unknown key", stampedStop({ ...reviewStop, extra: true })],
  ])("refuses %s", (_name, document) => {
    expect(accepted(decodeReviewStopFile(document))).toBe(false);
  });

  it("is read through its bridge reader, and writes the current stamp", () => {
    expect(currentSchemaUrl("review-stop")).toBe(stampedStop({}).$schema);
    const read = readReviewStopFile("review-stop.json", stampedStop(reviewStop));
    expect(Either.getOrThrow(read).phase.id).toBe("phase-03");
    expect(Either.getOrThrow(read)).not.toHaveProperty("$schema");
    expect(Either.isLeft(readReviewStopFile("review-stop.json", reviewStop))).toBe(true);
  });
});
