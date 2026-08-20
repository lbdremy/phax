import { Schema } from "effect";

function isSafeRecordsRemote(remote: string): boolean {
  if (remote.startsWith("https://")) return true;
  if (remote.startsWith("ssh://")) return true;
  // scp-like syntax: git@host:path (no whitespace, host has no ':' or '/')
  return /^git@[^\s:/]+:\S+$/.test(remote);
}

export const RecordsRemoteSchema = Schema.NonEmptyString.pipe(
  Schema.filter(isSafeRecordsRemote, {
    message: () => `records.destination.remote must be an https://, ssh://, or git@host:path URL`,
  }),
);

export const InRepoRecordsDestinationSchema = Schema.Struct({
  kind: Schema.Literal("in-repo"),
});

export const RepoRecordsDestinationSchema = Schema.Struct({
  kind: Schema.Literal("repo"),
  remote: RecordsRemoteSchema,
});

export const RecordsDestinationSchema = Schema.Union(
  InRepoRecordsDestinationSchema,
  RepoRecordsDestinationSchema,
);

export type RecordsDestination = Schema.Schema.Type<typeof RecordsDestinationSchema>;

export const RecordsConfigSchema = Schema.Struct({
  transcript: Schema.Boolean,
  destination: RecordsDestinationSchema,
  autoPush: Schema.Boolean,
});

export type RecordsConfig = Schema.Schema.Type<typeof RecordsConfigSchema>;

export interface ResolvedRecordsConfig {
  readonly enabled: boolean;
  readonly transcript: boolean;
  readonly destination: RecordsDestination;
  readonly autoPush: boolean;
}

const DISABLED_RECORDS_CONFIG: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

export function resolveRecordsConfig(raw: RecordsConfig | undefined): ResolvedRecordsConfig {
  if (raw === undefined) return DISABLED_RECORDS_CONFIG;
  return {
    enabled: true,
    transcript: raw.transcript,
    destination: raw.destination,
    autoPush: raw.autoPush,
  };
}
