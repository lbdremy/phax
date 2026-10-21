import { Schema } from "effect";

export const SurfaceSchema = Schema.Literal("local", "structural", "product");
export type Surface = Schema.Schema.Type<typeof SurfaceSchema>;

/**
 * The surface a recorded step carries: a configured one, or `oracle`, carried
 * only by the step phax appends for an oracle pair. A configured gate step
 * keeps `SurfaceSchema`, so `"surface": "oracle"` in phax.json stays refused.
 */
export const RecordedSurfaceSchema = Schema.Literal("local", "structural", "product", "oracle");
export type RecordedSurface = Schema.Schema.Type<typeof RecordedSurfaceSchema>;
