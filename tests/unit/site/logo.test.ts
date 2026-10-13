import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLD_DARK, GOLD_LIGHT } from "../../../site/theme/tokens.js";

const PUBLIC = resolve(import.meta.dirname, "../../../site/public");

const LOGOS = [
  ["logo.svg", GOLD_DARK],
  ["logo-light.svg", GOLD_LIGHT],
] as const;

function read(file: string): string {
  return readFileSync(resolve(PUBLIC, file), "utf8");
}

function attributes(tag: string): ReadonlyMap<string, string> {
  return new Map(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

function rootAttributes(svg: string): ReadonlyMap<string, string> {
  return attributes(/<svg\b[^>]*>/.exec(svg)?.[0] ?? "");
}

function pathTags(svg: string): ReadonlyArray<string> {
  return [...svg.matchAll(/<path\b[^>]*>/g)].map((match) => match[0]);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The points a path passes through: its start, every vertex and every arc's
 * end. Enough for the logo's lines and quarter arcs, whose extents lie
 * between their ends.
 */
function vertices(d: string): ReadonlyArray<Point> {
  const tokens = [...d.matchAll(/[a-zA-Z]|-?\d*\.?\d+/g)].map((match) => match[0]);
  const points: Array<Point> = [];
  let current: Point = { x: 0, y: 0 };
  let command = "";
  const number = (): number => Number(tokens.shift());
  while (tokens.length > 0) {
    if (/^[a-zA-Z]$/.test(tokens[0] ?? "")) command = tokens.shift() ?? "";
    const relative = command === command.toLowerCase();
    const base = relative ? current : { x: 0, y: 0 };
    switch (command.toUpperCase()) {
      case "M":
      case "L":
        current = { x: base.x + number(), y: base.y + number() };
        break;
      case "H":
        current = { x: base.x + number(), y: current.y };
        break;
      case "V":
        current = { x: current.x, y: base.y + number() };
        break;
      case "A": {
        tokens.splice(0, 5);
        current = { x: base.x + number(), y: base.y + number() };
        break;
      }
      default:
        throw new Error(`unsupported path command ${command}`);
    }
    points.push(current);
  }
  return points;
}

describe.each(LOGOS)("site/public/%s", (file, gold) => {
  const svg = read(file);
  const root = rootAttributes(svg);
  const paths = pathTags(svg);

  it("strokes every path at one width, with butt caps, from the root only", () => {
    expect(root.get("stroke-width")).toBe("3");
    expect(root.get("stroke-linecap")).toBe("butt");
    expect(paths).toHaveLength(3);
    for (const path of paths) expect([...attributes(path).keys()]).toEqual(["d"]);
  });

  it("uses exactly one colour, its theme's gold accent, with no fill or gradient", () => {
    expect(root.get("stroke")).toBe(gold);
    expect(root.get("fill")).toBe("none");
    expect(new Set(svg.match(/#[0-9a-fA-F]{3,8}\b/g))).toEqual(new Set([gold]));
    expect(svg).not.toMatch(/gradient|<style|style=|opacity|<(?!\/?(?:svg|path)\b)[a-z]/i);
  });

  it("cuts the P twice into an F and a bowl, each cut at least 1/8 of the glyph height", () => {
    const [stem, middle, bowl] = paths.map((path) => vertices(attributes(path).get("d") ?? ""));
    if (stem === undefined || middle === undefined || bowl === undefined) {
      throw new Error("three paths expected");
    }
    const [foot, top, topEnd] = stem;
    const [middleStart, middleEnd] = middle;
    const bowlStart = bowl[0];
    const bowlEnd = bowl.at(-1);
    if (
      foot === undefined ||
      top === undefined ||
      topEnd === undefined ||
      middleStart === undefined ||
      middleEnd === undefined ||
      bowlStart === undefined ||
      bowlEnd === undefined
    ) {
      throw new Error("stem, middle arm and bowl expected");
    }
    // The F: a stem with a top arm, and a shorter middle arm leaving the stem.
    expect(top.x).toBe(foot.x);
    expect(topEnd.y).toBe(top.y);
    expect(middleStart.x).toBe(foot.x);
    expect(middleEnd.y).toBe(middleStart.y);
    expect(middleEnd.x).toBeLessThan(topEnd.x);
    // The P's bowl leaves the top arm's line and comes back on the middle arm's.
    expect(bowlStart.y).toBe(topEnd.y);
    expect(bowlEnd.y).toBe(middleEnd.y);
    expect(Math.max(...bowl.map((point) => point.x))).toBeGreaterThan(topEnd.x);
    // Every cut is between butt caps across a horizontal tangent: its clear gap is the x distance.
    const ys = [...stem, ...middle, ...bowl].map((point) => point.y);
    const height = Math.max(...ys) - Math.min(...ys) + Number(root.get("stroke-width"));
    expect((bowlStart.x - topEnd.x) / height).toBeGreaterThanOrEqual(1 / 8);
    expect((bowlEnd.x - middleEnd.x) / height).toBeGreaterThanOrEqual(1 / 8);
  });
});

describe("the two logos", () => {
  it("share their geometry and differ only in colour", () => {
    const dark = read("logo.svg");
    const light = read("logo-light.svg");
    expect(pathTags(light)).toEqual(pathTags(dark));
    expect(light.replaceAll(GOLD_LIGHT, GOLD_DARK)).toBe(dark);
  });
});
