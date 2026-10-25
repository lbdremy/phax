// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  readSourceSpecCriteria,
  type SourceSpecCriteria,
} from "../../src/app/sourceSpecCriteria.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeSpecDocumentFile, type SpecDocument } from "../../src/schemas/specDocument.js";

const REPO_ROOT = "/repo";
const SPEC = "docs/specs/2610231100-invoice-export.md";
const SPEC_JSON = "docs/specs/2610231100-invoice-export.json";
const ARCHIVE_SPEC = "docs/specs/archive/2610231100-invoice-export.md";
const ARCHIVE_JSON = "docs/specs/archive/2610231100-invoice-export.json";

const planMd = (sourceSpec: string | null): string =>
  `---\nstatus: Draft\nsource-spec: ${sourceSpec ?? "null"}\ncompletes-spec: ${sourceSpec === null ? "false" : "true"}\n---\n# Plan\n`;

function specJson(criteria: readonly string[]): string {
  const document = {
    kind: "spec",
    title: "Invoice export",
    ground: [],
    context: "Invoices are exported by hand.",
    problem: "Export is manual.",
    productGoal: { statement: "Export invoices.", guidingRule: "One command." },
    terminology: [],
    requirements: [
      {
        id: "R-export",
        title: "Export",
        pattern: "event",
        statement: "WHEN an export is requested THE system SHALL write a file.",
      },
    ],
    surface: [],
    nonGoals: [],
    acceptanceCriteria: criteria.map((id) => ({
      id,
      name: `Criterion ${id}`,
      given: "an invoice",
      when: "it is exported",
      then: "a file is written",
      refs: ["R-export"],
    })),
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "an internal fixture" },
  } as unknown as SpecDocument;
  return JSON.stringify(encodeSpecDocumentFile(withSchemaUrl("spec-document", document)), null, 2);
}

function read(plan: string, files: Readonly<Record<string, string>>): Promise<SourceSpecCriteria> {
  const fs = makeFakeFileSystem();
  for (const [rel, content] of Object.entries(files))
    fs.impl.setFile(`${REPO_ROOT}/${rel}`, content);
  return Effect.runPromise(
    readSourceSpecCriteria({ planMd: plan, repoRoot: REPO_ROOT }).pipe(Effect.provide(fs.layer)),
  );
}

describe("readSourceSpecCriteria", () => {
  it("reads a live spec's ids in spec order", async () => {
    expect(
      await read(planMd(SPEC), { [SPEC]: "# Spec\n", [SPEC_JSON]: specJson(["ac-b", "ac-a"]) }),
    ).toEqual({ kind: "criteria", spec: SPEC, slug: "invoice-export", ids: ["ac-b", "ac-a"] });
  });

  it("falls back to the archived spec and its sidecar", async () => {
    expect(
      await read(planMd(SPEC), {
        [ARCHIVE_SPEC]: "# Spec\n",
        [ARCHIVE_JSON]: specJson(["ac-a"]),
      }),
    ).toEqual({ kind: "criteria", spec: ARCHIVE_SPEC, slug: "invoice-export", ids: ["ac-a"] });
  });

  it("prefers the live spec over the archived one", async () => {
    const result = await read(planMd(SPEC), {
      [SPEC]: "# Spec\n",
      [SPEC_JSON]: specJson(["ac-live"]),
      [ARCHIVE_SPEC]: "# Spec\n",
      [ARCHIVE_JSON]: specJson(["ac-archived"]),
    });
    expect(result).toMatchObject({ kind: "criteria", ids: ["ac-live"] });
  });

  it("says nothing of a plan with no source spec", async () => {
    expect(await read(planMd(null), {})).toEqual({ kind: "no-source-spec" });
  });

  it("names a spec with no sidecar", async () => {
    expect(await read(planMd(SPEC), { [SPEC]: "# Spec\n" })).toEqual({
      kind: "no-criterion-ids",
      spec: SPEC,
      reason: "no-sidecar",
      message: `source spec ${SPEC} has no JSON sidecar: no criterion id is checked`,
    });
  });

  it("names a spec found at neither path", async () => {
    expect(await read(planMd(SPEC), {})).toEqual({
      kind: "no-criterion-ids",
      spec: SPEC,
      reason: "not-found",
      message: `source spec ${SPEC} is not found, here or under docs/specs/archive/: no criterion id is checked`,
    });
  });

  it("names a sidecar that is not JSON", async () => {
    const result = await read(planMd(SPEC), { [SPEC]: "# Spec\n", [SPEC_JSON]: "{ nope" });
    expect(result).toMatchObject({ kind: "no-criterion-ids", spec: SPEC, reason: "unreadable" });
    expect((result as { message: string }).message).toMatch(
      new RegExp(
        `^source spec sidecar ${SPEC_JSON.replaceAll(".", "\\.")} cannot be read \\(.+\\): no criterion id is checked$`,
      ),
    );
  });

  it("names a sidecar the spec schema refuses", async () => {
    const result = await read(planMd(SPEC), { [SPEC]: "# Spec\n", [SPEC_JSON]: "{}" });
    expect(result).toMatchObject({ kind: "no-criterion-ids", reason: "unreadable" });
  });

  it("lifts a sidecar of an older spec shape", async () => {
    const archived = "docs/specs/archive/2610100815-gate-attempt-records";
    const raw = readFileSync(`${archived}.json`, "utf8");
    const expected = (
      JSON.parse(raw) as { acceptanceCriteria: Array<{ id: string }> }
    ).acceptanceCriteria.map((c) => c.id);
    const spec = `${archived}.md`;
    const result = await read(planMd(spec), { [spec]: "# Spec\n", [`${archived}.json`]: raw });
    expect(result).toEqual({
      kind: "criteria",
      spec,
      slug: "gate-attempt-records",
      ids: expected,
    });
  });
});
