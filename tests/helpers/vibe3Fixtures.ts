// Recorded Vibe 3.0.3 output, from the 2026-10-27 probe. Each headless turn
// writes an `export.json` into its `--output-dir`; its usage and cost count
// that turn only, and its keys beyond the ones phax reads (`limits`, `config`,
// `steps`, `journal_dir`, the timestamps) are carried here as Vibe wrote them.

/** The session both probe turns ran in: the second resumed the first. */
export const VIBE3_SESSION_ID = "b8e0e3a1-9ad8-2100-46e7-4a199256f640";

interface Vibe3Export {
  readonly schema_version: 1;
  readonly session_id: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cached_input_tokens: number;
    readonly total_tokens: number;
  };
  readonly cost_usd: number;
  readonly outcome: string;
  readonly exit_code: number;
  readonly vibe_version: string;
  readonly [extra: string]: unknown;
}

function vibe3Export(
  usage: { readonly input: number; readonly cached: number; readonly output: number },
  costUsd: number,
  startedAt: string,
): Vibe3Export {
  return {
    schema_version: 1,
    session_id: VIBE3_SESSION_ID,
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cached_input_tokens: usage.cached,
      total_tokens: usage.input + usage.output,
    },
    cost_usd: costUsd,
    outcome: "finished",
    exit_code: 0,
    vibe_version: "3.0.3",
    started_at: startedAt,
    limits: { max_turns: null, max_price: null },
    config: { active_model: "mistral-medium-3.5" },
    steps: 2,
    journal_dir: "journal",
  };
}

/** The probe's first turn: 10987 input tokens, 3200 of them cached, 3 output, at $0.016503. */
export const VIBE3_EXPORT_SHORT = vibe3Export(
  { input: 10987, cached: 3200, output: 3 },
  0.016503,
  "2026-10-27T09:14:02.118Z",
);

/** The probe's second turn, a resume of the first: 34588 input, 9600 cached, 288 output, at $0.054042. */
export const VIBE3_EXPORT_LONG = vibe3Export(
  { input: 34588, cached: 9600, output: 288 },
  0.054042,
  "2026-10-27T09:14:31.902Z",
);

/** An export as Vibe writes it to `export.json`. */
export function vibe3ExportText(exported: Vibe3Export): string {
  return `${JSON.stringify(exported, null, 2)}\n`;
}
