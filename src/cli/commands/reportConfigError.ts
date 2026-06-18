import type { OutputPort } from "../../ports/output.js";
import type { ConfigValidationError } from "../../domain/errors.js";

export function reportConfigError(err: ConfigValidationError, out: OutputPort): void {
  out.error(`Config error: ${err.message}`);
  if (err.path) {
    out.error(`  at: ${err.path}`);
  }
  out.error(
    `Fix the reported field(s) in phax.json, then run \`phax validate\` to recheck. ` +
      `If your editor isn't flagging this, run \`phax schema upgrade\` to refresh the local schema.`,
  );
}
