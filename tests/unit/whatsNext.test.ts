import { describe, expect, it } from "vitest";
import {
  RESUME_BUFFER_SECONDS,
  buildWhatsNext,
  renderWhatsNext,
  resumeWhenClearCommand,
  secondsUntil,
  toKeepAwakePlatform,
} from "../../src/domain/whatsNext.js";

const NOW = new Date("2026-06-19T12:00:00.000Z");
const FUTURE = "2026-06-19T13:00:00.000Z"; // 3600s ahead
const PAST = "2026-06-19T11:00:00.000Z";
const GARBAGE = "not-a-date";

describe("secondsUntil", () => {
  it("returns positive ceil for a future ISO string", () => {
    const result = secondsUntil(FUTURE, NOW);
    expect(result).toBe(3600);
  });

  it("returns undefined for a past ISO string", () => {
    expect(secondsUntil(PAST, NOW)).toBeUndefined();
  });

  it("returns undefined for now (diff = 0)", () => {
    expect(secondsUntil(NOW.toISOString(), NOW)).toBeUndefined();
  });

  it("returns undefined for unparseable strings", () => {
    expect(secondsUntil(GARBAGE, NOW)).toBeUndefined();
  });

  it("ceils fractional seconds", () => {
    const slightly = new Date(NOW.getTime() + 500); // 0.5s ahead of NOW
    // future is exactly 500ms ahead: diff=500ms, ceil(0.5)=1
    expect(secondsUntil(slightly.toISOString(), NOW)).toBe(1);
  });
});

describe("toKeepAwakePlatform", () => {
  it("maps darwin and linux through unchanged", () => {
    expect(toKeepAwakePlatform("darwin")).toBe("darwin");
    expect(toKeepAwakePlatform("linux")).toBe("linux");
  });

  it("maps any other platform to 'other'", () => {
    expect(toKeepAwakePlatform("win32")).toBe("other");
    expect(toKeepAwakePlatform("freebsd")).toBe("other");
    expect(toKeepAwakePlatform("")).toBe("other");
  });
});

describe("resumeWhenClearCommand", () => {
  it("returns undefined when resetAt is undefined", () => {
    expect(resumeWhenClearCommand("my-run", undefined, NOW, "darwin")).toBeUndefined();
  });

  it("returns undefined when resetAt is in the past", () => {
    expect(resumeWhenClearCommand("my-run", PAST, NOW, "darwin")).toBeUndefined();
  });

  it("returns a caffeinate command for darwin", () => {
    const cmd = resumeWhenClearCommand("my-run", FUTURE, NOW, "darwin");
    expect(cmd).toContain("caffeinate -i");
    expect(cmd).toContain(`sleep ${3600 + RESUME_BUFFER_SECONDS}`);
    expect(cmd).toContain("phax resume my-run --yes --verbose");
  });

  it("returns a systemd-inhibit command for linux", () => {
    const cmd = resumeWhenClearCommand("my-run", FUTURE, NOW, "linux");
    expect(cmd).toContain("systemd-inhibit --what=idle:sleep");
    expect(cmd).toContain(`sleep ${3600 + RESUME_BUFFER_SECONDS}`);
    expect(cmd).toContain("phax resume my-run --yes --verbose");
  });

  it("returns a bare sh -c command for other", () => {
    const cmd = resumeWhenClearCommand("my-run", FUTURE, NOW, "other");
    expect(cmd).toMatch(/^sh -c /);
    expect(cmd).not.toContain("caffeinate");
    expect(cmd).not.toContain("systemd-inhibit");
    expect(cmd).toContain(`sleep ${3600 + RESUME_BUFFER_SECONDS}`);
    expect(cmd).toContain("phax resume my-run --yes --verbose");
  });
});

