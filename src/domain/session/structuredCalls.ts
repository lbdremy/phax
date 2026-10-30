import type { ProviderId } from "../routing/types.js";

/** The eight calls that ask a provider for a structured answer. */
export type StructuredCallId =
  | "authoring"
  | "plan-extraction"
  | "decide-handback"
  | "decide-verdicts"
  | "first-turn"
  | "closing-turn"
  | "code-review"
  | "compliance-review";

/** How each provider receives a call's answer schema: natively, or only in the prompt. */
export type StructuredCallsTable = {
  readonly [C in StructuredCallId]: { readonly claudeCode: "native" | "prompt" };
};

/**
 * Per call, whether Claude Code is handed the answer schema (`--json-schema`)
 * or keeps it in the prompt alone. Every call starts native. When the real-CLI
 * smoke test shows a call's Claude Code combination failing (its `--resume`,
 * its read-only tools, stream-json), flip that call's line to "prompt", along
 * with its row of the docs page's per-provider table; the unit and integration
 * tests follow this table, so nothing else changes. Codex is always native and
 * Mistral Vibe never is.
 */
export const STRUCTURED_CALLS: StructuredCallsTable = {
  authoring: { claudeCode: "native" },
  "plan-extraction": { claudeCode: "native" },
  "decide-handback": { claudeCode: "native" },
  "decide-verdicts": { claudeCode: "native" },
  "first-turn": { claudeCode: "native" },
  "closing-turn": { claudeCode: "native" },
  "code-review": { claudeCode: "native" },
  "compliance-review": { claudeCode: "native" },
};

/** The answer schema a structured call hands to its provider, with the call it belongs to. */
export interface AnswerSchemaRequest {
  readonly call: StructuredCallId;
  readonly schema: object;
}

/** Whether `provider` is handed `call`'s answer schema as a native option. */
export function handsSchemaNatively(
  provider: ProviderId,
  call: StructuredCallId,
  table: StructuredCallsTable,
): boolean {
  switch (provider) {
    case "claude-code":
      return table[call].claudeCode === "native";
    case "codex-cli":
      return true;
    case "mistral-vibe":
      return false;
  }
}

// Claude Code's `--json-schema` is passed to the API as a tool `input_schema`,
// and the API refuses any property key outside `^[a-zA-Z0-9_.-]{1,64}$` with a
// 400 (probed on Claude Code 2.1.314, 2026-10-30). The root `$schema` key
// breaks that rule, so Claude Code is handed each answer schema without it and
// phax sets the stamp on the structured value itself. This is phax's one
// Claude-only transform of an answer schema; Codex and Mistral Vibe receive
// the schema whole.

/**
 * The line appended to a prompt whose Claude Code spawn is handed the schema
 * without its `$schema` property. Prompts still state the whole schema.
 *
 * The Claude Code adapter appends it at spawn time, after the caller has
 * saved its prompt, so a saved prompt (`prompt.md`, `retry-prompt.md`,
 * `handback-prompt.md`, `code-review-prompt.md`) is what Claude Code received
 * less this one closing line whenever the spawn took `--json-schema`. The
 * callers cannot add it themselves: whether a call is handed natively is the
 * backend's table, which tests inject.
 */
export const CLAUDE_STAMP_PROMPT_LINE = "phax sets the answer's `$schema` itself, so leave it out.";

/** The schema without its root `$schema` property, removed from `properties` and from `required`. */
export function claudeAnswerSchema(schema: object): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };
  const properties = result["properties"];
  if (typeof properties === "object" && properties !== null) {
    const { $schema: _stamp, ...kept } = properties as Record<string, unknown>;
    result["properties"] = kept;
  }
  const required = result["required"];
  if (Array.isArray(required)) result["required"] = required.filter((key) => key !== "$schema");
  return result;
}

/**
 * The structured value with `$schema` set first to the `const` of the handed
 * schema's root `$schema` property, which is the call's own format stamp. A
 * value that is not an object is returned as is, for the decoder to refuse.
 */
export function stampStructuredValue(value: unknown, schema: object): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const stamp = stampOf(schema);
  if (stamp === undefined) return value;
  const { $schema: _provided, ...rest } = value as Record<string, unknown>;
  return { $schema: stamp, ...rest };
}

function stampOf(schema: object): unknown {
  const properties = (schema as { readonly properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return undefined;
  const stamp = (properties as Record<string, unknown>)["$schema"];
  if (typeof stamp !== "object" || stamp === null) return undefined;
  return (stamp as { readonly const?: unknown }).const;
}
