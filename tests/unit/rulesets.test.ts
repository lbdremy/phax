import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const github = join(import.meta.dirname, "../../.github");

interface Ruleset {
  readonly rules: readonly {
    readonly type: string;
    readonly parameters?: {
      readonly required_status_checks?: readonly { readonly context: string }[];
    };
  }[];
}

// The rule set requires checks by job name: renaming a job without updating
// it would leave main waiting on a check that never reports.
describe("main's rule set", () => {
  const ruleset = JSON.parse(readFileSync(join(github, "rulesets/main.json"), "utf-8")) as Ruleset;
  const jobs = readdirSync(join(github, "workflows"))
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) =>
      Object.keys(
        (parse(readFileSync(join(github, "workflows", f), "utf-8")) as { jobs: object }).jobs,
      ),
    );

  it("requires checks that name existing workflow jobs", () => {
    const required = ruleset.rules.flatMap((r) =>
      (r.parameters?.required_status_checks ?? []).map((c) => c.context),
    );
    expect(required).toEqual(["ci", "security-audit"]);
    for (const context of required) expect(jobs).toContain(context);
  });
});
