// The spec document's acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ClaudeSessionId } from "../../../src/domain/branded.js";
import type { ArtifactDecideDeps } from "../../../src/cli/definitions/artifactDecide.js";
import type { ArtifactNewDeps } from "../../../src/cli/definitions/artifactNew.js";
import {
  type Command,
  defineGroup,
  defineProgram,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { serializeSidecar } from "../../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import { makeFakeBackend } from "../../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import { makeFakePrompt } from "../../../src/infra/fakes/prompt.js";
import { makeFakeSession } from "../../../src/infra/fakes/session.js";
import { makeFakeTerminal } from "../../../src/infra/fakes/terminal.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";
import { isolateGit } from "../../helpers/isolateGit.js";
import { isolatePhaxHome } from "../../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { ANSWER_FOLLOW, FILE_VALID, SPEC, SPEC_PATH } from "../../unit/decide/verdictsFixtures.js";

// The world of tests/integration/artifactStdinDocuments.test.ts: a git repository in a temporary
// directory with its own identity, a Draft headless spec with its sidecar and open questions
// (made up, from the decide fixtures), a temporary PHAX home, the texts of the two stdin
// documents, the fake backend's answers and a runner program holding the commands under test. It
// reads nothing outside its temporary directories. A test that needs two worlds builds two.
//
// A test file that builds it hoists the `node:os` mock of tests/helpers/isolatePhaxHome.ts, so
// that the PHAX home paths phax computes at import follow the temporary home.

const OPERATOR = "Ada Lovelace";
const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-25\naudience: maintainers\nscope: logs\n---\n";
const WRITER_SESSION = "7d3e9b10-aaaa-4bbb-8ccc-0123456789ab";

/** The Markdown brief of `artifact new --brief`. */
const BRIEF_TEXT = [
  "# Brief: prune archived runs",
  "",
  "Free the slug of an archived run.",
  "",
  "- a slug is held only by a live run",
  "- pruning stays manual",
  "",
].join("\n");

/** The spec document the fake backend answers a headless `artifact new spec` session with. */
const NEW_SPEC_DOCUMENT = {
  $schema: currentSchemaUrl("spec-document"),
  kind: "spec",
  title: "Plan Prune",
  ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea this spec makes precise" }],
  context: "A slug is held forever by its archived run.",
  problem: "The `-2` habit is the visible symptom.",
  productGoal: {
    statement: "Free a slug once its run is archived.",
    guidingRule: "A slug is held only by a live run.",
  },
  terminology: [{ term: "live run", definition: "a run that is not archived" }],
  requirements: [
    {
      id: "5.1",
      title: "Prune eligibility",
      pattern: "event",
      statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
    },
  ],
  surface: [
    {
      surface: "cli: `phax prune <run>`",
      summary: "An operator can free the slug of an archived run.",
      binding: "normative",
      before: null,
      after: "phax prune usage-cli\n  pruned usage-cli\n  $? = 0",
    },
  ],
  nonGoals: ["pruning a run that is not archived"],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Prune frees the slug",
      given: "an archived run usage-cli",
      when: "`phax prune usage-cli` runs",
      then: "the slug is free",
      refs: ["5.1"],
    },
  ],
  openQuestions: [
    {
      id: "Q1",
      question: "Is pruning manual or automatic past `keep`?",
      options: [
        { id: "manual", label: "an explicit `phax prune`", abandons: "self-shrinking" },
        { id: "auto", label: "prune at archive time", abandons: "later inspection" },
      ],
      recommendation: "manual",
      rationale: "records already keep the trajectory",
    },
  ],
  arbitratedQuestions: [],
  planningNote: { settled: ["manual prune"], open: [], constraints: ["no new state"] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

/** The commands the program holds, built by the factories with the layers of `layers`. */
interface StdinDocumentsCommands {
  // The factories' commands, whatever services they ask for.
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly decide: Command<any>;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly newSpec: Command<any>;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly newPlan: Command<any>;
}

/** The fake layers and the fakes behind them, for the factories' deps. */
export interface StdinDocumentsFakes {
  /** What the writer session of the call was started with. */
  readonly backend: ReturnType<typeof makeFakeBackend>["impl"];
  /** The interactive sessions started: none, for a call refused before it runs. */
  readonly session: ReturnType<typeof makeFakeSession>["impl"];
  readonly decideDeps: Required<ArtifactDecideDeps>;
  readonly newDeps: Required<ArtifactNewDeps>;
}

export interface StdinDocumentsRepo {
  readonly repoDir: string;
  readonly specPath: string;
  readonly sidecarPath: string;
  /** A valid verdicts document: q-keep follows with a note, q-scope follows without one. */
  readonly verdictsText: string;
  /** A verdicts document whose first verdict chooses an option its question does not have. */
  readonly badVerdictsText: string;
  /** A Markdown brief. */
  readonly briefText: string;
  /** The git identity the fixture commits as. */
  readonly operator: string;
  /** Fakes for one call: a fake backend answering the decide writer (when `answers` is `decide`)
   *  or the headless spec author (`new-spec`), a fake terminal, session, prompt and GitHub. */
  readonly fakes: (answers: "decide" | "new-spec", terminal?: boolean) => StdinDocumentsFakes;
  /** A runner program: an `artifact` group holding `decide` and a nested `new` group holding
   *  `spec` and `plan`. */
  readonly program: (commands: StdinDocumentsCommands) => ReturnType<typeof defineProgram>;
  readonly read: (repoRelativePath: string) => string;
  readonly git: (...args: readonly string[]) => string;
  /** HEAD's sha. */
  readonly head: () => string;
  /** `git status --porcelain`, trimmed. */
  readonly porcelain: () => string;
  /** The repo-relative paths HEAD's commit holds, sorted. */
  readonly headFiles: () => readonly string[];
  /** Writes a file in the repository (not committed). */
  readonly write: (repoRelativePath: string, text: string) => void;
  readonly dispose: () => void;
}

/** Builds the world; call `dispose` to remove it and restore the environment. */
export function makeStdinDocumentsRepo(): StdinDocumentsRepo {
  const restoreGit = isolateGit();
  const home = isolatePhaxHome();
  const repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-stdin-documents-")));
  const git = (...args: readonly string[]): string =>
    execFileSync("git", [...args], { cwd: repoDir, stdio: "pipe" }).toString();
  const write = (rel: string, text: string): void => {
    const abs = join(repoDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };

  git("init", "-q", "-b", "main");
  disableGitAutoMaintenance(repoDir);
  git("config", "--local", "user.name", OPERATOR);
  git("config", "--local", "user.email", "ada@example.test");
  write(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  const sidecarPath = SPEC_PATH.replace(/\.md$/, ".json");
  write(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument));
  write(sidecarPath, serializeSidecar(SPEC));
  git("add", "-A");
  git("commit", "-q", "-m", "seed");

  const bad = JSON.parse(FILE_VALID) as { verdicts: Array<{ chosen: string }> };
  bad.verdicts[0]!.chosen = "keep-99";

  return {
    repoDir,
    specPath: SPEC_PATH,
    sidecarPath,
    verdictsText: FILE_VALID,
    badVerdictsText: JSON.stringify(bad, null, 2),
    briefText: BRIEF_TEXT,
    operator: OPERATOR,
    fakes: (answers, terminal = false) => {
      const backend = makeFakeBackend();
      backend.impl.addRunResponse({
        sessionId: WRITER_SESSION as ClaudeSessionId,
        outputPath: answers === "decide" ? "" : "output.jsonl",
        finalText: JSON.stringify(answers === "decide" ? ANSWER_FOLLOW : NEW_SPEC_DOCUMENT),
      });
      const github = makeFakeGitHub();
      const session = makeFakeSession();
      return {
        backend: backend.impl,
        session: session.impl,
        decideDeps: {
          backendLayer: backend.layer,
          sessionLayer: session.layer,
          promptLayer: makeFakePrompt([]).layer,
          terminalLayer: makeFakeTerminal(terminal).layer,
          githubLayer: github.layer,
        },
        newDeps: { backendLayer: backend.layer, githubLayer: github.layer },
      };
    },
    program: (commands) =>
      defineProgram({
        name: "phax",
        version: "1.0.0",
        exits: { refused: 64, defect: 70 },
        refusalHint: "Run `phax --help` for usage.",
        commands: [
          defineGroup({
            name: "artifact",
            summary: "Inspect and transition the lifecycle status of a spec or plan",
            commands: [
              commands.decide,
              defineGroup({
                name: "new",
                summary: "Create a Draft spec or plan",
                commands: [commands.newSpec, commands.newPlan],
              }),
            ],
          }),
        ],
      }),
    read: (rel) => readFileSync(join(repoDir, rel), "utf8"),
    git,
    head: () => git("rev-parse", "HEAD").trim(),
    porcelain: () => git("status", "--porcelain").trim(),
    headFiles: () => git("show", "--name-only", "--format=", "HEAD").trim().split("\n").toSorted(),
    write,
    dispose: () => {
      removeTempDir(repoDir);
      home.restore();
      restoreGit();
    },
  };
}
