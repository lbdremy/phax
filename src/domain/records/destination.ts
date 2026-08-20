import type { RecordsDestination } from "../../schemas/recordsConfig.js";

/** The source repo's detected visibility, as reported by the host. */
export type RepoVisibility = "public" | "private" | "unknown";

export type RecordsDestinationRefusalReason =
  | "public-source-in-repo"
  | "unacknowledged-unknown-visibility";

export interface RecordsDestinationInput {
  readonly transcript: boolean;
  readonly destination: RecordsDestination;
  readonly visibility: RepoVisibility;
}

interface RecordsDestinationAllowed {
  readonly kind: "allowed";
  readonly destination: RecordsDestination;
}

interface RecordsDestinationRefused {
  readonly kind: "refused";
  readonly reason: RecordsDestinationRefusalReason;
  readonly destination: RecordsDestination;
  readonly message: string;
  readonly remedy: string;
}

export type RecordsDestinationDecision = RecordsDestinationAllowed | RecordsDestinationRefused;

/**
 * Decide whether the configured destination may be written to, from the
 * source repo's detected visibility (spec §5.4). Detection guards the
 * configured choice, it never picks one: every branch below either allows
 * the destination the config already names, or refuses it with a named
 * reason and remedy — there is no third outcome that substitutes a
 * different destination.
 */
export function decideRecordsDestination(
  input: RecordsDestinationInput,
): RecordsDestinationDecision {
  const { transcript, destination, visibility } = input;

  // A dedicated records repo serves exactly one project and carries no
  // source code, so it is allowed whatever the source repo's visibility.
  if (destination.kind === "repo") {
    return { kind: "allowed", destination };
  }

  // A skeleton record carries no transcript, so an in-repo destination is
  // safe whatever the visibility.
  if (!transcript) {
    return { kind: "allowed", destination };
  }

  if (visibility === "public") {
    return {
      kind: "refused",
      reason: "public-source-in-repo",
      destination,
      message:
        "transcripts enabled, records in-repo, and this repo is public: records would be published with the code",
      remedy: "set a records repo, or disable transcripts",
    };
  }

  if (visibility === "unknown" && destination.acknowledgedUnknownVisibility !== true) {
    return {
      kind: "refused",
      reason: "unacknowledged-unknown-visibility",
      destination,
      message:
        "this repo's visibility could not be determined, and transcripts are enabled with an in-repo destination",
      remedy:
        "set records.destination.acknowledgedUnknownVisibility to true once you have confirmed this repo is private, or disable transcripts",
    };
  }

  return { kind: "allowed", destination };
}
