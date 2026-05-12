import { Context, Effect, Schema } from "effect";
import type { ShortName } from "../domain/branded.js";
import type { FsError } from "./fs.js";
import type { LockConflictError } from "../domain/errors.js";

export const LockFileSchema = Schema.Struct({
  shortName: Schema.NonEmptyString,
  pid: Schema.Int,
  status: Schema.Literal("active"),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});

export type LockFile = Schema.Schema.Type<typeof LockFileSchema>;

export const decodeLockFile = Schema.decodeUnknownEither(LockFileSchema);

export type LockStatus =
  | { readonly kind: "none" }
  | { readonly kind: "active"; readonly pid: number; readonly updatedAt: string }
  | { readonly kind: "stale"; readonly pid: number; readonly reason: "pid_dead" | "expired" };

export interface LockOps {
  acquire(shortName: ShortName): Effect.Effect<void, LockConflictError | FsError>;
  renew(shortName: ShortName): Effect.Effect<void, FsError>;
  release(shortName: ShortName): Effect.Effect<void, FsError>;
  status(shortName: ShortName): Effect.Effect<LockStatus, FsError>;
}

export class Lock extends Context.Tag("phax/Lock")<Lock, LockOps>() {}
