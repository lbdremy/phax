import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildDeclaredReviewStop,
  buildHeldReviewStop,
  type DeclaredReviewStopInput,
  type HeldReviewStopInput,
} from "../../../src/domain/interactive/reviewStop.js";
import { decodeReviewStopFile, type ReviewStopCommand } from "../../../src/schemas/reviewStop.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const worktree = "/Users/ada/.phax/worktrees/invoice-export/phase-03";
const continueCommand: ReviewStopCommand = {
  cwd: worktree,
  argv: ["codex", "resume", "019a2f6e-0000", "-m", "gpt-6-luna"],
  env: {},
};
const freshStart: ReviewStopCommand = {
  cwd: worktree,
  argv: [
    "codex",
    "-m",
    "gpt-6-luna",
    "Read .phax-context/interactive-review.md, then review phase-03 with me.",
  ],
  env: {},
};

const input: DeclaredReviewStopInput = {
  run: "acme.invoice-export",
  phase: { id: "phase-03", title: "Review the export record", position: 3, of: 6 },
  worktree,
  mainCheckout: "/Users/ada/code/acme",
  seed: `${worktree}/.phax-context/interactive-review.md`,
  firstReading: "/Users/ada/.phax/runs/invoice-export/phase-03/first-reading.md",
  session: { provider: "codex-cli", sessionId: "019a2f6e-0000", origin: "first-turn" },
  interactiveResume: "verified",
  continueCommand,
  freshStart,
  lastClose: null,
};

describe("buildDeclaredReviewStop", () => {
  it("builds the declared stop with the continue command and no closeBase", () => {
    const stop = buildDeclaredReviewStop(input);
    expect(stop).toMatchObject({
      run: "acme.invoice-export",
      state: "awaiting_review",
      cause: "declared",
      phase: { id: "phase-03", mode: "interactive", position: 3, of: 6 },
      firstReading: input.firstReading,
      worktree,
      session: {
        provider: "codex-cli",
        sessionId: "019a2f6e-0000",
        origin: "first-turn",
        interactiveResume: "verified",
      },
      lastClose: null,
      closeBase: null,
    });
    expect(stop.commands.continue).toEqual(continueCommand);
    expect(stop.commands.freshStart).toEqual(freshStart);
  });

  it("sets enterPhase, close and reset to phax argv run from the main checkout", () => {
    const { commands } = buildDeclaredReviewStop(input);
    const main = "/Users/ada/code/acme";
    expect(commands.enterPhase).toEqual({
      cwd: main,
      argv: ["phax", "enter-phase", "acme.invoice-export", "phase-03"],
      env: {},
    });
    expect(commands.close).toEqual({
      cwd: main,
      argv: ["phax", "resume", "acme.invoice-export"],
      env: {},
    });
    expect(commands.reset).toEqual({
      cwd: main,
      argv: ["phax", "reset-phase", "acme.invoice-export", "phase-03"],
      env: {},
    });
  });

  it("has no continue command and no session when no first turn answered", () => {
    const stop = buildDeclaredReviewStop({
      ...input,
      session: null,
      firstReading: null,
      continueCommand: null,
    });
    expect(stop.session).toBeNull();
    expect(stop.firstReading).toBeNull();
    expect(stop.commands.continue).toBeNull();
    expect(stop.commands.freshStart).toEqual(freshStart);
  });

  it("has no continue command when the provider's interactive resume is unverified", () => {
    const stop = buildDeclaredReviewStop({
      ...input,
      session: { provider: "mistral-vibe", sessionId: "v-1", origin: "new-session" },
      interactiveResume: "unverified",
    });
    expect(stop.commands.continue).toBeNull();
    expect(stop.session?.interactiveResume).toBe("unverified");
  });

  it("has no continue command with a session but no command to carry", () => {
    expect(
      buildDeclaredReviewStop({ ...input, continueCommand: null }).commands.continue,
    ).toBeNull();
  });

  it("carries lastClose through", () => {
    const lastClose = {
      result: "interrupted",
      at: "2026-10-22T09:00:00.000Z",
      exitCode: 130,
    } as const;
    expect(buildDeclaredReviewStop({ ...input, lastClose }).lastClose).toEqual(lastClose);
  });

  it("is a document the review-stop schema accepts once stamped", () => {
    const stop = buildDeclaredReviewStop(input);
    const decoded = decodeReviewStopFile({ $schema: schemaUrl("review-stop", "1.2.3"), ...stop });
    expect(Either.isRight(decoded)).toBe(true);
  });
});

