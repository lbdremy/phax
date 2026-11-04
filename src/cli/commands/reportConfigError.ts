import type { OutputPort } from "../../ports/output.js";
import type { ConfigValidationError } from "../../domain/errors.js";

/** The lines an invalid configuration is reported with: the error, the file it names (when it
 *  names one), and how to fix it. */
function configErrorLines(err: ConfigValidationError): ReadonlyArray<string> {
  return [
    `Config error: ${err.message}`,
    ...(err.path ? [`  at: ${err.path}`] : []),
    `Fix the reported field(s) in phax.json, or in the overlay the error names (phax.local.json or ~/.phax/config.json), then run \`phax validate\` to recheck. ` +
      `If your editor isn't flagging this, run \`phax schema upgrade\` to refresh the local schema.`,
  ];
}

/** The same lines as one text, for a declared error's sentence. */
export function configErrorText(err: ConfigValidationError): string {
  return configErrorLines(err).join("\n");
}

export function reportConfigError(err: ConfigValidationError, out: OutputPort): void {
  for (const line of configErrorLines(err)) out.error(line);
}
