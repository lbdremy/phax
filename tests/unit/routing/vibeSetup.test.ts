import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  extractBaseModel,
  renderPhaxAliasBlocks,
  PHAX_ALIAS_LEVELS,
  makePhaxAliasName,
  type VibeBaseModel,
} from "../../../src/schemas/vibeConfig.js";
import { vibeSetup, VIBE_CONFIG_PATH } from "../../../src/app/vibeSetup.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { ConfigValidationError } from "../../../src/domain/errors.js";

const BASE_CONFIG = `active_model = "mistral-medium-3.5"

[[models]]
alias = "mistral-medium-3.5"
name = "Mistral Medium 3.5"
provider = "mistral"
temperature = 0.6
input_price = 0.4
output_price = 2
auto_compact_threshold = 0.9
`;

const EXPECTED_BASE: VibeBaseModel = {
  name: "Mistral Medium 3.5",
  provider: "mistral",
  temperature: 0.6,
  input_price: 0.4,
  output_price: 2,
  auto_compact_threshold: 0.9,
};

const run = <A>(eff: Effect.Effect<A, ConfigValidationError, never>): Promise<A> =>
  Effect.runPromise(eff);

const runFail = <A>(
  eff: Effect.Effect<A, ConfigValidationError, never>,
): Promise<ConfigValidationError> => Effect.runPromise(Effect.flip(eff));

function findBackupFile(files: Map<string, string>): { path: string; content: string } | undefined {
  const prefix = `${VIBE_CONFIG_PATH}.phax-backup-`;
  for (const [path, content] of files.entries()) {
    if (path.startsWith(prefix)) return { path, content };
  }
  return undefined;
}

describe("extractBaseModel", () => {
  it("extracts scalar fields from a matching block", () => {
    const result = extractBaseModel(BASE_CONFIG, "mistral-medium-3.5");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(EXPECTED_BASE);
    }
  });

  it("returns Left when the base alias is not found", () => {
    const result = extractBaseModel(BASE_CONFIG, "nonexistent-model");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("not found");
    }
  });

  it("returns Left when a required scalar is missing", () => {
    const incomplete = `[[models]]\nalias = "incomplete"\nname = "No Provider"\ntemperature = 0.5\n`;
    const result = extractBaseModel(incomplete, "incomplete");
    expect(Either.isLeft(result)).toBe(true);
  });

  it("ignores non-matching blocks and finds the target block", () => {
    const config = `[[models]]
alias = "other-model"
name = "Other"
provider = "other"
temperature = 0.5
input_price = 1
output_price = 1
auto_compact_threshold = 0.5

[[models]]
alias = "mistral-medium-3.5"
name = "Mistral Medium 3.5"
provider = "mistral"
temperature = 0.6
input_price = 0.4
output_price = 2
auto_compact_threshold = 0.9
`;
    const result = extractBaseModel(config, "mistral-medium-3.5");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(EXPECTED_BASE);
    }
  });
});

