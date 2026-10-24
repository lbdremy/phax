// A provider session id phax may join into a path. Pure and import-free: the
// schemas package reaches it through the documents that record session ids.

/**
 * A session id that may be joined into a path: it starts with a letter or
 * digit and holds only letters, digits, `.`, `_` and `-`, so `.`, `..` and
 * any slash are refused. The one definition: the documents' schemas, the
 * provider store adapters and the close's transcript copies all test ids
 * against it.
 */
export const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Whether `sessionId` may be joined into a path (see SAFE_SESSION_ID). */
export function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}
