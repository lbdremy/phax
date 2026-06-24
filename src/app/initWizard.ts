import { basename, join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Prompt, type PromptCancelled, type PromptError } from "../ports/prompt.js";
import { decodePackageJson, type PackageJson } from "../schemas/packageJson.js";
import { decodePhaxConfig } from "../schemas/phaxConfig.js";
import { decodeNamespace } from "../domain/branded.js";
import { detectName, detectPackageManager, suggestGateCommands } from "../domain/init/detect.js";
import { buildPhaxConfig, type WizardAnswers } from "../domain/init/buildConfig.js";
import {
  serializePhaxConfigSchema,
  serializePhaxUserOverlaySchema,
  type InitResult,
} from "./initProject.js";

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function runInitWizard(input: {
  cwd: string;
  force?: boolean;
  interactive: boolean;
}): Effect.Effect<InitResult, FsError | PromptError | PromptCancelled, Prompt | FileSystem> {
  const { cwd, force = false, interactive } = input;
  const configPath = join(cwd, "phax.json");
  const schemaPath = join(cwd, "phax.schema.json");
  const userSchemaPath = join(cwd, "phax.user.schema.json");
  const schemaReference = "./phax.schema.json";

  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const prompt = yield* Prompt;

    const exists = yield* fs.exists(configPath);

    let existingName: string | undefined;

    if (exists && !force) {
      if (!interactive) {
        return { kind: "already_initialized" as const, configPath };
      }
      const existingText = yield* Effect.orElse(fs.readText(configPath), () =>
        Effect.succeed("{}"),
      );
      const parsedConfig = Either.getOrNull(decodePhaxConfig(safeParseJson(existingText)));
      existingName = parsedConfig?.name;

      const reconfigure = yield* prompt.confirm({
        message: "phax.json already exists. Reconfigure it?",
        initialValue: true,
      });
      if (!reconfigure) {
        return { kind: "already_initialized" as const, configPath };
      }
    }

    const pkgText = yield* Effect.orElse(fs.readText(join(cwd, "package.json")), () =>
      Effect.succeed("{}"),
    );
    const pkg = Either.getOrElse(
      decodePackageJson(safeParseJson(pkgText)),
      (): PackageJson => ({}),
    );

    const pm = detectPackageManager(pkg);
    const detectedName = existingName ?? detectName(pkg, basename(cwd));
    const suggestions = suggestGateCommands(pkg, pm);

    let answers: WizardAnswers;

    if (interactive) {
      yield* prompt.intro("phax init — configure your project");

      const name = yield* prompt.text({
        message: "Project slug (name)",
        defaultValue: detectedName,
        validate: (value) => {
          const result = decodeNamespace(value);
          return Either.isLeft(result)
            ? "Name must match ^[a-z][a-z0-9-]*$ (e.g. my-project)"
            : undefined;
        },
      });

      let gateCommands: ReadonlyArray<string>;
      if (suggestions.length > 0) {
        gateCommands = yield* prompt.multiselect({
          message: "Select gate commands (run before merge)",
          options: suggestions.map((s) => ({
            value: s.command,
            label: s.command,
            hint: s.script,
          })),
          initialValues: suggestions.filter((s) => s.recommended).map((s) => s.command),
        });
      } else {
        const cmd = yield* prompt.text({
          message: "Gate command (e.g. pnpm test)",
          placeholder: "pnpm test",
        });
        gateCommands = cmd ? [cmd] : [];
      }

      const complianceEnabled = yield* prompt.confirm({
        message: "Enable compliance review?",
        initialValue: false,
      });

      const publishEnabled = yield* prompt.confirm({
        message: "Enable publish (push branch / create PR)?",
        initialValue: false,
      });

      let publishPushBranch = true;
      let publishCreatePr = true;
      if (publishEnabled) {
        publishPushBranch = yield* prompt.confirm({
          message: "Push branch after run?",
          initialValue: true,
        });
        publishCreatePr = yield* prompt.confirm({
          message: "Create pull request after run?",
          initialValue: true,
        });
      }

      answers = {
        name,
        gateCommands,
        complianceEnabled,
        publishEnabled,
        publishPushBranch,
        publishCreatePr,
      };

      yield* prompt.outro("Done! Run `phax validate` or `phax run` to get started.");
    } else {
      answers = {
        name: detectedName,
        gateCommands: suggestions.filter((s) => s.recommended).map((s) => s.command),
        complianceEnabled: false,
        publishEnabled: false,
        publishPushBranch: true,
        publishCreatePr: true,
      };
    }

    const config = buildPhaxConfig(answers);
    yield* fs.writeAtomic(configPath, JSON.stringify(config, null, 2) + "\n");
    yield* fs.writeAtomic(schemaPath, serializePhaxConfigSchema());
    yield* fs.writeAtomic(userSchemaPath, serializePhaxUserOverlaySchema());

    return {
      kind: "created" as const,
      configPath,
      schemaPath,
      userSchemaPath,
      schemaReference,
    };
  });
}
