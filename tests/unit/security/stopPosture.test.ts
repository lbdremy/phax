import { describe, expect, it } from "vitest";
import {
  phaxTurnsOf,
  readOnlyNarrowingOf,
  stopPostureOf,
} from "../../../src/domain/security/stopPosture.js";

describe("readOnlyNarrowingOf", () => {
  it.each([
    ["claude-code", "read-only-tools"],
    ["codex-cli", "read-only-sandbox"],
    ["mistral-vibe", "read-only-tools"],
  ] as const)("%s runs a read-only turn with %s", (provider, narrowing) => {
    expect(readOnlyNarrowingOf(provider)).toBe(narrowing);
  });
});

const first = (n: string) => ({ turn: `first-turn-${n}`, kind: "first-turn" });
const closing = (n: string) => ({ turn: `closing-turn-${n}`, kind: "closing-turn" });

describe("phaxTurnsOf", () => {
  it.each([
    ["a folder with no stop's stream", ["status.json", "output.jsonl", "security.json"], []],
    [
      "first turns, then closing turns, whatever the listing order",
      ["closing-turn-01.jsonl", "first-turn-02.jsonl", "first-turn-01.jsonl"],
      [first("01"), first("02"), closing("01")],
    ],
    [
      "a retry stream names the turn it retries, once",
      ["first-turn-01.jsonl", "first-turn-01-retry.jsonl", "closing-turn-01-retry.jsonl"],
      [first("01"), closing("01")],
    ],
    ["a retry whose first stream is missing", ["first-turn-03-retry.jsonl"], [first("03")]],
    [
      "files that look alike but are not streams",
      [
        "first-turn-01-correction-handoff.md",
        "closing-turn-1.jsonl",
        "first-turn-01.json",
        "refused-turn-01",
        "interactive-transcripts",
      ],
      [],
    ],
  ])("%s", (_label, names, expected) => {
    expect(phaxTurnsOf(names)).toEqual(expected);
  });
});

describe("stopPostureOf", () => {
  const names = ["first-turn-01.jsonl", "closing-turn-01.jsonl", "output.jsonl"];

  it.each([
    ["claude-code", "read-only-tools"],
    ["codex-cli", "read-only-sandbox"],
    ["mistral-vibe", "read-only-tools"],
  ] as const)("a held stop on %s: every turn %s and no agent command", (provider, narrowing) => {
    expect(stopPostureOf({ cause: "held", provider, names })).toEqual({
      cause: "held",
      personWork: "outside-phax-enforcement",
      turns: [
        { turn: "first-turn-01", kind: "first-turn", narrowing, agentCommands: [] },
        { turn: "closing-turn-01", kind: "closing-turn", narrowing, agentCommands: [] },
      ],
    });
  });

  it("says the person's work ran outside enforcement even when phax ran no turn", () => {
    expect(stopPostureOf({ cause: "declared", provider: "claude-code", names: [] })).toEqual({
      cause: "declared",
      personWork: "outside-phax-enforcement",
      turns: [],
    });
  });
});
