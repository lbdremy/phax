import type { Parsed, PhaseRecordManifest } from "../../packages/schemas/src/index.js";
import { parsePhaseRecordManifest } from "../../packages/schemas/src/index.js";
import type { RunRecordManifest } from "../../src/schemas/runRecord.js";

// The package's PhaseRecordManifest is phax's RunRecordManifest, both ways (§5.20)
declare const fromPackage: PhaseRecordManifest;
declare const fromPhax: RunRecordManifest;
const packageToPhax: RunRecordManifest = fromPackage;
const phaxToPackage: PhaseRecordManifest = fromPhax;
void packageToPhax;
void phaxToPackage;

// parsePhaseRecordManifest returns Parsed<PhaseRecordManifest>
const parsed: Parsed<PhaseRecordManifest> = parsePhaseRecordManifest({});
void parsed;

// Its success value is exactly PhaseRecordManifest
if (parsed.ok) {
  const value: PhaseRecordManifest = parsed.value;
  void value;
  // @ts-expect-error: a success carries no error
  void parsed.error;
} else {
  const path: string = parsed.error.path;
  const message: string = parsed.error.message;
  void path;
  void message;
  // @ts-expect-error: a failure carries no value
  void parsed.value;
}

type SuccessValue = Extract<ReturnType<typeof parsePhaseRecordManifest>, { ok: true }>["value"];
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const successIsManifest: Equals<SuccessValue, PhaseRecordManifest> = true;
void successIsManifest;

// Parsed is readonly throughout
declare const failure: Extract<Parsed<PhaseRecordManifest>, { ok: false }>;
// @ts-expect-error: path is readonly
failure.error.path = "outcome";
