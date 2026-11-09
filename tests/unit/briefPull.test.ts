import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  BRIEFS_CLOSED_MARKER,
  PULLED_BRIEFS_DIR,
  nextPulledBriefName,
} from "../../src/domain/brief/pull.js";
import { resolveTreePaths } from "../../src/domain/treePaths.js";

// Made-up roots and paths throughout.
const root = "/work/repo";

function resolveFrom(cwd: string, ...paths: [string, ...string[]]) {
  return resolveTreePaths({ cwd, root, paths });
}

describe("resolveTreePaths", () => {
  it("resolves against the cwd and makes the paths root-relative", () => {
    expect(resolveFrom(`${root}/src/core`, "billing/tax.ts")).toEqual(
      Result.succeed(["src/core/billing/tax.ts"]),
    );
  });

  it("drops duplicates, keeping the first occurrence in the order given", () => {
    expect(
      resolveFrom(
        `${root}/src/core`,
        "billing/tax.ts",
        "billing/invoice.ts",
        "./billing/tax.ts",
        `${root}/src/core/billing/invoice.ts`,
      ),
    ).toEqual(Result.succeed(["src/core/billing/tax.ts", "src/core/billing/invoice.ts"]));
  });

  it("never checks existence", () => {
    expect(resolveFrom(root, "src/not/yet/created.ts")).toEqual(
      Result.succeed(["src/not/yet/created.ts"]),
    );
  });

  it("accepts an absolute path inside the root", () => {
    expect(resolveFrom(`${root}/docs`, `${root}/src/greet.ts`)).toEqual(
      Result.succeed(["src/greet.ts"]),
    );
  });

  it("refuses a path that climbs out of the root", () => {
    expect(resolveFrom(root, "src/a.ts", "../elsewhere.ts")).toEqual(
      Result.fail({ refused: "../elsewhere.ts is outside the working tree" }),
    );
  });

  it("refuses an absolute path outside the root", () => {
    expect(resolveFrom(root, "/etc/hosts")).toEqual(
      Result.fail({ refused: "/etc/hosts is outside the working tree" }),
    );
  });

  it("refuses the root itself", () => {
    expect(resolveFrom(`${root}/src`, "..")).toEqual(
      Result.fail({ refused: ".. is the working tree itself" }),
    );
  });

  it("keeps a name that merely starts with two dots", () => {
    expect(resolveFrom(root, "..notes.ts")).toEqual(Result.succeed(["..notes.ts"]));
  });
});

describe("nextPulledBriefName", () => {
  it("starts at brief-01.json", () => {
    expect(nextPulledBriefName([])).toBe("brief-01.json");
  });

  it("follows the pushed brief's number", () => {
    expect(nextPulledBriefName(["brief-00.json"])).toBe("brief-01.json");
  });

  it("takes one past the highest number, ignoring other names", () => {
    expect(nextPulledBriefName(["brief-01.json", "brief-03.json", "notes.txt"])).toBe(
      "brief-04.json",
    );
  });

  it("goes past two digits", () => {
    expect(nextPulledBriefName(["brief-99.json", "brief-1.json", BRIEFS_CLOSED_MARKER])).toBe(
      "brief-100.json",
    );
  });
});

describe("pulled brief locations", () => {
  it("wait under .phax-context/briefs, closed by a marker", () => {
    expect(PULLED_BRIEFS_DIR).toBe(".phax-context/briefs");
    expect(BRIEFS_CLOSED_MARKER).toBe("closed");
  });
});
