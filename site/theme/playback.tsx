// The home's playback of its live run (the `liveRun` frontmatter written from
// site/build/liveRun.ts), shared by the hero's card and the golden path under
// it so both show the same moment. Rendering starts at the end of the run, so
// the page reads without JavaScript; the browser replays it from the start and
// loops, unless the reader prefers reduced motion, and holds while the card is
// off screen.
import { useFrontmatter } from "@rspress/core/runtime";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { LiveRunLine } from "../build/liveRun.js";

// The test typecheck has no DOM library; the one browser API used here.
declare const window: { matchMedia(query: string): { readonly matches: boolean } };

export interface Playback {
  readonly lines: ReadonlyArray<LiveRunLine>;
  /** How many lines have played; `lines.length` at rest. */
  readonly shown: number;
  /** True while a replay is under way, false at rest (the run's end). */
  readonly playing: boolean;
  readonly setVisible: (visible: boolean) => void;
}

const PlaybackContext = createContext<Playback | null>(null);

/** The playback, or null outside the home (the golden path is then static). */
export function usePlayback(): Playback | null {
  return useContext(PlaybackContext);
}

function delay(line: LiveRunLine): number {
  if (line.kind === "state.transition") return 750;
  if (line.kind === "artifact") return 900;
  return 450;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LiveRunPlayback({ children }: { readonly children: ReactNode }) {
  const { frontmatter } = useFrontmatter();
  const lines = (frontmatter["liveRun"] ?? []) as ReadonlyArray<LiveRunLine>;
  const [shown, setShown] = useState(lines.length);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!reducedMotion()) setShown(0);
  }, []);

  useEffect(() => {
    if (!visible || reducedMotion()) return;
    const last = lines[shown - 1];
    const wait = shown >= lines.length ? 3500 : last === undefined ? 600 : delay(last);
    const timer = setTimeout(() => setShown(shown >= lines.length ? 0 : shown + 1), wait);
    return () => clearTimeout(timer);
  }, [shown, visible, lines]);

  const value: Playback = { lines, shown, playing: shown < lines.length, setVisible };
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
