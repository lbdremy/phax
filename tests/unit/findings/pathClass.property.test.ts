import * as fc from "fast-check";
import { describe, it } from "vitest";
import { classifyPath, pathClassesOf } from "../../../src/domain/findings/pathClass.js";
import { PATH_CLASSES } from "../../../src/schemas/pathClass.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";

const segment = fc.oneof(
  fc.string({ maxLength: 8 }).filter((s) => !s.includes("/")),
  fc.constantFrom("tests", "docs", "e2e", ".github", "workflows", "phax.json", "a.test.ts", "x.md"),
);
const path = fc.array(segment, { minLength: 1, maxLength: 5 }).map((s) => s.join("/"));
const paths = fc.array(path, { maxLength: 8 });

const key = (list: readonly string[]) => JSON.stringify(list);

describe("path classes", () => {
  it(
    "do not depend on the order or repetition of the paths",
    () => {
      checkProperty(fc.tuple(paths, fc.nat(), fc.nat({ max: 3 })), ([list, seed, repeat]) => {
        const shuffled = list.toSorted(
          (a, b) => ((a.length * 31 + seed) % 7) - ((b.length * 31 + seed) % 7),
        );
        const duplicated = [...shuffled.toReversed(), ...list.slice(0, repeat)];
        return key(pathClassesOf(duplicated)) === key(pathClassesOf(list));
      });
    },
    propertyTimeout(),
  );

  it(
    "are sorted in PATH_CLASSES order without duplicates",
    () => {
      checkProperty(paths, (list) => {
        const classes = pathClassesOf(list);
        const indexes = classes.map((c) => PATH_CLASSES.indexOf(c));
        return indexes.every((i, n) => i >= 0 && (n === 0 || i > indexes[n - 1]!));
      });
    },
    propertyTimeout(),
  );

  it(
    "classifyPath is total",
    () => {
      checkProperty(fc.oneof(path, fc.string()), (p) => PATH_CLASSES.includes(classifyPath(p)));
    },
    propertyTimeout(),
  );
});
