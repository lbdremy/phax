/** What a failed `gh repo view` says about why the visibility is unknown. */
export type GhFailureClass = "network" | "auth" | "other";

const NETWORK_SIGNATURES = [
  "error connecting to",
  "could not resolve host",
  "dial tcp",
  "no such host",
  "connection refused",
  "i/o timeout",
  "tls handshake timeout",
] as const;

const AUTH_SIGNATURES = [
  "gh auth login",
  "authentication",
  "not logged in",
  "http 401",
  "bad credentials",
] as const;

/**
 * Class of gh's first stderr line. Never a bare `could not resolve` (gh's
 * GraphQL `Could not resolve to a Repository` not-found error says it too) nor
 * a bare `timeout`.
 */
export function classifyGhFailure(firstLine: string | null): GhFailureClass {
  if (firstLine === null) return "other";
  const line = firstLine.toLowerCase();
  if (NETWORK_SIGNATURES.some((signature) => line.includes(signature))) return "network";
  if (AUTH_SIGNATURES.some((signature) => line.includes(signature))) return "auth";
  return "other";
}
