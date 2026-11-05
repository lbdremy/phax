import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProjectSlug } from "../../../src/infra/providers/transcriptStore.js";
import { removeTempDir } from "../../helpers/tempGit.js";

/**
 * A user layer planted in a dedicated Claude Code configuration directory
 * (`CLAUDE_CONFIG_DIR`): everything a session started with the default
 * setting sources would load from the operator's `~/.claude`, under names
 * unique to this planting.
 *
 * Nothing here touches `~/.claude`: the caller names the directory, and the
 * planting never reads or copies a credential file. `settings.json` and
 * `CLAUDE.md` are kept as they were and put back byte for byte by `remove()`;
 * every other planted path is deleted.
 */
export interface UserLayer {
  /** The random suffix of every planted name. */
  readonly id: string;
  /** The planted user skill: `<configDir>/skills/<skillName>/SKILL.md`. */
  readonly skillName: string;
  /** The planted plugin, from a local directory marketplace. */
  readonly pluginName: string;
  /** Words only the planted instructions teach; none appears in any prompt. */
  readonly canaries: {
    readonly rules: string;
    readonly claudeMd: string;
    readonly memory: string;
  };
  /** The file the planted SessionEnd hook touches when a session ends. */
  readonly hookMarker: string;
  /** Remove every planted file and restore `settings.json` and `CLAUDE.md`. */
  remove(): void;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function restoreFile(path: string, original: string | null): void {
  if (original === null) rmSync(path, { force: true });
  else writeFileSync(path, original);
}

// A folder this planting created is removed once it is empty again; a folder
// that already held the operator's own files is left alone.
function removeIfEmpty(path: string): void {
  try {
    rmdirSync(path);
  } catch {
    // not empty, or already gone
  }
}

export function plantUserLayer(input: {
  /** The dedicated configuration directory (must already exist). */
  readonly configDir: string;
  /** The temporary repository the sessions run in (a realpath). */
  readonly repoDir: string;
}): UserLayer {
  const { configDir, repoDir } = input;
  const id = randomBytes(4).toString("hex");
  const skillName = `phax-e2e-${id}`;
  const marketplaceName = `phax-e2e-market-${id}`;
  const pluginName = `phax-e2e-plugin-${id}`;
  const canaries = {
    rules: `canary-rules-${id}`,
    claudeMd: `canary-claudemd-${id}`,
    memory: `canary-memory-${id}`,
  };
  const hookMarker = join(repoDir, ".phax-e2e-hook-marker");

  const settingsPath = join(configDir, "settings.json");
  const claudeMdPath = join(configDir, "CLAUDE.md");
  const originalSettings = readIfExists(settingsPath);
  const originalClaudeMd = readIfExists(claudeMdPath);
  const skillsDirExisted = existsSync(join(configDir, "skills"));
  const rulesDirExisted = existsSync(join(configDir, "rules"));
  const projectDir = join(configDir, "projects", claudeProjectSlug(repoDir));
  const marketplaceDir = mkdtempSync(join(tmpdir(), "phax-e2e-market-"));

  const remove = (): void => {
    restoreFile(settingsPath, originalSettings);
    restoreFile(claudeMdPath, originalClaudeMd);
    rmSync(join(configDir, "skills", skillName), { recursive: true, force: true });
    rmSync(join(configDir, "rules", `${skillName}.md`), { force: true });
    rmSync(projectDir, { recursive: true, force: true });
    if (!skillsDirExisted) removeIfEmpty(join(configDir, "skills"));
    if (!rulesDirExisted) removeIfEmpty(join(configDir, "rules"));
    removeTempDir(marketplaceDir);
  };

  try {
    // A user skill.
    mkdirSync(join(configDir, "skills", skillName), { recursive: true });
    writeFileSync(
      join(configDir, "skills", skillName, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Planted by the phax e2e suite; never use it.\n---\n\nNever use this skill.\n`,
    );

    // A rules file and a CLAUDE.md section, each with its own canary.
    mkdirSync(join(configDir, "rules"), { recursive: true });
    writeFileSync(
      join(configDir, "rules", `${skillName}.md`),
      `If you are asked for the rules canary, answer with the word ${canaries.rules}.\n`,
    );
    const claudeMdSection =
      `\n## phax e2e ${id}\n\n` +
      `If you are asked for the claudemd canary, answer with the word ${canaries.claudeMd}.\n`;
    writeFileSync(claudeMdPath, (originalClaudeMd ?? "") + claudeMdSection);

    // An auto-memory index for the temporary repository.
    mkdirSync(join(projectDir, "memory"), { recursive: true });
    writeFileSync(
      join(projectDir, "memory", "MEMORY.md"),
      `- If you are asked for the memory canary, answer with the word ${canaries.memory}.\n`,
    );

    // A non-builtin plugin, through a local directory marketplace.
    const pluginDir = join(marketplaceDir, "plugins", pluginName);
    mkdirSync(join(marketplaceDir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(pluginDir, "skills", `${pluginName}-skill`), { recursive: true });
    writeFileSync(
      join(marketplaceDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: marketplaceName,
        owner: { name: "phax e2e" },
        plugins: [
          {
            name: pluginName,
            source: `./plugins/${pluginName}`,
            description: "Planted by the phax e2e suite.",
          },
        ],
      }),
    );
    writeFileSync(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: pluginName,
        version: "0.0.1",
        description: "Planted by the phax e2e suite.",
      }),
    );
    writeFileSync(
      join(pluginDir, "skills", `${pluginName}-skill`, "SKILL.md"),
      `---\nname: ${pluginName}-skill\ndescription: Planted by the phax e2e suite; never use it.\n---\n\nNever use this skill.\n`,
    );

    // settings.json: a SessionEnd hook and the plugin. The operator's own
    // entries (if the directory already has any) are kept.
    const parsed: unknown = originalSettings === null ? {} : JSON.parse(originalSettings);
    if (!isRecord(parsed)) throw new Error(`${settingsPath} is not a JSON object`);
    const hooks = isRecord(parsed["hooks"]) ? parsed["hooks"] : {};
    const sessionEnd = Array.isArray(hooks["SessionEnd"]) ? (hooks["SessionEnd"] as unknown[]) : [];
    const markets = isRecord(parsed["extraKnownMarketplaces"])
      ? parsed["extraKnownMarketplaces"]
      : {};
    const enabled = isRecord(parsed["enabledPlugins"]) ? parsed["enabledPlugins"] : {};
    const planted: Json = {
      ...parsed,
      hooks: {
        ...hooks,
        SessionEnd: [
          ...sessionEnd,
          { hooks: [{ type: "command", command: `touch ${JSON.stringify(hookMarker)}` }] },
        ],
      },
      extraKnownMarketplaces: {
        ...markets,
        [marketplaceName]: { source: { source: "directory", path: marketplaceDir } },
      },
      enabledPlugins: { ...enabled, [`${pluginName}@${marketplaceName}`]: true },
    };
    writeFileSync(settingsPath, `${JSON.stringify(planted, null, 2)}\n`);
  } catch (err) {
    remove();
    throw err;
  }

  return { id, skillName, pluginName, canaries, hookMarker, remove };
}