describe("buildWhatsNext", () => {
  describe("limit scenario", () => {
    it("produces a timed auto-resume step with caffeinate for darwin + future resetAt", () => {
      const wn = buildWhatsNext(
        { kind: "limit", shortName: "proj", resetAt: FUTURE, platform: "darwin" },
        NOW,
      );
      expect(wn.headline).toContain("provider limit");
      const step = wn.steps[0];
      expect(step?.command).toContain("caffeinate -i");
      expect(step?.detail?.[0]).toContain(FUTURE);
    });

    it("produces a timed auto-resume step with systemd-inhibit for linux", () => {
      const wn = buildWhatsNext(
        { kind: "limit", shortName: "proj", resetAt: FUTURE, platform: "linux" },
        NOW,
      );
      expect(wn.steps[0]?.command).toContain("systemd-inhibit --what=idle:sleep");
    });

    it("produces a bare sh -c step for other", () => {
      const wn = buildWhatsNext(
        { kind: "limit", shortName: "proj", resetAt: FUTURE, platform: "other" },
        NOW,
      );
      expect(wn.steps[0]?.command).toMatch(/^sh -c /);
      expect(wn.steps[0]?.command).not.toContain("caffeinate");
    });

    it("falls back to a plain resume step when resetAt is absent", () => {
      const wn = buildWhatsNext({ kind: "limit", shortName: "proj", platform: "darwin" }, NOW);
      expect(wn.steps[0]?.command).toContain("phax resume proj --yes --verbose");
      expect(wn.steps[0]?.detail?.[0]).toContain("Reset time was not reported");
    });

    it("falls back when resetAt is in the past", () => {
      const wn = buildWhatsNext(
        { kind: "limit", shortName: "proj", resetAt: PAST, platform: "darwin" },
        NOW,
      );
      expect(wn.steps[0]?.command).toContain("phax resume proj --yes --verbose");
      expect(wn.steps[0]?.detail?.[0]).toContain(PAST);
    });

    it("appends enter-phase step when phaseId is present", () => {
      const wn = buildWhatsNext(
        {
          kind: "limit",
          shortName: "proj",
          resetAt: FUTURE,
          phaseId: "phase-02",
          platform: "darwin",
        },
        NOW,
      );
      expect(wn.steps).toHaveLength(2);
      expect(wn.steps[1]?.command).toContain("phax enter-phase proj phase-02");
    });

    it("does not append enter-phase step when phaseId is absent", () => {
      const wn = buildWhatsNext(
        { kind: "limit", shortName: "proj", resetAt: FUTURE, platform: "darwin" },
        NOW,
      );
      expect(wn.steps).toHaveLength(1);
    });
  });

  describe("gates_exhausted scenario", () => {
    it("produces the three expected steps with phaseId", () => {
      const wn = buildWhatsNext(
        { kind: "gates_exhausted", shortName: "proj", phaseId: "phase-03" },
        NOW,
      );
      expect(wn.headline).toContain("Gates failed");
      expect(wn.steps[0]?.command).toContain("phax enter-phase proj phase-03");
      expect(wn.steps[1]?.command).toContain("phax resume proj --yes");
      expect(wn.steps[2]?.command).toContain("phax reset-phase proj phase-03");
    });

    it("uses <phase-id> placeholder when phaseId is absent", () => {
      const wn = buildWhatsNext({ kind: "gates_exhausted", shortName: "proj" }, NOW);
      expect(wn.steps[0]?.command).toContain("phax enter-phase proj <phase-id>");
      expect(wn.steps[2]?.command).toContain("phax reset-phase proj <phase-id>");
    });
  });

  describe("phase_no_changes scenario", () => {
    it("produces resume and enter-phase steps", () => {
      const wn = buildWhatsNext(
        { kind: "phase_no_changes", shortName: "proj", phaseId: "phase-01" },
        NOW,
      );
      expect(wn.headline).toContain("no changes");
      expect(wn.steps[0]?.command).toContain("phax resume proj --yes");
      expect(wn.steps[1]?.command).toContain("phax enter-phase proj phase-01");
    });
  });

  describe("review_open scenario", () => {
    it("without prUrl: first step is publish-pr command", () => {
      const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
      expect(wn.steps[0]?.title).toContain("Publish a pull request");
      expect(wn.steps[0]?.command).toContain("phax publish-pr proj");
    });

    it("with prUrl: first step shows URL in detail with no command", () => {
      const wn = buildWhatsNext(
        { kind: "review_open", shortName: "proj", prUrl: "https://github.com/org/repo/pull/1" },
        NOW,
      );
      expect(wn.steps[0]?.title).toContain("View the pull request");
      expect(wn.steps[0]?.detail).toContain("https://github.com/org/repo/pull/1");
      expect(wn.steps[0]?.command).toBeUndefined();
    });

    it("steps appear in order: PR, open, shell, enter, archive", () => {
      const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
      expect(wn.steps).toHaveLength(5);
      expect(wn.steps[0]?.command).toContain("phax publish-pr proj");
      expect(wn.steps[1]?.command).toContain("phax open proj");
      expect(wn.steps[2]?.command).toContain("phax shell proj");
      expect(wn.steps[3]?.command).toContain("phax enter proj");
      expect(wn.steps[4]?.command).toContain("phax archive proj");
    });

    it("always includes open, shell, enter, and archive steps", () => {
      const wn = buildWhatsNext(
        { kind: "review_open", shortName: "proj", prUrl: "https://github.com/org/repo/pull/1" },
        NOW,
      );
      const commands = wn.steps.map((s) => s.command);
      expect(commands).toContain("phax open proj");
      expect(commands).toContain("phax shell proj");
      expect(commands).toContain("phax enter proj");
      expect(commands).toContain("phax archive proj");
    });

    it("headline includes phaseCount when provided", () => {
      const wn = buildWhatsNext({ kind: "review_open", shortName: "proj", phaseCount: 3 }, NOW);
      expect(wn.headline).toContain("3 phase(s) complete");
    });

    it("headline falls back to generic wording when phaseCount is absent", () => {
      const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
      expect(wn.headline).toContain("review");
      expect(wn.headline).toContain("complete");
    });
  });
});

describe("renderWhatsNext", () => {
  it("starts with a blank line then the headline", () => {
    const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
    const rendered = renderWhatsNext(wn);
    expect(rendered).toMatch(/^\n/);
    expect(rendered).toContain(wn.headline);
  });

  it("includes the Next steps: label", () => {
    const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
    expect(renderWhatsNext(wn)).toContain("Next steps:");
  });

  it("renders bullet titles with • prefix", () => {
    const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
    const rendered = renderWhatsNext(wn);
    expect(rendered).toContain("  • Open the review worktree");
  });

  it("renders commands on indented lines without a shell prefix", () => {
    const wn = buildWhatsNext({ kind: "review_open", shortName: "proj" }, NOW);
    const rendered = renderWhatsNext(wn);
    expect(rendered).toContain("    phax open proj");
    expect(rendered).not.toContain("$ phax");
  });

  it("renders detail lines indented under the step", () => {
    const wn = buildWhatsNext(
      { kind: "limit", shortName: "proj", resetAt: FUTURE, platform: "darwin" },
      NOW,
    );
    const rendered = renderWhatsNext(wn);
    expect(rendered).toContain(`    Limit resets at ${FUTURE}.`);
  });
});
