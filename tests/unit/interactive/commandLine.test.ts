import { describe, expect, it } from "vitest";
import { renderCommandLine, shellQuote } from "../../../src/domain/interactive/commandLine.js";

describe("shellQuote", () => {
  it("single-quotes a plain word", () => {
    expect(shellQuote("claude")).toBe("'claude'");
  });

  it("keeps spaces, double quotes and dollars literal", () => {
    expect(shellQuote('model_reasoning_effort="medium"')).toBe(`'model_reasoning_effort="medium"'`);
    expect(shellQuote("a b $HOME")).toBe("'a b $HOME'");
  });

  it("writes an embedded single quote as '\\''", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("quotes the empty word", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("renderCommandLine", () => {
  it("renders cd, the quoted cwd and every quoted argv word", () => {
    expect(
      renderCommandLine({
        cwd: "/Users/ada/my worktree/phase-03",
        argv: [
          "codex",
          "resume",
          "019a2f6e",
          "-c",
          `sandbox_workspace_write.writable_roots=["/a b"]`,
        ],
        env: {},
      }),
    ).toBe(
      `cd '/Users/ada/my worktree/phase-03' && 'codex' 'resume' '019a2f6e' '-c' 'sandbox_workspace_write.writable_roots=["/a b"]'`,
    );
  });

  it("puts quoted environment assignments before the argv", () => {
    expect(
      renderCommandLine({
        cwd: "/wt",
        argv: ["vibe", "--workdir", "/wt", "Read it's seed"],
        env: { VIBE_ACTIVE_MODEL: "phax-mistral-medium-3.5-high" },
      }),
    ).toBe(
      `cd '/wt' && VIBE_ACTIVE_MODEL='phax-mistral-medium-3.5-high' 'vibe' '--workdir' '/wt' 'Read it'\\''s seed'`,
    );
  });

  it("refuses an environment name a shell would not read as an assignment", () => {
    expect(() => renderCommandLine({ cwd: "/wt", argv: ["x"], env: { "A B": "1" } })).toThrow(
      /environment variable name/,
    );
  });
});