describe("renderPhaxAliasBlocks", () => {
  it("renders one block per thinking level", () => {
    const rendered = renderPhaxAliasBlocks(EXPECTED_BASE, PHAX_ALIAS_LEVELS);
    for (const level of PHAX_ALIAS_LEVELS) {
      expect(rendered).toContain(`alias = "${makePhaxAliasName(level)}"`);
      expect(rendered).toContain(`thinking = "${level}"`);
    }
  });

  it("preserves the base scalar values verbatim", () => {
    const rendered = renderPhaxAliasBlocks(EXPECTED_BASE, ["off"]);
    expect(rendered).toContain(`name = "Mistral Medium 3.5"`);
    expect(rendered).toContain(`provider = "mistral"`);
    expect(rendered).toContain(`temperature = 0.6`);
    expect(rendered).toContain(`input_price = 0.4`);
    expect(rendered).toContain(`auto_compact_threshold = 0.9`);
  });

  it("renders one PHAX comment per block", () => {
    const rendered = renderPhaxAliasBlocks(EXPECTED_BASE, PHAX_ALIAS_LEVELS);
    const count = (rendered.match(/# Added by PHAX\./g) ?? []).length;
    expect(count).toBe(PHAX_ALIAS_LEVELS.length);
  });

  it("renders [[models]] header for each block", () => {
    const rendered = renderPhaxAliasBlocks(EXPECTED_BASE, PHAX_ALIAS_LEVELS);
    const count = (rendered.match(/\[\[models\]\]/g) ?? []).length;
    expect(count).toBe(PHAX_ALIAS_LEVELS.length);
  });
});

describe("vibeSetup", () => {
  it("fails with ConfigValidationError when config file is absent", async () => {
    const { layer } = makeFakeFileSystem();
    const err = await runFail(vibeSetup({ install: true }).pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(VIBE_CONFIG_PATH);
  });

  it("fails with ConfigValidationError when base block is missing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, `active_model = "other"\n`);
    const err = await runFail(vibeSetup({ install: true }).pipe(Effect.provide(layer)));
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.path).toBe(VIBE_CONFIG_PATH);
  });

  it("dry-run lists all five aliases and writes nothing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, BASE_CONFIG);
    const initialSize = impl.files.size;

    const result = await run(vibeSetup({ dryRun: true }).pipe(Effect.provide(layer)));

    expect(result.aliasesAdded).toHaveLength(5);
    expect(result.aliasesSkipped).toHaveLength(0);
    expect(result.backupPath).toBeUndefined();
    expect(impl.files.size).toBe(initialSize);
    expect(impl.files.get(VIBE_CONFIG_PATH)).toBe(BASE_CONFIG);
  });

  it("returns aliasesAdded list on dry-run without install flag", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, BASE_CONFIG);

    const result = await run(vibeSetup({}).pipe(Effect.provide(layer)));

    expect(result.aliasesAdded).toHaveLength(5);
    expect(result.backupPath).toBeUndefined();
    expect(impl.files.get(VIBE_CONFIG_PATH)).toBe(BASE_CONFIG);
  });

  it("install appends all five aliases and creates a backup", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, BASE_CONFIG);

    const result = await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));

    expect(result.aliasesAdded).toHaveLength(5);
    expect(result.aliasesSkipped).toHaveLength(0);
    expect(result.backupPath).toBeDefined();

    const backup = findBackupFile(impl.files);
    expect(backup).toBeDefined();
    expect(backup!.content).toBe(BASE_CONFIG);

    const newContent = impl.files.get(VIBE_CONFIG_PATH)!;
    expect(newContent.startsWith(BASE_CONFIG)).toBe(true);
    for (const level of PHAX_ALIAS_LEVELS) {
      expect(newContent).toContain(`alias = "${makePhaxAliasName(level)}"`);
    }
  });

  it("install is idempotent — second run appends nothing", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, BASE_CONFIG);

    await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));
    const afterFirst = impl.files.get(VIBE_CONFIG_PATH)!;

    const result = await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));

    expect(result.aliasesAdded).toHaveLength(0);
    expect(result.aliasesSkipped).toHaveLength(5);
    expect(result.backupPath).toBeUndefined();
    expect(impl.files.get(VIBE_CONFIG_PATH)).toBe(afterFirst);
  });

  it("install appends only missing aliases when some are already present", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const partial = `${BASE_CONFIG}
# Added by PHAX.
[[models]]
alias = "phax-mistral-medium-3.5-off"
name = "Mistral Medium 3.5"
provider = "mistral"
temperature = 0.6
thinking = "off"
input_price = 0.4
output_price = 2
auto_compact_threshold = 0.9

# Added by PHAX.
[[models]]
alias = "phax-mistral-medium-3.5-low"
name = "Mistral Medium 3.5"
provider = "mistral"
temperature = 0.6
thinking = "low"
input_price = 0.4
output_price = 2
auto_compact_threshold = 0.9
`;
    impl.setFile(VIBE_CONFIG_PATH, partial);

    const result = await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));

    expect(result.aliasesAdded).toHaveLength(3);
    expect(result.aliasesSkipped).toHaveLength(2);
    expect(result.aliasesAdded).toContain(makePhaxAliasName("medium"));
    expect(result.aliasesAdded).toContain(makePhaxAliasName("high"));
    expect(result.aliasesAdded).toContain(makePhaxAliasName("max"));
    expect(result.aliasesSkipped).toContain(makePhaxAliasName("off"));
    expect(result.aliasesSkipped).toContain(makePhaxAliasName("low"));

    const newContent = impl.files.get(VIBE_CONFIG_PATH)!;
    expect(newContent.startsWith(partial)).toBe(true);
    for (const level of PHAX_ALIAS_LEVELS) {
      expect(newContent).toContain(`alias = "${makePhaxAliasName(level)}"`);
    }
  });

  it("preserves original bytes including active_model and user entries", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const configWithUserEntry = `active_model = "mistral-medium-3.5"

[[models]]
alias = "mistral-medium-3.5"
name = "Mistral Medium 3.5"
provider = "mistral"
temperature = 0.6
input_price = 0.4
output_price = 2
auto_compact_threshold = 0.9

[[models]]
alias = "user-entry"
name = "User Entry"
provider = "custom"
temperature = 0.5
input_price = 1
output_price = 1
auto_compact_threshold = 0.5
`;
    impl.setFile(VIBE_CONFIG_PATH, configWithUserEntry);

    await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));

    const newContent = impl.files.get(VIBE_CONFIG_PATH)!;
    expect(newContent.startsWith(configWithUserEntry)).toBe(true);
    expect(newContent).toContain(`active_model = "mistral-medium-3.5"`);
    expect(newContent).toContain(`alias = "user-entry"`);
  });

  it("backup contains the original content byte-for-byte", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(VIBE_CONFIG_PATH, BASE_CONFIG);

    await run(vibeSetup({ install: true }).pipe(Effect.provide(layer)));

    const backup = findBackupFile(impl.files);
    expect(backup).toBeDefined();
    expect(backup!.content).toBe(BASE_CONFIG);
    expect(backup!.path).toMatch(/\.phax-backup-\d+$/);
  });
});
