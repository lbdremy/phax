import { Schema } from "effect";
import type { PlanStatus, SpecStatus } from "../domain/artifact/status.js";

export const SpecStatusSchema = Schema.Union(
  Schema.Literal("Draft"),
  Schema.Literal("Approved"),
  Schema.Literal("Abandoned"),
  Schema.Literal("Archived"),
);

export const PlanStatusSchema = Schema.Union(
  Schema.Literal("Draft"),
  Schema.Literal("Approved"),
  Schema.Literal("Stale"),
  Schema.Literal("Abandoned"),
  Schema.Literal("Archived"),
);

type SpecStatusSchemaType = Schema.Schema.Type<typeof SpecStatusSchema>;
type PlanStatusSchemaType = Schema.Schema.Type<typeof PlanStatusSchema>;

// Compile-time check: the schema types must stay in sync with the domain types.
type AssertSpecStatus = SpecStatusSchemaType extends SpecStatus
  ? SpecStatus extends SpecStatusSchemaType
    ? true
    : never
  : never;
const assertSpecStatus: AssertSpecStatus = true as const;
void assertSpecStatus;

type AssertPlanStatus = PlanStatusSchemaType extends PlanStatus
  ? PlanStatus extends PlanStatusSchemaType
    ? true
    : never
  : never;
const assertPlanStatus: AssertPlanStatus = true as const;
void assertPlanStatus;

export const decodeSpecStatus = Schema.decodeUnknownEither(SpecStatusSchema);
export const decodePlanStatus = Schema.decodeUnknownEither(PlanStatusSchema);
