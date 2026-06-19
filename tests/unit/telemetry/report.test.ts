import { describe, expect, it } from "vitest";
import {
  buildReportTitle,
  buildReportBody,
  buildFullLog,
  needsGist,
  BODY_THRESHOLD_BYTES,
  TAIL_SIZE,
  type ReportMetadata,
} from "../../../src/domain/telemetry/report.js";

const META: ReportMetadata = {
  phaxVersion: "0.1.2",
  nodeVersion: "v22.0.0",
  platform: "linux",
  arch: "arm64",
  source: "run: my-run",
};

describe("buildReportTitle", () => {
  it("includes the source in the title", () => {
    expect(buildReportTitle(META)).toBe("phax telemetry report: run: my-run");
  });

  it("uses global source when provided", () => {
    const meta = { ...META, source: "global: 2026-06-19" };
    expect(buildReportTitle(meta)).toContain("global: 2026-06-19");
  });
});

describe("buildFullLog", () => {
  it("joins records with newlines", () => {
    const records = ['{"a":1}', '{"b":2}'];
    expect(buildFullLog(records)).toBe('{"a":1}\n{"b":2}');
  });

  it("returns empty string for empty records", () => {
    expect(buildFullLog([])).toBe("");
  });
});

describe("needsGist", () => {
  it("returns false for small logs", () => {
    expect(needsGist("small log")).toBe(false);
  });

  it("returns true when log exceeds threshold", () => {
    const bigLog = "x".repeat(BODY_THRESHOLD_BYTES + 1);
    expect(needsGist(bigLog)).toBe(true);
  });

  it("threshold is 32KB", () => {
    expect(BODY_THRESHOLD_BYTES).toBe(32 * 1024);
  });
});

describe("buildReportBody", () => {
  it("includes environment metadata", () => {
    const body = buildReportBody(META, [], undefined);
    expect(body).toContain("0.1.2");
    expect(body).toContain("v22.0.0");
    expect(body).toContain("linux/arm64");
    expect(body).toContain("run: my-run");
  });

  it("includes tail size label", () => {
    const body = buildReportBody(META, [], undefined);
    expect(body).toContain(`## Recent events (last ${String(TAIL_SIZE)})`);
  });

  it("shows (no events recorded) when no records", () => {
    const body = buildReportBody(META, [], undefined);
    expect(body).toContain("(no events recorded)");
  });

  it("includes recent events in json fence", () => {
    const records = ['{"type":"step.started","step":"do-thing"}'];
    const body = buildReportBody(META, records, undefined);
    expect(body).toContain("step.started");
    expect(body).toContain("```json");
  });

  it("includes only the last TAIL_SIZE records in the recent events section", () => {
    const records = Array.from({ length: TAIL_SIZE + 10 }, (_, i) => `{"i":${String(i)}}`);
    const body = buildReportBody(META, records, "https://gist.github.com/fake");
    // With a gist URL there's no inline full log, so first record won't appear
    expect(body).not.toContain('"i":0}');
    // Last record should appear in the tail
    expect(body).toContain(`"i":${String(TAIL_SIZE + 9)}`);
  });

  it("inlines full log when no gistUrl and log is not empty", () => {
    const records = ['{"type":"step.started"}'];
    const body = buildReportBody(META, records, undefined);
    expect(body).toContain("Full log");
    expect(body).toContain("<details>");
    expect(body).toContain("1 records");
  });

  it("references gist URL when provided", () => {
    const gistUrl = "https://gist.github.com/user/abc123";
    const body = buildReportBody(META, ['{"type":"x"}'], gistUrl);
    expect(body).toContain(gistUrl);
    expect(body).not.toContain("<details>");
  });

  it("shows (empty) when no records and no gist", () => {
    const body = buildReportBody(META, [], undefined);
    expect(body).toContain("(empty)");
  });
});
