import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem, FsError } from "../ports/fs.js";
import { ConfigValidationError } from "../domain/errors.js";
import {
  PHAX_ALIAS_LEVELS,
  makePhaxAliasName,
  extractBaseModel,
  renderPhaxAliasBlocks,
  type PhaxAliasLevel,
} from "../schemas/vibeConfig.js";

export const VIBE_CONFIG_PATH = join(homedir(), ".vibe", "config.toml");
const DEFAULT_BASE_ALIAS = "mistral-medium-3.5";

export interface VibeSetupOptions {
  readonly dryRun?: boolean;
  readonly install?: boolean;
  readonly baseAlias?: string;
}

export interface VibeSetupResult {
  readonly aliasesAdded: readonly string[];
  readonly aliasesSkipped: readonly string[];
  readonly backupPath: string | undefined;
}

function isAliasPresent(text: string, aliasName: string): boolean {
  return text.includes(`alias = "${aliasName}"`);
}

export function vibeSetup(
  options: VibeSetupOptions = {},
): Effect.Effect<VibeSetupResult, ConfigValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { dryRun = false, install = false, baseAlias = DEFAULT_BASE_ALIAS } = options;

    const fileExists = yield* Effect.mapError(
      fs.exists(VIBE_CONFIG_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: VIBE_CONFIG_PATH }),
    );

    if (!fileExists) {
      return yield* Effect.fail(
        new ConfigValidationError({
          message: `Vibe config not found at "${VIBE_CONFIG_PATH}". Is Vibe installed?`,
          path: VIBE_CONFIG_PATH,
        }),
      );
    }

    const originalContent = yield* Effect.mapError(
      fs.readText(VIBE_CONFIG_PATH),
      (e: FsError) => new ConfigValidationError({ message: e.message, path: VIBE_CONFIG_PATH }),
    );

    const baseResult = extractBaseModel(originalContent, baseAlias);
    if (Either.isLeft(baseResult)) {
      return yield* Effect.fail(
        new ConfigValidationError({ message: baseResult.left, path: VIBE_CONFIG_PATH }),
      );
    }
    const base = baseResult.right;

    const missing: PhaxAliasLevel[] = [];
    const present: PhaxAliasLevel[] = [];

    for (const level of PHAX_ALIAS_LEVELS) {
      const aliasName = makePhaxAliasName(level);
      if (isAliasPresent(originalContent, aliasName)) {
        present.push(level);
      } else {
        missing.push(level);
      }
    }

    const aliasesAdded = missing.map(makePhaxAliasName);
    const aliasesSkipped = present.map(makePhaxAliasName);

    if (!install || dryRun) {
      return { aliasesAdded, aliasesSkipped, backupPath: undefined };
    }

    if (missing.length === 0) {
      return { aliasesAdded: [], aliasesSkipped, backupPath: undefined };
    }

    const backupPath = `${VIBE_CONFIG_PATH}.phax-backup-${Date.now()}`;

    yield* Effect.mapError(
      fs.writeAtomic(backupPath, originalContent),
      (e: FsError) =>
        new ConfigValidationError({
          message: `Failed to write backup to "${backupPath}": ${e.message}`,
          path: backupPath,
        }),
    );

    const appendedBlocks = renderPhaxAliasBlocks(base, missing);
    const newContent = `${originalContent}\n${appendedBlocks}`;

    yield* Effect.mapError(
      fs.writeAtomic(VIBE_CONFIG_PATH, newContent),
      (e: FsError) =>
        new ConfigValidationError({
          message: `Failed to write Vibe config to "${VIBE_CONFIG_PATH}": ${e.message}`,
          path: VIBE_CONFIG_PATH,
        }),
    );

    return { aliasesAdded, aliasesSkipped, backupPath };
  });
}
