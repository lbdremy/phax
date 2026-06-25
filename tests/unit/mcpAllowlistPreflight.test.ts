import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { mcpAllowlistPreflight } from "../../src/app/executePlan.js";
import { SecurityPreflightError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";

describe("mcpAllowlistPreflight", () => {
  it("fails with SecurityPreflightError naming each offending entry", async () => {
    const fakeFs = makeFakeFileSystem();
    // neither "nx-mcp" nor "shadcn" is a file in the fake fs

    const result = await Effect.runPromise(
      Effect.either(
        mcpAllowlistPreflight({ mode: "allowlist", allow: ["nx-mcp", "shadcn"] }).pipe(
          Effect.provide(fakeFs.layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const err = result.left;
      expect(err).toBeInstanceOf(SecurityPreflightError);
      expect(err.message).toContain('"nx-mcp"');
      expect(err.message).toContain('"shadcn"');
      expect(err.message).toContain("paths to MCP server config files");
      expect(err.missing).toEqual(["nx-mcp", "shadcn"]);
    }
  });

  it("fails listing only the missing entries when some paths exist", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile("/configs/mcp-real.json", "{}");

    const result = await Effect.runPromise(
      Effect.either(
        mcpAllowlistPreflight({
          mode: "allowlist",
          allow: ["/configs/mcp-real.json", "nx-mcp"],
        }).pipe(Effect.provide(fakeFs.layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.missing).toEqual(["nx-mcp"]);
      expect(result.left.message).not.toContain("/configs/mcp-real.json");
    }
  });

  it("succeeds when all allow entries resolve to existing files", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile("/configs/server1.json", "{}");
    fakeFs.impl.setFile("/configs/server2.json", "{}");

    await expect(
      Effect.runPromise(
        mcpAllowlistPreflight({
          mode: "allowlist",
          allow: ["/configs/server1.json", "/configs/server2.json"],
        }).pipe(Effect.provide(fakeFs.layer)),
      ),
    ).resolves.toBeUndefined();
  });

  it("succeeds with an empty allow list", async () => {
    const fakeFs = makeFakeFileSystem();

    await expect(
      Effect.runPromise(
        mcpAllowlistPreflight({ mode: "allowlist", allow: [] }).pipe(Effect.provide(fakeFs.layer)),
      ),
    ).resolves.toBeUndefined();
  });

  it("skips the check entirely when mode is not allowlist", async () => {
    const fakeFs = makeFakeFileSystem();
    // "nonexistent-name" is not a file, but the check is skipped

    for (const mode of ["disabled", "local-only", "provider-default"] as const) {
      await expect(
        Effect.runPromise(
          mcpAllowlistPreflight({ mode, allow: ["nonexistent-name"] }).pipe(
            Effect.provide(fakeFs.layer),
          ),
        ),
      ).resolves.toBeUndefined();
    }
  });
});
