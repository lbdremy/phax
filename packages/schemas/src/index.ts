import {
  RunRecordManifestSchema,
  decodeRunRecordManifest,
  type RunRecordManifest,
} from "../../../src/schemas/runRecord.js";
import { fromEither, type Parsed } from "./parsed.js";

export type { Parsed };

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestSchema;
export type PhaseRecordManifest = RunRecordManifest;

/** Reads a phase record manifest with phax's own decoder. Never throws. */
export const parsePhaseRecordManifest = (input: unknown): Parsed<PhaseRecordManifest> =>
  fromEither(decodeRunRecordManifest(input));