const heldWorktree = "/Users/ada/.phax/worktrees/invoice-export/phase-02";
const C2 = "5d6e7f8c0a91b2e4f6d8a0c2e4f6a8b0c2d4e6f8";
const heldContinue: ReviewStopCommand = {
  cwd: heldWorktree,
  argv: ["codex", "resume", "X0", "-m", "gpt-6-luna"],
  env: {},
};
const heldFreshStart: ReviewStopCommand = {
  cwd: heldWorktree,
  argv: ["codex", "-m", "gpt-6-luna", "Read .phax-context/interactive-review.md"],
  env: {},
};

const heldInput: HeldReviewStopInput = {
  run: "acme.invoice-export",
  phase: { id: "phase-02", title: "Invoice CSV record", position: 2, of: 6 },
  phaseCommit: C2,
  worktree: heldWorktree,
  mainCheckout: "/Users/ada/code/acme",
  seed: `${heldWorktree}/.phax-context/interactive-review.md`,
  session: { provider: "codex-cli", sessionId: "X0", origin: "builder" },
  interactiveResume: "verified",
  continueCommand: heldContinue,
  freshStart: heldFreshStart,
};

describe("buildHeldReviewStop", () => {
  it.each([
    {
      name: "a builder session on a verified provider",
      overrides: {},
      continue: heldContinue,
    },
    {
      name: "no session",
      overrides: { session: null },
      continue: null,
    },
    {
      name: "a session on an unverified provider",
      overrides: {
        session: { provider: "mistral-vibe", sessionId: "v-1", origin: "builder" },
        interactiveResume: "unverified",
      },
      continue: null,
    },
  ] as const)("$name → continue $continue.argv", ({ overrides, continue: expected }) => {
    const stop = buildHeldReviewStop({ ...heldInput, ...overrides });
    expect(stop.commands.continue).toEqual(expected);
    expect(stop.commands.freshStart).toEqual(heldFreshStart);
  });

  it("is the held variant: a headless phase, its commit, the builder session, nothing closed", () => {
    expect(buildHeldReviewStop(heldInput)).toEqual({
      run: "acme.invoice-export",
      state: "awaiting_review",
      cause: "held",
      phase: { id: "phase-02", title: "Invoice CSV record", mode: "headless", position: 2, of: 6 },
      phaseCommit: C2,
      worktree: heldWorktree,
      seed: `${heldWorktree}/.phax-context/interactive-review.md`,
      session: {
        provider: "codex-cli",
        sessionId: "X0",
        origin: "builder",
        interactiveResume: "verified",
      },
      commands: {
        continue: heldContinue,
        freshStart: heldFreshStart,
        enterPhase: {
          cwd: "/Users/ada/code/acme",
          argv: ["phax", "enter-phase", "acme.invoice-export", "phase-02"],
          env: {},
        },
        close: {
          cwd: "/Users/ada/code/acme",
          argv: ["phax", "resume", "acme.invoice-export"],
          env: {},
        },
        reset: {
          cwd: "/Users/ada/code/acme",
          argv: ["phax", "reset-phase", "acme.invoice-export", "phase-02"],
          env: {},
        },
      },
      lastClose: null,
      closeBase: null,
    });
  });

  it("is a document the review-stop schema accepts once stamped, as the held variant", () => {
    const stop = buildHeldReviewStop({ ...heldInput, session: null });
    const decoded = decodeReviewStopFile({ $schema: schemaUrl("review-stop", "1.2.3"), ...stop });
    if (Either.isLeft(decoded)) throw new Error(String(decoded.left));
    expect(decoded.right.cause).toBe("held");
  });
});
