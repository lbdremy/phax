import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { resolveLandedRun } from "../../src/app/resolveLandedRun.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeRegistryFile, type RegistryEntry } from "../../src/schemas/registry.js";

const STATE_ROOT = "/state";
const NAMESPACE = "acme";
const NOW = "2026-06-01T00:00:00.000Z";

function entry(shortName: string, extra: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    namespace: NAMESPACE,
    shortName,
    runId: `${shortName}-001`,
    state: "archived",
    branch: `phax/${shortName}`,
    projectName: NAMESPACE,
    phasesCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function setup(runs: RegistryEntry[] | undefined) {
  const { impl, layer } = makeFakeFileSystem();
  if (runs !== undefined) {
    impl.setFile(
      `${STATE_ROOT}/registry.json`,
      JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs }))),
    );
  }
  const resolve = (landed: string) =>
    Effect.runPromise(
      resolveLandedRun({ landed, namespace: NAMESPACE, stateRoot: STATE_ROOT }).pipe(
        Effect.either,
        Effect.provide(layer),
      ),
    );
  return { impl, resolve };
}

function expectRefusal(result: Either.Either<unknown, { readonly message: string }>): string {
  expect(Either.isLeft(result)).toBe(true);
  return Either.isLeft(result) ? result.left.message : "";
}

describe("resolveLandedRun", () => {
  it("resolves a live run from its short name", async () => {
    const { impl, resolve } = setup(undefined);
    impl.setFile(`${STATE_ROOT}/runs/acme.alpha/run-status.json`, "{}");

    expect(await resolve("alpha")).toEqual(
      Either.right({
        key: "acme.alpha",
        runPath: `${STATE_ROOT}/runs/acme.alpha`,
        archived: false,
      }),
    );
  });

  it("resolves a live run from its qualified name", async () => {
    const { impl, resolve } = setup(undefined);
    impl.setFile(`${STATE_ROOT}/runs/acme.alpha/run-status.json`, "{}");

    expect(await resolve("acme.alpha")).toEqual(
      Either.right({
        key: "acme.alpha",
        runPath: `${STATE_ROOT}/runs/acme.alpha`,
        archived: false,
      }),
    );
  });

  it("resolves a qualified name in another namespace", async () => {
    const { impl, resolve } = setup(undefined);
    impl.setFile(`${STATE_ROOT}/runs/other.alpha/run-status.json`, "{}");

    expect(await resolve("other.alpha")).toEqual(
      Either.right({
        key: "other.alpha",
        runPath: `${STATE_ROOT}/runs/other.alpha`,
        archived: false,
      }),
    );
  });

  it("resolves an archived run through its registry entry's archivePath", async () => {
    const archivePath = `${STATE_ROOT}/archive/acme.beta`;
    const { impl, resolve } = setup([entry("beta", { archivePath })]);
    impl.setFile(`${archivePath}/runs/global-file-reconciliation.json`, "{}");

    expect(await resolve("beta")).toEqual(
      Either.right({ key: "acme.beta", runPath: `${archivePath}/runs`, archived: true }),
    );
  });

  it("refuses an archived run whose folder is gone as pruned", async () => {
    const archivePath = `${STATE_ROOT}/archive/acme.beta`;
    const { resolve } = setup([entry("beta", { archivePath })]);

    expect(expectRefusal(await resolve("beta"))).toBe(
      `Run "acme.beta" was archived to "${archivePath}" but that folder is gone — ` +
        "the run was pruned, so its landed diff is no longer available",
    );
  });

  it("refuses an entry with no archivePath and no live folder", async () => {
    const { resolve } = setup([entry("gamma", { state: "completed" })]);

    expect(expectRefusal(await resolve("gamma"))).toBe(
      `Run "acme.gamma" is in the registry but has no run folder under "${STATE_ROOT}/runs/" and no archive`,
    );
  });

  it("refuses an unknown run and names the pruned ambiguity", async () => {
    const { resolve } = setup([entry("other")]);

    expect(expectRefusal(await resolve("delta"))).toBe(
      `Run "acme.delta" is unknown: no run folder under "${STATE_ROOT}/runs/" and no registry entry. ` +
        "A pruned run looks the same — `phax prune` removes its registry entry",
    );
  });

  it("refuses an unknown run when no registry exists", async () => {
    const { resolve } = setup(undefined);

    expect(expectRefusal(await resolve("delta"))).toContain('Run "acme.delta" is unknown');
  });

  it.each([
    ["a.b.c", "more than one dot"],
    [".alpha", "empty namespace part"],
    ["acme.", "empty short-name part"],
    ["Bad_Name", "is not a valid run short name"],
  ])("refuses the invalid ref %s with parseRunRef's message", async (landed, fragment) => {
    const { resolve } = setup(undefined);

    expect(expectRefusal(await resolve(landed))).toContain(fragment);
  });

  it("fails with the registry's own message when it does not parse", async () => {
    const { impl, resolve } = setup(undefined);
    impl.setFile(`${STATE_ROOT}/registry.json`, "{not json");

    expect(expectRefusal(await resolve("alpha"))).toBe("Failed to parse registry.json as JSON");
  });

  it("fails with the registry's own message when it does not decode", async () => {
    const { impl, resolve } = setup(undefined);
    impl.setFile(
      `${STATE_ROOT}/registry.json`,
      JSON.stringify(withSchemaUrl("registry", { runs: [{ shortName: 1 }] })),
    );

    expect(expectRefusal(await resolve("alpha"))).toContain(`${STATE_ROOT}/registry.json`);
  });
});
