import { Effect } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystem, FsError } from "../ports/fs.js";
import { GitHub, type GitHubError } from "../ports/github.js";
import {
  buildReportBody,
  buildReportTitle,
  buildFullLog,
  needsGist,
  type ReportMetadata,
} from "../domain/telemetry/report.js";

export interface ReportInput {
  readonly shortName?: string;
  readonly stateRoot?: string;
  readonly phaxHomeDir: string;
  readonly noGist: boolean;
  readonly phaxVersion: string;
  readonly repo: string;
}

const findLatestJournal = (phaxHomeDir: string): Effect.Effect<string | null, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const names = yield* Effect.catchAll(fs.list(phaxHomeDir), () =>
      Effect.succeed([] as readonly string[]),
    );
    const journals = names
      .filter((n) => /^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .toSorted()
      .toReversed();
    if (journals.length === 0) return null;
    return join(phaxHomeDir, journals[0]!);
  });

const resolveSource = (filePath: string, phaxHomeDir: string): string => {
  const fileName = filePath.slice(phaxHomeDir.length + 1);
  const match = /^telemetry-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName);
  if (match?.[1] !== undefined) return `global: ${match[1]}`;
  const parts = filePath.split("/");
  const runsIdx = parts.lastIndexOf("runs");
  if (runsIdx !== -1 && parts[runsIdx + 1] !== undefined) {
    return `run: ${parts[runsIdx + 1]}`;
  }
  return filePath;
};

export function report(
  input: ReportInput,
): Effect.Effect<string, FsError | GitHubError, FileSystem | GitHub> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const github = yield* GitHub;

    // Resolve which telemetry file to use
    let telemetryPath: string;
    if (input.shortName !== undefined && input.stateRoot !== undefined) {
      telemetryPath = join(input.stateRoot, "runs", input.shortName, "semantic.jsonl");
    } else {
      const latest = yield* findLatestJournal(input.phaxHomeDir);
      if (latest === null) {
        return yield* Effect.fail(
          new FsError({
            message: `No telemetry journal files found in ${input.phaxHomeDir}. Run some phax commands first.`,
          }),
        );
      }
      telemetryPath = latest;
    }

    const source = resolveSource(telemetryPath, input.phaxHomeDir);

    const content = yield* fs.readText(telemetryPath);
    const records = content.split("\n").filter((l) => l.trim().length > 0);

    const metadata: ReportMetadata = {
      phaxVersion: input.phaxVersion,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      source,
    };

    const title = buildReportTitle(metadata);
    const fullLog = buildFullLog(records);
    const safeSource = source.replace(/[^a-z0-9-]/gi, "_");
    const tempDir = tmpdir();

    let gistUrl: string | undefined;
    if (!input.noGist && needsGist(fullLog)) {
      const gistFile = join(tempDir, `phax-telemetry-${safeSource}.jsonl`);
      yield* fs.writeAtomic(gistFile, fullLog);
      gistUrl = yield* github.createGist({
        description: `phax telemetry: ${source}`,
        file: gistFile,
        public: false,
      });
    }

    const body = buildReportBody(metadata, records, gistUrl);
    const bodyFile = join(tempDir, `phax-report-${safeSource}-body.md`);
    yield* fs.writeAtomic(bodyFile, body);

    return yield* github.createIssue({ repo: input.repo, title, bodyFile });
  });
}
