// Properties of the persisted formats (spec property-tests §5.1 to §5.6): every format of the
// ledger has a registered generator, and reads the written encoding of any valid current-shape
// value back to the value written.
import { existsSync, readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../../src/schemas/release.js";
import { FORMAT_IDS, compareReleases, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import {
  FORMAT_REGISTRY,
  RELEASE_LEDGER,
  missingGenerators,
} from "../../helpers/property/formatRegistry.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import {
  anyJson,
  mutatedValid,
  newerBody,
  newerStamped,
  stampedObject,
} from "../../helpers/property/jsonInputs.js";

const withoutSchema = (value: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const { $schema: _schema, ...rest } = value;
  return rest;
};

// The first path where `read` departs from `written`, for the failure report.
const firstDifference = (written: unknown, read: unknown, path = ""): string | undefined => {
  if (isDeepStrictEqual(written, read)) return undefined;
  const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null;
  if (!isRecord(written) || !isRecord(read) || Array.isArray(written) !== Array.isArray(read)) {
    return `${path || "(root)"}: wrote ${JSON.stringify(written)}, read ${JSON.stringify(read)}`;
  }
  for (const key of new Set([...Object.keys(written), ...Object.keys(read)])) {
    const found = firstDifference(written[key], read[key], `${path}/${key}`);
    if (found !== undefined) return found;
  }
  return `${path || "(root)"}: differs beyond its own keys`;
};

// A ReadVerdict: `ok: true` with a value, or `ok: false` with a message.
const isVerdict = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { ok, message } = value as { readonly ok?: unknown; readonly message?: unknown };
  return ok === true ? "value" in value : ok === false && typeof message === "string";
};

// ── agreement exceptions ────────────────────────────────────────────────────

interface AgreementException {
  readonly format: FormatId;
  /** Kebab-case, stating the rule. */
  readonly name: string;
  /** Which reader enforces the rule, and why the other does not. */
  readonly reason: string;
  readonly matches: (document: unknown) => boolean;
}

const isDocument = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The deliberate disagreements, each as narrow as the rule it names. A disagreement that is a
// reader bug is fixed in the reader instead of listed here.
const AGREEMENT_EXCEPTIONS: ReadonlyArray<AgreementException> = [
  {
    format: "phase-status",
    name: "awaiting-review-records-a-waiting-stop",
    reason:
      "readPhaseStatusFile refuses a phase awaiting review whose stop is not waiting: a phase enters that state only with its waiting stop recorded. The schema alone holds no such rule, so the package reads it",
    matches: (document) =>
      isDocument(document) &&
      document["state"] === "awaiting_review" &&
      !(isDocument(document["stop"]) && document["stop"]["status"] === "waiting"),
  },
];

