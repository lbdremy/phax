import { Schema } from "effect";

export const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

export type ProviderId = Schema.Schema.Type<typeof ProviderIdSchema>;
