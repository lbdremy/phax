// What a stop adds to a phase's `security.json`: the person's work ran outside
// phax's enforcement, and each first and closing turn phax ran did so with the
// provider's read-only narrowing and no agent commands.
import type { ProviderId } from "../routing/types.js";
import { TURN_STREAM_PATTERN } from "../records/stopArtifacts.js";

export type ReadOnlyNarrowing = "read-only-tools" | "read-only-sandbox";

export interface PhaxTurn {
  /** The turn's name, such as `first-turn-01`. */
  readonly turn: string;
  readonly kind: "first-turn" | "closing-turn";
}

interface StopTurnPosture extends PhaxTurn {
  readonly narrowing: ReadOnlyNarrowing;
  /** A first or closing turn runs with no agent commands. */
  readonly agentCommands: readonly [];
}

export interface StopPosture {
  readonly cause: "declared" | "held";
  readonly personWork: "outside-phax-enforcement";
  readonly turns: readonly StopTurnPosture[];
}

/** How a provider confines a read-only turn. */
export function readOnlyNarrowingOf(provider: ProviderId): ReadOnlyNarrowing {
  switch (provider) {
    case "claude-code":
      return "read-only-tools";
    case "codex-cli":
      return "read-only-sandbox";
    case "mistral-vibe":
      return "read-only-tools";
  }
}

/**
 * Every turn phax ran at a stop, from a phase folder's file names: first turns
 * then closing turns, in number order. A turn's corrective retry stream names
 * the same turn.
 */
export function phaxTurnsOf(names: readonly string[]): readonly PhaxTurn[] {
  const turns = new Map<string, PhaxTurn>();
  for (const name of names) {
    const match = TURN_STREAM_PATTERN.exec(name);
    const kind = match?.[1];
    const number = match?.[2];
    if ((kind !== "first" && kind !== "closing") || number === undefined) continue;
    const turn = `${kind}-turn-${number}`;
    turns.set(turn, { turn, kind: kind === "first" ? "first-turn" : "closing-turn" });
  }
  const ordered = [...turns.values()].toSorted((a, b) => a.turn.localeCompare(b.turn));
  return [
    ...ordered.filter((t) => t.kind === "first-turn"),
    ...ordered.filter((t) => t.kind === "closing-turn"),
  ];
}

/** The `stop` section of a closed stop's security.json. */
export function stopPostureOf(input: {
  readonly cause: "declared" | "held";
  readonly provider: ProviderId;
  readonly names: readonly string[];
}): StopPosture {
  const narrowing = readOnlyNarrowingOf(input.provider);
  return {
    cause: input.cause,
    personWork: "outside-phax-enforcement",
    turns: phaxTurnsOf(input.names).map((turn) => ({ ...turn, narrowing, agentCommands: [] })),
  };
}
