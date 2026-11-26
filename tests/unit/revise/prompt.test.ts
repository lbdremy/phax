import { describe, expect, it } from "vitest";
import { serializeSidecar } from "../../../src/domain/artifact/sidecar.js";
import { buildRevisePrompt, buildReviseRetryPrompt } from "../../../src/domain/revise/prompt.js";
import { GATE_PROFILES, GATE_PROFILE_SECTION } from "../../helpers/gateProfilePrompt.js";
import { SPEC } from "../decide/verdictsFixtures.js";

const INPUT = {
  kind: "spec",
  artifactPath: "docs/specs/2610250900-log-rotation.md",
  session: "new",
  skillText: "SKILL-TEXT-MARKER: how a spec is authored.",
  brief: "BRIEF-MARKER: rotate the logs.",
  document: SPEC,
  amendment: "AMENDMENT-MARKER: keep twenty logs.\n  second line",
  schemaUrl: "https://example.test/spec-document.json",
  gateProfiles: null,
} as const;

describe("buildRevisePrompt", () => {
  it("a new session carries the skill, the kept brief, the document and the amendment", () => {
    const prompt = buildRevisePrompt(INPUT);
    expect(prompt).toContain("SKILL-TEXT-MARKER");
    expect(prompt).toContain("BRIEF-MARKER");
    expect(prompt).toContain(serializeSidecar(SPEC).trimEnd());
    expect(prompt).toContain("AMENDMENT-MARKER: keep twenty logs.\n  second line");
    expect(prompt).toContain(INPUT.schemaUrl);
    expect(prompt.indexOf("SKILL-TEXT-MARKER")).toBeLessThan(prompt.indexOf("BRIEF-MARKER"));
  });

  it("a resumed prompt carries the document and amendment without skill or brief", () => {
    const prompt = buildRevisePrompt({ ...INPUT, session: "resume" });
    expect(prompt).not.toContain("SKILL-TEXT-MARKER");
    expect(prompt).not.toContain("BRIEF-MARKER");
    expect(prompt).toContain(serializeSidecar(SPEC).trimEnd());
    expect(prompt).toContain("AMENDMENT-MARKER");
  });

  it("leaves out a null brief", () => {
    const prompt = buildRevisePrompt({ ...INPUT, brief: null });
    expect(prompt).toContain("SKILL-TEXT-MARKER");
    expect(prompt).not.toContain("authored from");
  });

  it("states the rules", () => {
    const prompt = buildRevisePrompt(INPUT);
    expect(prompt).toContain("Never change, remove or reorder a question");
    expect(prompt).toContain("appended at the end of the open questions");
  });
});

describe("the gate profiles in a revision prompt", () => {
  const rule = "- `run.gateProfile` names exactly one of the gate profiles below.";

  it("a plan prompt adds the rule, then the profile list after the rules", () => {
    const prompt = buildRevisePrompt({ ...INPUT, kind: "plan", gateProfiles: GATE_PROFILES });
    expect(prompt).toContain(
      `- Write no files: this session is read-only.\n${rule}\n\n${GATE_PROFILE_SECTION}\n\n## The current document (`,
    );
  });

  it("a spec prompt carries neither", () => {
    expect(buildRevisePrompt(INPUT)).not.toMatch(/Gate profile|gateProfile/);
  });
});

describe("buildReviseRetryPrompt", () => {
  it("names the refusal and asks for the whole document again", () => {
    const prompt = buildReviseRetryPrompt("openQuestions[1]: the writer changed question q-scope");
    expect(prompt).toContain("openQuestions[1]: the writer changed question q-scope");
    expect(prompt).toContain("whole revised document again");
  });
});
