import type { Effect } from "effect";
import type { planOverview } from "../../src/app/planOverview.js";
import type { Backend } from "../../src/ports/backend.js";
import type { FileSystem } from "../../src/ports/fs.js";
import type { Shell } from "../../src/ports/shell.js";

// The overview reads on the file system and the shell alone: it can reach no
// model, because no Backend is in its requirements.
type Requirements = Effect.Effect.Context<ReturnType<typeof planOverview>>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const requiresExactlyFileSystemAndShell: Equal<Requirements, FileSystem | Shell> = true;

// @ts-expect-error: the overview must not require a Backend
const requiresBackend: Equal<Requirements, FileSystem | Shell | Backend> = true;

void requiresExactlyFileSystemAndShell;
void requiresBackend;
