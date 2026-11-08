// A file already written for Effect 4: the schema constructors whose names did not change,
// called in their v4 shape. The codemod reports none of them as a v3 leftover.
import { Schema } from "effect";

export const Kind = Schema.Literal("spec");
export const Shape = Schema.Union([Schema.String, Schema.Number]);
export const Pair = Schema.Tuple([Schema.String, Schema.Number]);
export const Table = Schema.Record(Schema.String, Schema.Number);
