import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup/providerStores.ts", "tests/setup/phaxHomeGuard.ts"],
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Integration tests spawn the CLI through `tsx`, run git and copy trees. Alone each
          // takes a second or two; under a full suite on a loaded machine (a phase gate, a
          // release cut) several took over the 5 s default and failed a green change.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
