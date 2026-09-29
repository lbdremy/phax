import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyRecordPath,
  classifyRepoPath,
  classifyRunDirFile,
  collectFormatDocuments,
  expandHome,
  shortenHome,
  type FormatSourceDocument,
} from "../../scripts/formatSources.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=phax test",
      "-c",
      "user.email=test@phax.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: "pipe" },
  );
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(dir);
}

function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
}

const summary = (docs: ReadonlyArray<FormatSourceDocument>) =>
  docs.map((d) => `${d.format} ${d.source} ${d.text}`).toSorted();

const RECORD_V1 = '{"version":1,"phase":"one"}\n';
const RECORD_V2 = '{"version":2,"phase":"two"}\n';

// A records repository whose `main` holds only a README, and whose `phax/records/v1` branch
// commits a version-1 phase record, then replaces it with a version-2 one.
function makeRecordsRepo(dir: string): void {
  initRepo(dir);
  write(dir, "README.md", "records\n");
  commitAll(dir, "init");
  git(dir, ["checkout", "-q", "--orphan", "phax/records/v1"]);
  git(dir, ["rm", "-q", "-r", "--cached", "."]);
  rmSync(join(dir, "README.md"));
  write(dir, "run-a/phase-01/record.json", RECORD_V1);
  write(dir, "authoring/spec-1/record.json", '{"version":1,"kind":"authoring"}\n');
  commitAll(dir, "record v1");
  write(dir, "run-a/phase-01/record.json", RECORD_V2);
  write(dir, "run-a/phase-01/gate-attribution.json", '{"attribution":true}\n');
  write(dir, "run-a/phase-01/checks-attempt-01.diagnostics.json", '{"diagnostics":[]}\n');
  write(dir, "run-a/phase-01/notes.md", "ignored\n");
  commitAll(dir, "record v2");
  git(dir, ["checkout", "-q", "main"]);
}

const EXPECTED_RECORDS = (source: string) =>
  [
    `authoring-record-manifest ${source}@git:authoring/spec-1/record.json {"version":1,"kind":"authoring"}\n`,
    `gate-attribution ${source}@git:run-a/phase-01/gate-attribution.json {"attribution":true}\n`,
    `gate-diagnostics ${source}@git:run-a/phase-01/checks-attempt-01.diagnostics.json {"diagnostics":[]}\n`,
    `phase-record-manifest ${source}@git:run-a/phase-01/record.json ${RECORD_V1}`,
    `phase-record-manifest ${source}@git:run-a/phase-01/record.json ${RECORD_V2}`,
  ].toSorted();

describe("collectFormatDocuments", () => {
  // the temporary directory is also the home the sources are shortened against
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "phax-format-sources-"));
  });
  afterEach(() => removeTempDir(root));

  it("walks every commit of the local records branch, not just its tip", () => {
    makeRecordsRepo(join(root, "records"));
    const docs = collectFormatDocuments({ records: ["~/records"], repos: [], home: root });
    expect(summary(docs)).toEqual(EXPECTED_RECORDS("~/records"));
  });

  it("falls back to origin's records branch when only the remote-tracking branch exists", () => {
    makeRecordsRepo(join(root, "records"));
    git(root, ["clone", "-q", join(root, "records"), join(root, "clone")]);
    disableGitAutoMaintenance(join(root, "clone"));
    expect(git(join(root, "clone"), ["branch", "--list", "phax/records/v1"]).trim()).toBe("");
    const docs = collectFormatDocuments({
      records: [join(root, "clone")],
      repos: [],
      home: root,
    });
    expect(summary(docs)).toEqual(EXPECTED_RECORDS("~/clone"));
  });

  it("finds nothing in a records source without a records branch", () => {
    initRepo(join(root, "empty"));
    write(join(root, "empty"), "x/phase-01/record.json", RECORD_V1);
    commitAll(join(root, "empty"), "not records");
    expect(collectFormatDocuments({ records: ["~/empty"], repos: [], home: root })).toEqual([]);
  });

  it("walks a repository's history for the approvals ledgers and the sidecars", () => {
    const repo = join(root, "repo");
    initRepo(repo);
    write(repo, "docs/plans/approvals.json", '{"approvals":1}\n');
    write(repo, "docs/specs/2609241238-x.json", '{"spec":1}\n');
    write(repo, "docs/specs/2609241238-x.md", "# spec\n");
    write(repo, "src/other.json", "{}\n");
    commitAll(repo, "docs");
    write(repo, "docs/plans/approvals.json", '{"approvals":2}\n');
    commitAll(repo, "second approval");
    const docs = collectFormatDocuments({ records: [], repos: ["~/repo"], home: root });
    expect(summary(docs)).toEqual(
      [
        'plan-approvals ~/repo@git:docs/plans/approvals.json {"approvals":1}\n',
        'plan-approvals ~/repo@git:docs/plans/approvals.json {"approvals":2}\n',
        'spec-document ~/repo@git:docs/specs/2609241238-x.json {"spec":1}\n',
      ].toSorted(),
    );
  });

  it("walks the registry and every live and archived run directory of a phax home", () => {
    const phaxHome = join(root, ".phax");
    write(phaxHome, "registry.json", '{"registry":1}\n');
    write(phaxHome, "runs/run-a/run-status.json", '{"run":1}\n');
    write(phaxHome, "runs/run-a/phase-01/status.json", '{"phase":1}\n');
    write(phaxHome, "runs/run-a/phase-01/nested/status.json", '{"skipped":1}\n');
    write(phaxHome, "runs/run-a/other/status.json", '{"skipped":2}\n');
    write(phaxHome, "archive/old/runs/phax-plan.json", '{"plan":1}\n');
    const docs = collectFormatDocuments({
      phaxHome: "~/.phax",
      records: [],
      repos: [],
      home: root,
    });
    expect(summary(docs)).toEqual(
      [
        'phax-plan ~/.phax/archive/old/runs/phax-plan.json {"plan":1}\n',
        'phase-status ~/.phax/runs/run-a/phase-01/status.json {"phase":1}\n',
        'registry ~/.phax/registry.json {"registry":1}\n',
        'run-status ~/.phax/runs/run-a/run-status.json {"run":1}\n',
      ].toSorted(),
    );
    for (const d of docs) expect(d.source.startsWith("~/")).toBe(true);
  });

  it("returns sources in order: phax home, records, then repositories", () => {
    write(join(root, ".phax"), "registry.json", "{}\n");
    makeRecordsRepo(join(root, "records"));
    const repo = join(root, "repo");
    initRepo(repo);
    write(repo, "docs/specs/approvals.json", "{}\n");
    commitAll(repo, "docs");
    const docs = collectFormatDocuments({
      phaxHome: "~/.phax",
      records: ["~/records"],
      repos: ["~/repo"],
      home: root,
    });
    expect(docs[0]?.format).toBe("registry");
    expect(docs.at(-1)?.format).toBe("spec-approvals");
  });
});

