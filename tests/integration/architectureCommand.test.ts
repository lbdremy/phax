import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArchitecture } from "../../src/cli/commands/architecture.js";
import { NO_ARCHITECTURE_PROVIDER } from "../../src/domain/architecture/request.js";
import { phaseGuardRefusal } from "../../src/domain/security/phaseGuard.js";
import type { OutputPort } from "../../src/ports/output.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// A made-up repository with a linked phase worktree, made-up phax.json files
// and a made-up provider script. HOME points at a temp dir, so no real
// ~/.phax/config.json is read.

let base: string;
let mainRoot: string;
let worktree: string;
let scripts: string;
let home: string;
let originalHome: string | undefined;

const BODY = "# Architecture — acme-billing";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-architecture-command-")));
  mainRoot = join(base, "repo");
  worktree = join(base, "phase-01");
  scripts = join(base, "scripts");
  home = join(base, "home");
  mkdirSync(mainRoot);
  mkdirSync(scripts);
  mkdirSync(home);
  git(mainRoot, "init -q -b main");
  writeFileSync(join(mainRoot, "README.md"), "made-up\n");
  writeFileSync(join(mainRoot, ".gitignore"), ".phax-context/\nphax.local.json\n");
  git(mainRoot, "add README.md .gitignore");
  git(
    mainRoot,
    "-c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init",
  );
  originalHome = process.env["HOME"];
  process.env["HOME"] = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(base, { recursive: true, force: true });
});

function writeConfig(file: "phax.json" | "phax.local.json", config: object): void {
  writeFileSync(join(mainRoot, file), JSON.stringify(config));
}

const projectConfig = (extra: object = {}) => ({
  version: 1,
  name: "made-up",
  gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
  ...extra,
});

/** A provider that saves its stdin and prints an architecture report with `body`. */
function providerCommand(
  body: string = BODY,
  extra: Record<string, unknown> = { parts: [] },
): string {
  const script = join(scripts, "acme-guard.mjs");
  const report = {
    $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
    body,
    ...extra,
  };
  writeFileSync(
    script,
    [
      `import { writeFileSync } from "node:fs";`,
      `let stdin = "";`,
      `for await (const chunk of process.stdin) stdin += chunk;`,
      `writeFileSync(${JSON.stringify(join(scripts, "stdin.json"))}, stdin);`,
      `process.stdout.write(${JSON.stringify(JSON.stringify(report))});`,
    ].join("\n"),
  );
  return `node ${script}`;
}

function capture(): { out: OutputPort; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    out: {
      log: (m) => stdout.push(m),
      warn: (m) => stderr.push(m),
      error: (m) => stderr.push(m),
    },
    stdout,
    stderr,
  };
}

