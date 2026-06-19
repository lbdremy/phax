import { describe, expect, it } from "vitest";
import {
  buildResumeInstructions,
  type ResumeInstructionsInput,
} from "../../src/app/resumeInstructions.js";

const NOW = new Date("2026-06-19T12:00:00.000Z");
const FUTURE_RESET = "2026-06-19T13:00:00.000Z";

const BASE: ResumeInstructionsInput = {
  runPath: "/runs/my-run",
  shortName: "my-run",
  reason: "Rate limit",
  now: NOW,
  platform: "darwin",
};

describe("buildResumeInstructions — limit variant", () => {
  it("contains caffeinate command for darwin when resetAt is in the future", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: FUTURE_RESET });
    expect(md).toContain("caffeinate -i");
    expect(md).toContain("phax resume my-run --yes --verbose");
  });

  it("contains systemd-inhibit command for linux", () => {
    const md = buildResumeInstructions({
      ...BASE,
      platform: "linux",
      resetAt: FUTURE_RESET,
    });
    expect(md).toContain("systemd-inhibit --what=idle:sleep");
    expect(md).toContain("phax resume my-run --yes --verbose");
  });

  it("falls back to plain resume command when resetAt is absent", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: undefined });
    expect(md).toContain("phax resume my-run --yes --verbose");
    expect(md).not.toContain("caffeinate");
  });

  it("includes enter-phase step when phaseId is present", () => {
    const md = buildResumeInstructions({ ...BASE, phaseId: "phase-02" });
    expect(md).toContain("phax enter-phase my-run phase-02");
  });

  it("preserves the Why it stopped section", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: FUTURE_RESET });
    expect(md).toContain("## Why it stopped");
    expect(md).toContain("Rate limit");
  });

  it("appends the raw message when present", () => {
    const md = buildResumeInstructions({ ...BASE, rawMessage: "quota exceeded" });
    expect(md).toContain("quota exceeded");
  });
});

describe("buildResumeInstructions — gates_exhausted variant", () => {
  const gateBase: ResumeInstructionsInput = {
    ...BASE,
    kind: "gates_exhausted",
    reason: "Gate attempts exhausted",
    phaseId: "phase-03",
  };

  it("contains enter-phase command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax enter-phase my-run phase-03");
  });

  it("contains resume command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax resume my-run --yes");
  });

  it("contains reset-phase command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax reset-phase my-run phase-03");
  });

  it("preserves the Why it stopped section", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("## Why it stopped");
  });

  it("uses placeholder when phaseId is absent", () => {
    const md = buildResumeInstructions({ ...gateBase, phaseId: undefined });
    expect(md).toContain("<phase-id>");
  });
});