describe("classification by location", () => {
  it("classifies records-branch paths", () => {
    expect(classifyRecordPath("run/phase-01/record.json")).toBe("phase-record-manifest");
    expect(classifyRecordPath("authoring/spec-1/record.json")).toBe("authoring-record-manifest");
    expect(classifyRecordPath("run/phase-01/status.json")).toBe("phase-status");
    expect(classifyRecordPath("run/phase-01/gate-attribution.json")).toBe("gate-attribution");
    expect(classifyRecordPath("run/phase-01/file-reconciliation.json")).toBe(
      "phase-file-reconciliation",
    );
    expect(classifyRecordPath("run/phase-01/checks-attempt-02.diagnostics.json")).toBe(
      "gate-diagnostics",
    );
    expect(classifyRecordPath("run/phase-01/checks-attempt-02.pending.json")).toBe("gate-pending");
    expect(classifyRecordPath("run/phase-01/checks-attempt-x.pending.json")).toBeNull();
    expect(classifyRecordPath("run/phase-01/summary.md")).toBeNull();
  });

  it("classifies repository paths", () => {
    expect(classifyRepoPath("docs/specs/approvals.json")).toBe("spec-approvals");
    expect(classifyRepoPath("docs/plans/approvals.json")).toBe("plan-approvals");
    expect(classifyRepoPath("docs/specs/2609241238-x.json")).toBe("spec-document");
    expect(classifyRepoPath("docs/specs/archive/2609241238-x.json")).toBe("spec-document");
    expect(classifyRepoPath("docs/plans/2609241238-x.json")).toBe("plan-document");
    expect(classifyRepoPath("docs/plans/archive/2609241238-x.json")).toBe("plan-document");
    expect(classifyRepoPath("docs/plans/nested/deep/x.json")).toBeNull();
    expect(classifyRepoPath("docs/plans/x.md")).toBeNull();
    expect(classifyRepoPath("src/approvals.json")).toBeNull();
  });

  it("classifies run-directory files", () => {
    expect(classifyRunDirFile("run-status.json")).toBe("run-status");
    expect(classifyRunDirFile("phax-plan.json")).toBe("phax-plan");
    expect(classifyRunDirFile("compliance-review.json")).toBe("compliance-review");
    expect(classifyRunDirFile("phase-01/status.json")).toBe("phase-status");
    expect(classifyRunDirFile("phase-01/record.json")).toBe("phase-record-manifest");
    expect(classifyRunDirFile("phase-01/file-reconciliation.json")).toBe(
      "phase-file-reconciliation",
    );
    expect(classifyRunDirFile("phase-01/checks-attempt-01.pending.json")).toBe("gate-pending");
    expect(classifyRunDirFile("status.json")).toBeNull();
    expect(classifyRunDirFile("registry.json")).toBeNull();
    expect(classifyRunDirFile("phase-01/summary.md")).toBeNull();
  });

  it("expands and shortens home-relative paths", () => {
    expect(expandHome("~/x/y", "/h/me")).toBe("/h/me/x/y");
    expect(expandHome("/abs/p", "/h/me")).toBe("/abs/p");
    expect(shortenHome("/h/me/x", "/h/me")).toBe("~/x");
    expect(shortenHome("/other/x", "/h/me")).toBe("/other/x");
  });
});
