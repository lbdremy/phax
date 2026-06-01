import { Schema } from "effect";
import {
  ModelFamilySchema,
  ProviderIdSchema,
  RelationshipSchema,
  RoutingTierSchema,
  ThinkingLevelSchema,
} from "../../src/schemas/modelRouting.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingTier,
  ThinkingLevel,
} from "../../src/domain/routing/types.js";

// Compile-time guard: the literal domain unions in src/domain/routing/types.ts
// and the schema literal members in src/schemas/modelRouting.ts must stay in
// sync (both directions). If either side drifts, this file fails typecheck.

type SchemaProviderId = Schema.Schema.Type<typeof ProviderIdSchema>;
type SchemaModelFamily = Schema.Schema.Type<typeof ModelFamilySchema>;
type SchemaThinkingLevel = Schema.Schema.Type<typeof ThinkingLevelSchema>;
type SchemaRoutingTier = Schema.Schema.Type<typeof RoutingTierSchema>;
type SchemaRelationship = Schema.Schema.Type<typeof RelationshipSchema>;

// schema → domain literal samples
const p1: ProviderId = "claude-code" satisfies SchemaProviderId;
const f1: ModelFamily = "claude-sonnet" satisfies SchemaModelFamily;
const t1: ThinkingLevel = "medium" satisfies SchemaThinkingLevel;
const r1: RoutingTier = "standard" satisfies SchemaRoutingTier;
const rel1: Relationship = "exact" satisfies SchemaRelationship;

// domain → schema literal samples
const p2: SchemaProviderId = "claude-code" satisfies ProviderId;
const f2: SchemaModelFamily = "claude-sonnet" satisfies ModelFamily;
const t2: SchemaThinkingLevel = "medium" satisfies ThinkingLevel;
const r2: SchemaRoutingTier = "standard" satisfies RoutingTier;
const rel2: SchemaRelationship = "exact" satisfies Relationship;

// Exhaustiveness: assigning the full union both ways forces the compiler to
// reject either side adding/removing a literal.
declare const allProviderIds: ProviderId;
declare const allFamilies: ModelFamily;
declare const allThinking: ThinkingLevel;
declare const allTiers: RoutingTier;
declare const allRelationships: Relationship;

const exhaustP: SchemaProviderId = allProviderIds;
const exhaustF: SchemaModelFamily = allFamilies;
const exhaustT: SchemaThinkingLevel = allThinking;
const exhaustR: SchemaRoutingTier = allTiers;
const exhaustRel: SchemaRelationship = allRelationships;

declare const schemaProviderId: SchemaProviderId;
declare const schemaFamily: SchemaModelFamily;
declare const schemaThinking: SchemaThinkingLevel;
declare const schemaTier: SchemaRoutingTier;
declare const schemaRel: SchemaRelationship;

const exhaustPBack: ProviderId = schemaProviderId;
const exhaustFBack: ModelFamily = schemaFamily;
const exhaustTBack: ThinkingLevel = schemaThinking;
const exhaustRBack: RoutingTier = schemaTier;
const exhaustRelBack: Relationship = schemaRel;

void p1;
void f1;
void t1;
void r1;
void rel1;
void p2;
void f2;
void t2;
void r2;
void rel2;
void exhaustP;
void exhaustF;
void exhaustT;
void exhaustR;
void exhaustRel;
void exhaustPBack;
void exhaustFBack;
void exhaustTBack;
void exhaustRBack;
void exhaustRelBack;