describe.each(FORMAT_IDS)("%s", (id) => {
  it("has a generator", () => {
    expect(missingGenerators([id], FORMAT_REGISTRY), `no generator registered for ${id}`).toEqual(
      [],
    );
  });

  it(
    "reads its written encoding back",
    () => {
      const entry = FORMAT_REGISTRY[id];
      const read = entry.phax?.read ?? entry.parse;
      checkProperty(entry.valid(), (value) => {
        const verdict = read(entry.write(value));
        if (!verdict.ok) throw new Error(`refused: ${verdict.message}`);
        const difference = firstDifference(withoutSchema(value), verdict.value);
        if (difference !== undefined) throw new Error(`read back differs at ${difference}`);
        return true;
      });
    },
    propertyTimeout(),
  );

  it(
    "never throws on any JSON",
    () => {
      const entry = FORMAT_REGISTRY[id];
      const readers = [
        ...(entry.phax === null ? [] : [{ name: "phax", read: entry.phax.read }]),
        { name: "package", read: entry.parse },
      ];
      checkProperty(fc.oneof(anyJson(), stampedObject(id), mutatedValid(entry)), (input) => {
        for (const { name, read } of readers) {
          let verdict: unknown;
          try {
            verdict = read(input);
          } catch (error) {
            throw new Error(`the ${name} reader threw: ${String(error)}`, { cause: error });
          }
          if (!isVerdict(verdict)) throw new Error(`the ${name} reader answered no verdict`);
        }
        return true;
      });
    },
    propertyTimeout(),
  );

  it(
    "refuses a newer stamp whatever the body",
    () => {
      const entry = FORMAT_REGISTRY[id];
      const readers = [
        ...(entry.phax === null
          ? []
          : [{ name: "phax", running: PHAX_RELEASE as string, read: entry.phax.read }]),
        { name: "package", running: PACKAGE_VERSION as string, read: entry.parse },
      ];
      for (const { name, running, read } of readers) {
        checkProperty(newerStamped(id, running, newerBody(entry)), ({ release, document }) => {
          const verdict = read(document);
          if (verdict.ok) throw new Error(`the ${name} reader read a document stamped ${release}`);
          if (!verdict.message.includes(release)) {
            throw new Error(
              `the ${name} reader's refusal does not name ${release}: ${verdict.message}`,
            );
          }
          return true;
        });
      }
    },
    propertyTimeout(),
  );

  it.skipIf(FORMAT_REGISTRY[id].frozen.length === 0)(
    "reads every frozen shape",
    () => {
      const entry = FORMAT_REGISTRY[id];
      const written = fc
        .constantFrom(...entry.frozen)
        .chain((frozen) => frozen.stamped().map((stamped) => ({ frozen, ...stamped })));
      checkProperty(written, ({ frozen, release, document }) => {
        const label = `${frozen.shape} document stamped ${release ?? "(none)"}`;
        const packaged = entry.parse(document);
        if (!packaged.ok) throw new Error(`the package refused a ${label}: ${packaged.message}`);
        if (packaged.shape !== frozen.shape) {
          throw new Error(`the package read a ${label} as ${String(packaged.shape)}`);
        }
        if (frozen.readers === "both" && entry.phax !== null) {
          const verdict = (entry.phax.readFile ?? entry.phax.read)(document);
          if (!verdict.ok) throw new Error(`phax refused a ${label}: ${verdict.message}`);
          if (verdict.shape !== undefined && verdict.shape !== frozen.shape) {
            throw new Error(`phax read a ${label} as ${verdict.shape}`);
          }
        }
        return true;
      });
    },
    propertyTimeout(),
  );

  it.skipIf(FORMAT_REGISTRY[id].phax === null)(
    "reaches the schemas package's verdict",
    () => {
      const entry = FORMAT_REGISTRY[id];
      const phax = entry.phax?.read;
      if (phax === undefined) return;
      const documents = fc.oneof(
        entry.valid().map(entry.write),
        anyJson(),
        stampedObject(id),
        mutatedValid(entry),
      );
      checkProperty(documents, (document) => {
        const packaged = entry.parse(document);
        const read = phax(document);
        if (read.ok === packaged.ok) return true;
        if (AGREEMENT_EXCEPTIONS.some((e) => e.format === id && e.matches(document))) return true;
        const refusal = read.ok ? packaged : read;
        const who = read.ok
          ? "phax read it and the package refused"
          : "the package read it and phax refused";
        throw new Error(`${who}: ${refusal.ok ? "" : refusal.message}`);
      });
    },
    propertyTimeout(),
  );

  it("registers a frozen shape for every module of its history", () => {
    const directory = new URL(`../../../src/schemas/history/${id}/`, import.meta.url);
    const modules = existsSync(directory)
      ? readdirSync(directory)
          .filter((file) => file.endsWith(".ts"))
          .map((file) => file.slice(0, -".ts".length))
      : [];
    const registered = FORMAT_REGISTRY[id].frozen.map((frozen) => frozen.shape);
    for (const module of modules) {
      expect(registered, `no frozen shape registered for ${id} ${module}`).toContain(module);
    }
    expect(
      registered.filter((shape) => !modules.includes(shape)),
      `${id} registers a frozen shape with no module under src/schemas/history/${id}/`,
    ).toEqual([]);
  });
});

// ── repairs ─────────────────────────────────────────────────────────────────
// Each repair of the registry, on a hand-written value its schema (or its entry's derivation)
// admits and phax's reader refuses: the reader's refusal, then the repaired value read.

type Document = Readonly<Record<string, unknown>>;

const phaxReader = (id: FormatId) => {
  const read = FORMAT_REGISTRY[id].phax?.read;
  if (read === undefined) throw new Error(`${id} has no phax reader`);
  return read;
};

