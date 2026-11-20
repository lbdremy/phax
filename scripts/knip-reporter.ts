// A knip reporter that prints, as one JSON line on stdout, every finding knip reports as an error and
// every configuration hint, for scripts/knip-baseline.ts to compare with knip-baseline.json. knip's own
// JSON reporter leaves the hints out, and the hints fail the run (`treatConfigHintsAsErrors`).
// knip loads it by path: `knip --reporter ./scripts/knip-reporter.ts`.
//
// It reads knip's report as knip's built-in reporters do: only the issue types the run reports, and the
// configuration hints only when the run gives them (knip gives none in production mode, whose ignore
// lists see only part of the repository; the default run checks them).
import { relative } from "node:path";

import type { IssueType, Reporter } from "knip";

import type { KnipFinding, KnipReport } from "./knipBaseline.js";

const knipBaselineReporter: Reporter = (options) => {
  const findings: KnipFinding[] = [];
  for (const [type, reported] of Object.entries(options.report)) {
    if (!reported) continue;
    for (const bySymbol of Object.values(options.issues[type as IssueType])) {
      for (const issue of Object.values(bySymbol)) {
        if (issue.severity !== undefined && issue.severity !== "error") continue;
        findings.push({
          type,
          file: relative(options.cwd, issue.filePath),
          // An enum's or a namespace's member is named with its parent, so two members of one name differ.
          name:
            issue.parentSymbol === undefined
              ? issue.symbol
              : `${issue.parentSymbol}.${issue.symbol}`,
        });
      }
    }
  }
  const hints = options.isDisableConfigHints
    ? []
    : options.configurationHints.map((hint) => ({
        type: hint.type,
        identifier: String(hint.identifier),
      }));
  const report: KnipReport = { findings, hints };
  process.stdout.write(`${JSON.stringify(report)}\n`);
};

export default knipBaselineReporter;
