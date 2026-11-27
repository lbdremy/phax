// The pure rules of phax's home: what it is, the files it holds and the refusal of an invalid
// PHAX_HOME. Resolving it (reading PHAX_HOME and the user's home) is src/app/phaxHome.ts's.
import { join } from "node:path";

/** The directory phax keeps its own files in, and where that came from. */
export interface PhaxHome {
  readonly path: string;
  readonly from: "PHAX_HOME" | "default";
}

/** The files phax reads from its home. */
type PhaxHomeFileName = "config.json" | "providers.json" | "model-routing.json" | "telemetry.json";

/** The absolute path of `name` inside `home`. */
export function phaxHomeFile(home: PhaxHome, name: PhaxHomeFileName): string {
  return join(home.path, name);
}

/** The line a command says on stderr when PHAX_HOME moved the home; nothing for the default. */
export function phaxHomeNotice(home: PhaxHome): string | undefined {
  return home.from === "PHAX_HOME" ? `phax home: ${home.path} (PHAX_HOME)` : undefined;
}

/** The refusal of a PHAX_HOME that is not an absolute path to a directory. */
export function invalidPhaxHomeMessage(value: string): string {
  return `PHAX_HOME must be an absolute path to a directory, got "${value}"`;
}
