import type {
  LatestPhaseRecordManifest,
  Parsed,
  ParsedShape,
  PhaseRecordManifest,
  PhaseRecordManifestShape,
  PhaseRecordManifestV1,
  PhaseRecordManifestV2,
  Unknown,
} from "../../packages/schemas/src/index.js";
import { parsePhaseRecordManifest } from "../../packages/schemas/src/index.js";
import type { RunRecordManifest } from "../../src/schemas/runRecord.js";
import type { Surface } from "../../src/schemas/surface.js";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The package's PhaseRecordManifest is phax's RunRecordManifest, both ways (§5.20)
declare const fromPackage: PhaseRecordManifest;
declare const fromPhax: RunRecordManifest;
const packageToPhax: RunRecordManifest = fromPackage;
const phaxToPackage: PhaseRecordManifest = fromPhax;
void packageToPhax;
void phaxToPackage;

// The frozen v2 twin has exactly the type phax writes today
const v2IsCurrent: Equals<PhaseRecordManifestV2, PhaseRecordManifest> = true;
void v2IsCurrent;

// parsePhaseRecordManifest is a union over shapes, assignable to Parsed over their values
const parsed = parsePhaseRecordManifest({});
const asParsed: Parsed<PhaseRecordManifestV1 | PhaseRecordManifest> = parsed;
void asParsed;

// Narrowing on the shape id yields that shape's exact type
if (parsed.ok) {
  const shape: PhaseRecordManifestShape = parsed.shape;
  void shape;
  if (parsed.shape === "v1") {
    const value: PhaseRecordManifestV1 = parsed.value;
    const exact: Equals<typeof parsed.value, PhaseRecordManifestV1> = true;
    void value;
    void exact;
  } else {
    const value: PhaseRecordManifest = parsed.value;
    const exact: Equals<typeof parsed.value, PhaseRecordManifest> = true;
    void value;
    void exact;
  }
  // @ts-expect-error: a success carries no error
  void parsed.error;
} else {
  const path: string = parsed.error.path;
  const message: string = parsed.error.message;
  void path;
  void message;
  // @ts-expect-error: a failure carries no value
  void parsed.value;
  // @ts-expect-error: a failure carries no shape
  void parsed.shape;
}

type Success = Extract<ReturnType<typeof parsePhaseRecordManifest>, { ok: true }>;
const shapeIds: Equals<Success["shape"], "v1" | "v2"> = true;
const successValues: Equals<Success["value"], PhaseRecordManifestV1 | PhaseRecordManifest> = true;
void shapeIds;
void successValues;

// ParsedShape over any map is assignable to Parsed over its values
type Toy = { v1: { a: 1 }; "0.10.0": { b: 2 }; next: { c: 3 } };
declare const toy: ParsedShape<Toy>;
const toyAsParsed: Parsed<Toy[keyof Toy]> = toy;
void toyAsParsed;

// Parsed is readonly throughout
declare const failure: Extract<Parsed<PhaseRecordManifest>, { ok: false }>;
// @ts-expect-error: path is readonly
failure.error.path = "outcome";

// The latest manifest drops version, marks what v1 never recorded, keeps the rest
declare const latest: LatestPhaseRecordManifest;
// @ts-expect-error: the latest manifest carries no version
void latest.version;
const surfaces: Equals<
  LatestPhaseRecordManifest["verifiedSurfaces"],
  ReadonlyArray<Surface> | Unknown
> = true;
void surfaces;
const addedInV2: Equals<
  Exclude<keyof PhaseRecordManifest, keyof PhaseRecordManifestV1>,
  "verifiedSurfaces"
> = true;
void addedInV2;
const sameFields: Equals<
  Omit<LatestPhaseRecordManifest, "verifiedSurfaces">,
  Omit<PhaseRecordManifest, "version" | "verifiedSurfaces">
> = true;
void sameFields;