const repairNamed = (id: FormatId, name: string): ((value: Document) => Document) => {
  const found = FORMAT_REGISTRY[id].repairs.find((repair) => repair.name === name);
  if (found === undefined) throw new Error(`${id} registers no repair named ${name}`);
  return found.repair;
};

const SHA = "0123456789abcdef0123456789abcdef01234567";

const runStatus: Document = {
  namespace: "phax",
  shortName: "demo",
  runId: "run-1",
  state: "running",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  phasesCount: Number.POSITIVE_INFINITY,
  hold: { selection: "none" },
};

const phaseStatus: Document = {
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "awaiting_review",
  model: "claude-opus-5-5",
  effort: "high",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  branchName: "phax/demo--phase-01",
  base: SHA,
  mode: "headless",
  stop: null,
};

const option = (id: string) => ({ id, label: `Option ${id}`, abandons: `What ${id} gives up` });

const openQuestion = (id: string, recommendation = "a") => ({
  id,
  question: "Which one?",
  options: [option("a"), option("b")],
  recommendation,
  rationale: "Because.",
});

const specDocument: Document = {
  kind: "spec",
  title: "Demo",
  ground: [],
  context: "Context.",
  problem: "Problem.",
  productGoal: { statement: "Goal.", guidingRule: "Rule." },
  terminology: [],
  requirements: [{ id: "R1", title: "One", pattern: "event", statement: "It does one thing." }],
  surface: [],
  nonGoals: [],
  acceptanceCriteria: [
    // Given/when/then is the criterion's shape; the key is data, never awaited.
    // eslint-disable-next-line unicorn/no-thenable
    { id: "AC1", name: "One", given: "Given.", when: "When.", then: "Then.", refs: ["R1"] },
  ],
  openQuestions: [],
  arbitratedQuestions: [],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "Internal." },
};

const planDocument: Document = {
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: "demo", title: "Demo", requiredCommands: [], gateProfile: "standard" },
  preamble: {
    summary: "Summary.",
    requiredCommandsNote: "None.",
    technicalArbitrations: [],
    openQuestions: [],
    arbitratedQuestions: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "One",
      objective: "Objective.",
      detailedInstructions: [],
      planMarkdownAnchor: "#phase-01",
      plannedFilesToCreate: ["src/one.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      mode: "headless",
      acceptance: null,
      boundaryContracts: null,
      testStrategy: [],
      implementationOrder: [],
      excludedScope: [],
      verification: "The standard gate.",
      expectedHandoff: "A handoff.",
      commit: { subject: "feat: one", body: "One." },
      assignmentReason: null,
      model: "claude-opus-5-5",
      effort: "high",
    },
  ],
};

const expectRepaired = (
  id: FormatId,
  name: string,
  value: Document,
  refusal: string,
  written: (value: Document) => unknown = (document) => withSchemaUrl(id, document),
) => {
  const read = phaxReader(id);
  const before = read(written(value));
  expect(before.ok).toBe(false);
  expect(before.ok ? "" : before.message).toContain(refusal);
  const repaired = repairNamed(id, name)(value);
  const after = read(written(repaired));
  expect(after.ok ? after.value : after.message).toStrictEqual(repaired);
};

describe("repairs", () => {
  it("numbers-are-json-numbers: a number JSON cannot carry is never written", () => {
    expectRepaired(
      "run-status",
      "numbers-are-json-numbers",
      runStatus,
      "phasesCount: Expected number, actual null",
      FORMAT_REGISTRY["run-status"].write,
    );
  });

  it("awaiting-review-records-a-waiting-stop: a phase awaiting review records its stop", () => {
    expectRepaired(
      "phase-status",
      "awaiting-review-records-a-waiting-stop",
      phaseStatus,
      "a phase awaiting review records no waiting stop",
    );
  });

  it("questions-pass-the-question-checks: a spec's question ids are unique", () => {
    expectRepaired(
      "spec-document",
      "questions-pass-the-question-checks",
      { ...specDocument, openQuestions: [openQuestion("q1"), openQuestion("q1")] },
      `"q1" duplicates the question id`,
    );
  });

  it("questions-pass-the-question-checks: a plan's recommendation names one of its options", () => {
    expectRepaired(
      "plan-document",
      "questions-pass-the-question-checks",
      {
        ...planDocument,
        preamble: {
          ...(planDocument["preamble"] as Document),
          openQuestions: [openQuestion("q1", "c")],
        },
      },
      `"c" names none of the question's options`,
    );
  });

  it("requirements-are-traced: every requirement is referenced by a criterion", () => {
    expectRepaired(
      "spec-document",
      "requirements-are-traced",
      {
        ...specDocument,
        requirements: [
          ...(specDocument["requirements"] as ReadonlyArray<Document>),
          { id: "R2", title: "Two", pattern: "event", statement: "It does another thing." },
        ],
      },
      `"R2" is referenced by no acceptance criterion`,
    );
  });

  it("lineage-pairs-source-spec-and-completes-spec: no completion beside no source spec", () => {
    expectRepaired(
      "plan-document",
      "lineage-pairs-source-spec-and-completes-spec",
      { ...planDocument, sourceSpec: "docs/specs/demo.md", completesSpec: null },
      "completesSpec is a boolean beside a sourceSpec path",
    );
  });
});