async function architecture(cwd: string, ...paths: string[]) {
  const io = capture();
  const code = await runArchitecture(paths, io.out, cwd);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

describe("phax architecture", () => {
  it("with no provider in any layer, prints one stdout line and exits 1", async () => {
    writeConfig("phax.json", projectConfig());
    const result = await architecture(mainRoot);
    expect(result).toEqual({ code: 1, stdout: [NO_ARCHITECTURE_PROVIDER], stderr: [] });
  });

  it("prints the body of a provider declared in phax.json", async () => {
    writeConfig("phax.json", projectConfig({ architecture: { command: providerCommand() } }));
    const result = await architecture(mainRoot);
    expect(result).toEqual({ code: 0, stdout: [BODY], stderr: [] });
  });

  it("The report's parts are rendered", async () => {
    const parts = [
      {
        id: "core-decide",
        name: "core · decide",
        description: "The pure decision logic.",
        globs: ["src/core/decide/**"],
      },
      {
        id: "http-requests",
        name: "http · requests",
        description: "Request handlers.",
        globs: ["src/http/**", "src/*/schemas/**"],
      },
      { id: "docs", name: "docs", description: "The docs.", globs: ["docs/**"] },
    ];
    writeConfig(
      "phax.json",
      projectConfig({ architecture: { command: providerCommand(BODY, { parts }) } }),
    );
    const result = await architecture(mainRoot);
    expect(result).toEqual({
      code: 0,
      stdout: [
        [
          BODY,
          "",
          "## Parts",
          "",
          "### core · decide (`core-decide`)",
          "The pure decision logic.",
          "- `src/core/decide/**`",
          "",
          "### http · requests (`http-requests`)",
          "Request handlers.",
          "- `src/http/**`",
          "- `src/*/schemas/**`",
          "",
          "### docs (`docs`)",
          "The docs.",
          "- `docs/**`",
        ].join("\n"),
      ],
      stderr: [],
    });
  });

  describe("with assignment bounds", () => {
    const parts = [
      {
        id: "core-decide",
        name: "core · decide",
        description: "The pure decision logic.",
        globs: ["src/core/decide/**"],
      },
    ];
    const assignments = [
      {
        kind: "part",
        part: "core-decide",
        model: "claude-opus-5-5",
        effort: { min: "medium", max: "high" },
      },
      {
        kind: "globs",
        globs: ["src/*/schemas/**"],
        model: "claude-sonnet-5-5",
        effort: { min: "medium", max: "high" },
      },
    ];
    const BOUNDS = [
      "## Bounds (phax.json `assignments`; the first match governs)",
      "- assignments[0] part core-decide — core · decide (`src/core/decide/**`): claude-opus-5-5, medium–high",
      "- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high",
    ].join("\n");

    it("lists the bounds after the parts and exits 0", async () => {
      writeConfig(
        "phax.json",
        projectConfig({
          assignments,
          architecture: { command: providerCommand(BODY, { parts }) },
        }),
      );
      const result = await architecture(mainRoot);
      expect(result.code).toBe(0);
      expect(result.stderr).toEqual([]);
      expect(result.stdout).toHaveLength(3);
      expect(result.stdout[0]).toContain("## Parts");
      expect(result.stdout.slice(1)).toEqual(["", BOUNDS]);
    });

    it("marks a part bound a path-scoped report does not carry", async () => {
      writeConfig(
        "phax.json",
        projectConfig({
          assignments,
          architecture: { command: providerCommand(BODY, { parts: [] }) },
        }),
      );
      const result = await architecture(mainRoot, "docs/guide.md");
      expect(result.code).toBe(0);
      expect(result.stdout[2]).toContain(
        "part core-decide — (not in this report: run `phax architecture` with no path for its globs): claude-opus-5-5",
      );
    });

    it("prints the no-provider line, then the bounds, and exits 1", async () => {
      writeConfig("phax.json", projectConfig({ assignments }));
      const result = await architecture(mainRoot);
      expect(result.code).toBe(1);
      expect(result.stderr).toEqual([]);
      expect(result.stdout[0]).toBe(NO_ARCHITECTURE_PROVIDER);
      expect(result.stdout[1]).toBe("");
      expect(result.stdout[2]).toContain(
        "- assignments[0] part core-decide — (unresolved: no architecture provider): claude-opus-5-5, medium–high",
      );
      expect(result.stdout[2]).toContain(
        "- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high",
      );
    });

    it("prints one stderr line and no bounds when the provider fails", async () => {
      writeConfig(
        "phax.json",
        projectConfig({ assignments, architecture: { command: "node -e process.exit(3)" } }),
      );
      const result = await architecture(mainRoot);
      expect(result.code).toBe(1);
      expect(result.stdout).toEqual([]);
      expect(result.stderr).toHaveLength(1);
    });
  });

  it.each([
    ["a body-only report", {}, "parts"],
    [
      "a repeated part id",
      {
        parts: [
          {
            id: "core-decide",
            name: "core · decide",
            description: "The pure decision logic.",
            globs: ["src/core/decide/**"],
          },
          {
            id: "core-decide",
            name: "core · decide",
            description: "The pure decision logic.",
            globs: ["src/core/decide/**"],
          },
        ],
      },
      'part id "core-decide" is used twice',
    ],
    [
      "a part carrying model",
      {
        parts: [
          {
            id: "docs",
            name: "docs",
            description: "The docs.",
            globs: ["docs/**"],
            model: "claude-sonnet-5-5",
          },
        ],
      },
      "model",
    ],
  ])("A body-only or malformed report is unreadable: %s", async (_name, extra, reason) => {
    writeConfig(
      "phax.json",
      projectConfig({ architecture: { command: providerCommand(BODY, extra) } }),
    );
    const result = await architecture(mainRoot);
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toMatch(/^✗ architecture provider/);
    expect(result.stderr[0]).toContain(reason);
  });

  it("uses a provider declared only in phax.local.json", async () => {
    writeConfig("phax.json", projectConfig());
    writeConfig("phax.local.json", { architecture: { command: providerCommand() } });
    const result = await architecture(mainRoot, "src/core/billing/totals.ts");
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([BODY]);
  });

  it("exits 2 on an architecture with no command", async () => {
    writeConfig("phax.json", projectConfig({ architecture: {} }));
    expect((await architecture(mainRoot)).code).toBe(2);
  });

  it("exits 2 on an architecture with an extra key", async () => {
    writeConfig(
      "phax.json",
      projectConfig({ architecture: { command: providerCommand(), push: "findings" } }),
    );
    expect((await architecture(mainRoot)).code).toBe(2);
  });

  it("refuses a path outside the tree on stderr and exits 1", async () => {
    writeConfig("phax.json", projectConfig({ architecture: { command: providerCommand() } }));
    const result = await architecture(mainRoot, "../elsewhere");
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([
      "✗ phax architecture: ../elsewhere is outside the working tree",
    ]);
  });

  it("prints one stderr line and exits 1 when the provider fails", async () => {
    const failing = join(scripts, "acme-guard-fails.mjs");
    writeFileSync(
      failing,
      `process.stderr.write("acme-guard: no standard found\\n"); process.exit(3);`,
    );
    writeConfig("phax.json", projectConfig({ architecture: { command: `node ${failing}` } }));
    const result = await architecture(mainRoot);
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([
      "✗ architecture provider exited with code 3: acme-guard: no standard found",
    ]);
  });

  it("fails outside a git working tree", async () => {
    const result = await architecture(base);
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([
      `✗ phax architecture: ${base} is not inside a git working tree`,
    ]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === ".git"
      ? []
      : entry.isDirectory()
        ? walk(join(dir, entry.name)).map((p) => `${entry.name}/${p}`)
        : [entry.name],
  );
}

function listing(root: string): string[] {
  return walk(root).toSorted();
}

describe("phax architecture — inside a phase worktree", () => {
  it("is allowed by the phase guard, serves the call and writes no file anywhere", async () => {
    writeConfig("phax.json", projectConfig());
    writeConfig("phax.local.json", { architecture: { command: providerCommand() } });
    git(mainRoot, `worktree add -q -b phase-01 ${worktree}`);
    mkdirSync(join(worktree, ".phax-context"));

    const before = {
      worktree: listing(worktree),
      main: listing(mainRoot),
      home: listing(home),
      worktreeStatus: git(worktree, "status --porcelain"),
      mainStatus: git(mainRoot, "status --porcelain"),
    };

    expect(phaseGuardRefusal("architecture")).toBeUndefined();
    const result = await architecture(worktree, "src/core");
    expect(result).toEqual({ code: 0, stdout: [BODY], stderr: [] });

    const request = JSON.parse(readFileSync(join(scripts, "stdin.json"), "utf8")) as {
      files: string[];
    };
    expect(request.files).toEqual(["src/core"]);
    expect(existsSync(join(worktree, ".phax-context", "architecture-request.json"))).toBe(false);
    expect(listing(worktree)).toEqual(before.worktree);
    expect(listing(mainRoot)).toEqual(before.main);
    // No run folder or record under the state root either.
    expect(listing(home)).toEqual(before.home);
    expect(git(worktree, "status --porcelain")).toBe(before.worktreeStatus);
    expect(git(mainRoot, "status --porcelain")).toBe(before.mainStatus);
  });
});
