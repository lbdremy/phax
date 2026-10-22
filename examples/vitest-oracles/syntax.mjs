// Parsing, test collection, marker stripping and normalized syntax trees.
//
// A file is parsed to ESTree, normalized by dropping positions and source
// spellings (parentheses are not emitted at all, comments are not part of the
// tree), and serialized: two serializations are equal when the code is the
// same, whatever its formatting.
import { parseSync } from "oxc-parser";

const TEST_ROOTS = new Set(["test", "it"]);
const BLOCK_ROOTS = new Set(["describe", "suite"]);
const MARKER = "fails";
// Modifiers that keep a test, or every test of a block, from running as written.
const NOT_RUN = new Set(["skip", "todo", "only", "skipIf", "runIf"]);
// A literal's `raw` is a source spelling of its value; a template element's
// `raw` is kept, since a tag such as `String.raw` reads it.
const DROPPED_KEYS = new Set(["start", "end", "range", "loc"]);
const NO_MARKERS = new Set();

/** The 1-based line of each offset into `text`. */
function lineFinder(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** Parse `text` as the language of `path`: `{ program }`, or `{ error: { message, line } }`. */
export function parse(path, text) {
  const result = parseSync(path, text, { preserveParens: false });
  const error = result.errors.find((e) => e.severity === "Error");
  if (error === undefined) return { program: result.program };
  const start = error.labels[0]?.start ?? 0;
  return { error: { message: error.message, line: lineFinder(text)(start) } };
}

/**
 * The tree without positions or source spellings, as plain data. A member
 * node in `markers` is replaced by its object: that is the marker stripped.
 */
function normalize(node, markers) {
  if (Array.isArray(node)) return node.map((item) => normalize(item, markers));
  if (typeof node === "bigint") return `${node}n`;
  // JSON has no Infinity: without a tag `1e999` would read as `null`.
  if (typeof node === "number" && !Number.isFinite(node)) return { nonFinite: String(node) };
  if (node === null || typeof node !== "object") return node;
  if (node instanceof RegExp) return String(node);
  if (markers.has(node)) return normalize(node.object, markers);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.has(key) || (key === "raw" && node.type === "Literal")) continue;
    out[key] = normalize(value, markers);
  }
  return out;
}

function serialize(node, markers) {
  return JSON.stringify(normalize(node, markers));
}

/**
 * Walk a callee through member accesses and calls (`test.fails.each(table)`)
 * to its root identifier, collecting the `fails` members and the modifiers
 * that keep it from running (`skip`, `todo`…) on the way. Call arguments are
 * never entered, so `test.each(fails.table)` has no marker.
 */
function calleeChain(callee) {
  const markers = [];
  const notRun = [];
  let node = callee;
  for (;;) {
    if (node.type === "MemberExpression") {
      const { property, computed } = node;
      if (!computed && property.type === "Identifier" && property.name === MARKER) {
        markers.push(node);
      }
      if (!computed && property.type === "Identifier" && NOT_RUN.has(property.name)) {
        notRun.push(property.name);
      }
      node = node.object;
    } else if (node.type === "CallExpression") {
      node = node.callee;
    } else if (node.type === "ChainExpression" || node.type === "TSNonNullExpression") {
      node = node.expression;
    } else {
      break;
    }
  }
  return {
    root: node.type === "Identifier" ? node.name : null,
    markers,
    notRun: notRun.toReversed(),
  };
}

/** A string literal's value, a substitution-free template's text, else the normalized tree. */
function titleOf(arg) {
  if (arg === undefined) return "<untitled>";
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "TemplateLiteral" && arg.expressions.length === 0) {
    const { cooked, raw } = arg.quasis[0].value;
    return cooked ?? raw;
  }
  return serialize(arg, NO_MARKERS);
}

/**
 * Why a test does not run as written, or null: a modifier on its own chain or
 * on an enclosing block's, or no test function (Vitest reads that as a todo).
 */
function notRunReason(node, notRun, blocks) {
  if (notRun.length > 0) return `carries .${notRun[0]}`;
  const block = blocks.find((b) => b.notRun.length > 0);
  if (block !== undefined)
    return `sits in block "${block.title}", which carries .${block.notRun[0]}`;
  if (node.arguments.length < 2) return "has no test function";
  return null;
}

/** Every test call of a program, in source order, with its enclosing block titles. */
function collect(program) {
  const found = [];
  const visit = (node, blocks) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, blocks);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (node.type === "CallExpression") {
      const { root, markers, notRun } = calleeChain(node.callee);
      if (TEST_ROOTS.has(root)) {
        found.push({
          node,
          titles: [...blocks.map((b) => b.title), titleOf(node.arguments[0])],
          markers,
          notRun: notRunReason(node, notRun, blocks),
        });
        return;
      }
      if (BLOCK_ROOTS.has(root)) {
        visit(node.arguments, [...blocks, { title: titleOf(node.arguments[0]), notRun }]);
        return;
      }
    }
    for (const value of Object.values(node)) visit(value, blocks);
  };
  visit(program, []);
  found.sort((a, b) => a.node.start - b.node.start);
  const seen = new Map();
  return found.map((entry) => {
    const base = entry.titles.join(" > ");
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...entry, identity: count === 1 ? base : `${base} #${count}` };
  });
}

/**
 * The tests of a parsed file, in source order: `{ identity, marked, notRun,
 * markerLines, start, end, tree }`, `notRun` being why the test does not run
 * or null, `start` and `end` lines and `tree` the test's marker-stripped
 * normalized serialization.
 */
export function testsOf(program, text) {
  const lineOf = lineFinder(text);
  return collect(program).map(({ node, identity, markers, notRun }) => ({
    identity,
    marked: markers.length > 0,
    notRun,
    markerLines: markers.map((marker) => lineOf(marker.property.start)),
    start: lineOf(node.start),
    end: lineOf(Math.max(node.start, node.end - 1)),
    tree: serialize(node, new Set(markers)),
  }));
}

/** The whole file's marker-stripped normalized serialization. */
export function strippedProgram(program) {
  const markers = new Set(collect(program).flatMap((entry) => entry.markers));
  return serialize(program, markers);
}
