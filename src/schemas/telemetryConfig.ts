import { Schema } from "effect";

export const TelemetryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
});

export type TelemetryConfig = Schema.Schema.Type<typeof TelemetryConfigSchema>;

export const decodeTelemetryConfig = Schema.decodeUnknownResult(TelemetryConfigSchema, {
  onExcessProperty: "error",
});