// ── agreement exceptions ────────────────────────────────────────────────────
// A hand-written document each exception matches, and the verdicts that differ as its reason says.

const AGREEMENT_EXAMPLES: Readonly<
  Record<string, { readonly document: unknown; readonly phaxRefuses: string }>
> = {
  "awaiting-review-records-a-waiting-stop": {
    document: FORMAT_REGISTRY["phase-status"].write(phaseStatus),
    phaxRefuses: "a phase awaiting review records no waiting stop",
  },
};

describe("agreement exceptions", () => {
  it("every exception has an example, and every example an exception", () => {
    expect(Object.keys(AGREEMENT_EXAMPLES).toSorted()).toEqual(
      AGREEMENT_EXCEPTIONS.map((exception) => exception.name).toSorted(),
    );
  });

  it.each(AGREEMENT_EXCEPTIONS)("$format $name: $reason", (exception) => {
    const entry = FORMAT_REGISTRY[exception.format];
    const example = AGREEMENT_EXAMPLES[exception.name];
    if (example === undefined) throw new Error(`no example for ${exception.name}`);
    expect(exception.matches(example.document)).toBe(true);
    const phax = entry.phax?.read(example.document);
    const packaged = entry.parse(example.document);
    expect(phax?.ok).toBe(false);
    expect(phax?.ok === false ? phax.message : "").toContain(example.phaxRefuses);
    expect(packaged.ok).toBe(true);
  });

  it("awaiting-review-records-a-waiting-stop: a waiting stop is no exception, and both read it", () => {
    const entry = FORMAT_REGISTRY["phase-status"];
    const waiting = entry.write({ ...phaseStatus, stop: { cause: "held", status: "waiting" } });
    const exception = AGREEMENT_EXCEPTIONS.find(
      ({ name }) => name === "awaiting-review-records-a-waiting-stop",
    );
    expect(exception?.matches(waiting)).toBe(false);
    expect(entry.phax?.read(waiting).ok).toBe(true);
    expect(entry.parse(waiting).ok).toBe(true);
  });
});

describe("frozen stamp ranges", () => {
  const releasesOf = (shape: string): ReadonlyArray<string> | undefined =>
    FORMAT_REGISTRY["run-status"].frozen.find((frozen) => frozen.shape === shape)?.releases;

  it("run-status: a shape holds the releases between it and the next shape", () => {
    expect(releasesOf("pre-schema")).toEqual([]);
    expect(releasesOf("0.17.0")).toEqual([
      "0.17.0",
      "0.18.0",
      "0.19.0",
      "0.20.0",
      "0.21.0",
      "0.22.0",
      "0.23.0",
      "0.24.0",
      "0.25.0",
    ]);
    // The last frozen shape runs up to the format's current stamp, read at run time.
    expect(releasesOf("0.26.0")).toEqual(
      RELEASE_LEDGER.filter(
        (release) =>
          compareReleases(release, "0.26.0") >= 0 &&
          compareReleases(release, CURRENT_STAMPS["run-status"]) < 0,
      ),
    );
  });
});

describe("missingGenerators", () => {
  it("returns a ledger id the registry lacks", () => {
    expect(missingGenerators([...FORMAT_IDS, "made-up-format"], FORMAT_REGISTRY)).toEqual([
      "made-up-format",
    ]);
  });
});
