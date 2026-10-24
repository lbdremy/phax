import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  findVibeSessionDir,
  readVibeSessionMetaText,
  type VibeStoreReads,
} from "../../../src/domain/session/vibeSessionStore.js";

const ROOT = "/home/ada/.vibe";
const SESSIONS = `${ROOT}/logs/session`;

/** In-memory reads over `dirs` (path → names) and `files` (path → text), logging every path read. */
function storeReads(
  dirs: Record<string, readonly string[]>,
  files: Record<string, string>,
): { reads: VibeStoreReads; listed: string[]; readPaths: string[] } {
  const listed: string[] = [];
  const readPaths: string[] = [];
  return {
    listed,
    readPaths,
    reads: {
      list: (path) =>
        Effect.sync(() => {
          listed.push(path);
          return dirs[path] ?? null;
        }),
      readText: (path) =>
        Effect.sync(() => {
          readPaths.push(path);
          return files[path] ?? null;
        }),
    },
  };
}

const meta = (fields: Record<string, unknown>): string => JSON.stringify(fields);

describe("findVibeSessionDir", () => {
  it.each([
    {
      name: "returns the directory whose suffix and meta.json name the id, never reading the others",
      names: ["session_20261024_101500_X0abc", "session_20261024_102000_X1abc", "notes.txt"],
      files: {
        [`${SESSIONS}/session_20261024_101500_X0abc/meta.json`]: meta({ session_id: "X0abcdef" }),
        [`${SESSIONS}/session_20261024_102000_X1abc/meta.json`]: meta({ session_id: "X1abcdef" }),
      },
      sessionId: "X1abcdef",
      expected: `${SESSIONS}/session_20261024_102000_X1abc`,
      read: [`${SESSIONS}/session_20261024_102000_X1abc/meta.json`],
    },
    {
      name: "skips a matching name whose meta.json has no session_id",
      names: ["session_20261024_101500_X1", "session_20261024_102000_X1abc"],
      files: {
        [`${SESSIONS}/session_20261024_101500_X1/meta.json`]: meta({ start_time: "2026-10-24" }),
        [`${SESSIONS}/session_20261024_102000_X1abc/meta.json`]: meta({ session_id: "X1abcdef" }),
      },
      sessionId: "X1abcdef",
      expected: `${SESSIONS}/session_20261024_102000_X1abc`,
      read: [
        `${SESSIONS}/session_20261024_101500_X1/meta.json`,
        `${SESSIONS}/session_20261024_102000_X1abc/meta.json`,
      ],
    },
    {
      name: "falls back to every session_* directory when no name follows the convention",
      names: ["session_one", "session_two"],
      files: {
        [`${SESSIONS}/session_one/meta.json`]: meta({ session_id: "C1" }),
        [`${SESSIONS}/session_two/meta.json`]: meta({ session_id: "X2" }),
      },
      sessionId: "X2",
      expected: `${SESSIONS}/session_two`,
      read: [`${SESSIONS}/session_one/meta.json`, `${SESSIONS}/session_two/meta.json`],
    },
    {
      name: "returns null when a matching name's meta.json names another session",
      names: ["session_20261024_101500_X1"],
      files: { [`${SESSIONS}/session_20261024_101500_X1/meta.json`]: meta({ session_id: "X1z" }) },
      sessionId: "X1abcdef",
      expected: null,
      read: [`${SESSIONS}/session_20261024_101500_X1/meta.json`],
    },
    {
      name: "returns null when the session folder cannot be listed",
      names: null,
      files: {},
      sessionId: "X1",
      expected: null,
      read: [],
    },
  ])("$name", async ({ names, files, sessionId, expected, read }) => {
    const store = storeReads(names === null ? {} : { [SESSIONS]: names }, files);
    const dir = await Effect.runPromise(findVibeSessionDir(store.reads, ROOT, sessionId));
    expect(dir).toBe(expected);
    expect(store.listed).toEqual([SESSIONS]);
    expect(store.readPaths).toEqual(read);
  });

  it("does not take an empty suffix for a prefix of every id", async () => {
    const store = storeReads(
      { [SESSIONS]: ["session_20261024_", "session_20261024_101500_C1"] },
      {
        [`${SESSIONS}/session_20261024_/meta.json`]: meta({ session_id: "C9" }),
        [`${SESSIONS}/session_20261024_101500_C1/meta.json`]: meta({ session_id: "X1" }),
      },
    );
    const dir = await Effect.runPromise(findVibeSessionDir(store.reads, ROOT, "X1"));
    // Neither name holds X1, so the fallback reads every session_* meta.json:
    // had the empty suffix passed the rule, only the first would be read.
    expect(dir).toBe(`${SESSIONS}/session_20261024_101500_C1`);
    expect(store.readPaths).toEqual([
      `${SESSIONS}/session_20261024_/meta.json`,
      `${SESSIONS}/session_20261024_101500_C1/meta.json`,
    ]);
  });
});

describe("readVibeSessionMetaText", () => {
  it("returns the found session's meta.json text, whole", async () => {
    const text = meta({ session_id: "X1abcdef", stats: { session_prompt_tokens: 10 } });
    const store = storeReads(
      { [SESSIONS]: ["session_20261024_101500_X1abc"] },
      { [`${SESSIONS}/session_20261024_101500_X1abc/meta.json`]: text },
    );
    expect(await Effect.runPromise(readVibeSessionMetaText(store.reads, ROOT, "X1abcdef"))).toBe(
      text,
    );
  });
});
