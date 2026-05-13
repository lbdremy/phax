import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { readRegistry } from "../../app/registry.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { Lock } from "../../ports/lock.js";
import type { RegistryEntry } from "../../schemas/registry.js";
import { decodeShortName } from "../../domain/branded.js";

export interface LsOptions {
  active?: boolean;
  failed?: boolean;
  reviewOpen?: boolean;
  archived?: boolean;
  json?: boolean;
}

type LockState = "none" | "active" | "stale";

interface LsRow {
  shortName: string;
  state: string;
  branch: string;
  currentPhase: string;
  gateProfile: string;
  updatedAt: string;
  lockState: LockState;
}

function filterEntries(entries: readonly RegistryEntry[], opts: LsOptions): RegistryEntry[] {
  const hasFilter = opts.active ?? opts.failed ?? opts.reviewOpen ?? opts.archived;
  if (!hasFilter) return [...entries];

  return entries.filter((e) => {
    if (opts.active && (e.state === "created" || e.state === "running")) return true;
    if (opts.failed && e.state === "failed") return true;
    if (opts.reviewOpen && e.state === "review_open") return true;
    if (opts.archived && e.state === "archived") return true;
    return false;
  });
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function formatTable(rows: LsRow[]): string {
  if (rows.length === 0) return "(no runs)";

  const headers: (keyof LsRow)[] = [
    "shortName",
    "state",
    "branch",
    "currentPhase",
    "gateProfile",
    "updatedAt",
    "lockState",
  ];
  const labels: Record<keyof LsRow, string> = {
    shortName: "NAME",
    state: "STATE",
    branch: "BRANCH",
    currentPhase: "PHASE",
    gateProfile: "PROFILE",
    updatedAt: "UPDATED",
    lockState: "LOCK",
  };

  const widths = headers.map((h) =>
    Math.max(labels[h].length, ...rows.map((r) => String(r[h]).length)),
  );

  const header = headers.map((h, i) => pad(labels[h], widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const rowLines = rows.map((r) => headers.map((h, i) => pad(String(r[h]), widths[i]!)).join("  "));

  return [header, separator, ...rowLines].join("\n");
}

export async function runLs(opts: LsOptions, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const registryEffect = readRegistry(stateRoot).pipe(Effect.provide(NodeFileSystemLayer));
  const registryResult = await Effect.runPromise(Effect.either(registryEffect));
  if (Either.isLeft(registryResult)) {
    out.error(`Registry error: ${registryResult.left.message}`);
    return 1;
  }

  const registry = registryResult.right;
  const filtered = filterEntries(registry.runs, opts);

  const lockLayer = Layer.merge(NodeFileSystemLayer, makeNodeLockLayer(stateRoot));

  const rows: LsRow[] = await Promise.all(
    filtered.map(async (entry) => {
      const shortNameResult = decodeShortName(entry.shortName);
      let lockState: LockState = "none";

      if (Either.isRight(shortNameResult)) {
        const lockEffect = Effect.gen(function* () {
          const lock = yield* Lock;
          return yield* lock.status(shortNameResult.right);
        }).pipe(Effect.provide(lockLayer));

        const lockResult = await Effect.runPromise(Effect.either(lockEffect));
        if (Either.isRight(lockResult)) {
          const status = lockResult.right;
          if (status.kind === "active") lockState = "active";
          else if (status.kind === "stale") lockState = "stale";
        }
      }

      const phaseLabel =
        entry.currentPhaseIndex !== undefined
          ? `phase-${String(entry.currentPhaseIndex + 1).padStart(2, "0")}`
          : "-";

      return {
        shortName: entry.shortName,
        state: entry.state,
        branch: entry.branch,
        currentPhase: phaseLabel,
        gateProfile: entry.gateProfileId ?? "-",
        updatedAt: entry.updatedAt.slice(0, 16).replace("T", " "),
        lockState,
      };
    }),
  );

  if (opts.json) {
    out.log(
      JSON.stringify(
        rows.map((r, i) => ({ ...r, archivePath: filtered[i]?.archivePath })),
        null,
        2,
      ),
    );
  } else {
    out.log(formatTable(rows));
  }

  return 0;
}
