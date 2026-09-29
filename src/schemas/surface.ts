import { Schema } from "effect";

export const SurfaceSchema = Schema.Literal("local", "structural", "product");
export type Surface = Schema.Schema.Type<typeof SurfaceSchema>;
