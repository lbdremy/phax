// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";
import {
  readSourceSpecCriteria,
  readSpecCriteria,
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
  sourceSpec === null
    ? "---\nstatus: Draft\nsource-spec: null\n---\n# Plan\n"
    : `---\nstatus: Draft\nsource-spec: ${sourceSpec}\ncompletes-spec: true\n---\n# Plan\n`;

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

// A FileSystem whose every call fails the test: the path guard runs before any.
const NO_FS_CALL = Layer.succeed(
  FileSystem,
  new Proxy({} as FileSystemOps, {
    get: (_target, method) => () => {
      throw new Error(`unexpected FileSystem call: ${String(method)}`);
    },
  }),
);

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

  it.each([
    ["a path climbing out of the repository", "../../elsewhere/2610231100-invoice-export.md"],
    ["an absolute path", "/etc/2610231100-invoice-export.md"],
    ["a repository path that is not a spec path", "src/2610231100-invoice-export.md"],
    ["a spec path climbing back out", "docs/specs/../../../etc/2610231100-invoice-export.md"],
    ["a spec path with a dot segment", "docs/specs/./2610231100-invoice-export.md"],
  ])("refuses %s before any filesystem call", async (_case, path) => {
    const result = await Effect.runPromise(
      readSourceSpecCriteria({ planMd: planMd(path), repoRoot: REPO_ROOT }).pipe(
        Effect.provide(NO_FS_CALL),
      ),
    );
    expect(result).toEqual({
      kind: "no-criterion-ids",
      spec: path,
      reason: "not-a-spec-path",
      message: `source spec ${path} is not a spec path under docs/specs/: no criterion id is checked`,
    });
  });

  it("gives the same refusal to a spec path read on its own, as authoring reads it", async () => {
    const result = await Effect.runPromise(
      readSpecCriteria({ specPath: "../x/2610231100-invoice-export.md", repoRoot: REPO_ROOT }).pipe(
        Effect.provide(NO_FS_CALL),
      ),
    );
    expect(result).toMatchObject({ kind: "no-criterion-ids", reason: "not-a-spec-path" });
  });

  it("reads each criterion's id and name for a spec path read on its own", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(`${REPO_ROOT}/${SPEC}`, "# Spec\n");
    fs.impl.setFile(`${REPO_ROOT}/${SPEC_JSON}`, specJson(["ac-b", "ac-a"]));
    const result = await Effect.runPromise(
      readSpecCriteria({ specPath: SPEC, repoRoot: REPO_ROOT }).pipe(Effect.provide(fs.layer)),
    );
    expect(result).toEqual({
      kind: "criteria",
      spec: SPEC,
      slug: "invoice-export",
      criteria: [
        { id: "ac-b", name: "Criterion ac-b" },
        { id: "ac-a", name: "Criterion ac-a" },
      ],
    });
  });

  // A block that does not decode is never read in part: its source-spec is not taken.
  it("names a frontmatter that does not decode, and reads no spec", async () => {
    const plan = `---\nsource-spec: ${SPEC}\ncompletes-spec: true\n---\n# Plan\n`;
    const result = await Effect.runPromise(
      readSourceSpecCriteria({ planMd: plan, repoRoot: REPO_ROOT }).pipe(
        Effect.provide(NO_FS_CALL),
      ),
    );
    expect(result).toEqual({
      kind: "frontmatter-undecodable",
      problem: "status: is missing",
      message:
        "the plan's frontmatter does not decode (status: is missing): no source spec is read, no criterion id is checked",
    });
  });

  it("names invalid YAML in brief, on one line", async () => {
    const result = await read("---\nstatus: [\n---\n# Plan\n", {});
    expect(result).toMatchObject({ kind: "frontmatter-undecodable" });
    const { problem } = result as { problem: string };
    expect(problem).toMatch(/^invalid YAML: /);
    expect(problem).not.toContain("\n");
  });

  it("reads a plan with no frontmatter block as a plan without a source spec", async () => {
    expect(await read("# Plan\n", {})).toEqual({ kind: "no-source-spec" });
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
