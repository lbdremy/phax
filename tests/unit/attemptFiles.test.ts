import { describe, expect, it } from "vitest";
import {
  attemptLogName,
  attemptNumberOf,
  fixTranscriptName,
  lastRecordedAttempt,
  nextAttemptNumber,
  previousRecordedAttempt,
  recordedAttempts,
  stepRecordPathFor,
} from "../../src/domain/gate/attemptFiles.js";

describe("attemptNumberOf", () => {
  it("reads the number of every per-attempt file", () => {
    expect(attemptNumberOf("checks-attempt-03.log")).toBe(3);
    expect(attemptNumberOf("checks-attempt-03.request.json")).toBe(3);
    expect(attemptNumberOf("checks-attempt-03.attribution.json")).toBe(3);
    expect(attemptNumberOf("checks-attempt-03.report-02.json")).toBe(3);
    expect(attemptNumberOf("fix-attempt-03.jsonl")).toBe(3);
    expect(attemptNumberOf("checks-attempt-100.log")).toBe(100);
  });

  it("gives undefined for any other name", () => {
    for (const name of [
      "gate-attribution.json",
      "brief-03.json",
      "status.json",
      "checks-attempt-3.log",
      "checks-attempt-03.txt",
      "checks-attempt-03.report-2.json",
      "fix-attempt-03.json",
    ]) {
      expect(attemptNumberOf(name)).toBeUndefined();
    }
  });
});

describe("nextAttemptNumber", () => {
  it("is 1 in an empty folder", () => {
    expect(nextAttemptNumber([])).toBe(1);
  });

  it("is one above the highest number on any per-attempt file", () => {
    expect(nextAttemptNumber(["checks-attempt-01.log", "fix-attempt-02.jsonl"])).toBe(3);
  });

  it("counts a cut-short attempt's files, which have no log", () => {
    expect(
      nextAttemptNumber([
        "checks-attempt-03.log",
        "checks-attempt-04.request.json",
        "checks-attempt-04.report-01.json",
      ]),
    ).toBe(5);
  });

  it("reads numbers of any digit count", () => {
    expect(nextAttemptNumber(["checks-attempt-100.log"])).toBe(101);
  });

  it("ignores files that carry no attempt number", () => {
    expect(nextAttemptNumber(["gate-attribution.json", "brief-03.json"])).toBe(1);
  });
});

describe("recorded attempts", () => {
  const names = [
    "checks-attempt-10.log",
    "checks-attempt-03.log",
    "checks-attempt-04.request.json",
    "checks-attempt-04.report-01.json",
    "fix-attempt-03.jsonl",
    "checks-attempt-01.log",
  ];

  it("lists the attempts that have a log, ascending", () => {
    expect(recordedAttempts(names)).toEqual([1, 3, 10]);
  });

  it("takes the previous recorded attempt, skipping a cut-short one", () => {
    expect(previousRecordedAttempt(names, 5)).toBe(3);
    expect(previousRecordedAttempt(names, 11)).toBe(10);
    expect(previousRecordedAttempt(names, 1)).toBeUndefined();
    expect(previousRecordedAttempt([], 1)).toBeUndefined();
  });

  it("takes the last recorded attempt", () => {
    expect(lastRecordedAttempt(names)).toBe(10);
    expect(lastRecordedAttempt(["checks-attempt-04.request.json"])).toBeUndefined();
  });
});

describe("attempt file names", () => {
  it("pads to two digits and leaves longer numbers as they are", () => {
    expect(attemptLogName(3)).toBe("checks-attempt-03.log");
    expect(attemptLogName(101)).toBe("checks-attempt-101.log");
    expect(fixTranscriptName(3)).toBe("fix-attempt-03.jsonl");
    expect(fixTranscriptName(101)).toBe("fix-attempt-101.jsonl");
  });

  it("names the step record beside the attempt log", () => {
    expect(stepRecordPathFor("/runs/r/phase-01/checks-attempt-03.log")).toBe(
      "/runs/r/phase-01/checks-attempt-03.attribution.json",
    );
    expect(stepRecordPathFor("attempt")).toBe("attempt.attribution.json");
  });
});
