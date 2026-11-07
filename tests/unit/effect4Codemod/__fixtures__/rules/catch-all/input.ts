import { Effect } from "effect";

/** A file's text, or an empty string when it cannot be read. */
export const readOrEmpty = (read: Effect.Effect<string, Error>) =>
  read.pipe(Effect.catchAll(() => Effect.succeed("")));

/** A file's text, or why it could not be read. */
export const readOrReason = (read: Effect.Effect<string, Error>) =>
  Effect.catchAll(read, (error) => Effect.succeed(`unreadable: ${error.message}`));

/** The primary source's text, or the fallback's when the primary fails. */
export const readFirst = (primary: Effect.Effect<string, Error>, fallback: Effect.Effect<string, Error>) =>
  primary.pipe(Effect.orElse(() => fallback));

/** The same, data first. */
export const readFirstOf = (primary: Effect.Effect<string, Error>, fallback: Effect.Effect<string, Error>) =>
  Effect.orElse(primary, () => fallback);
