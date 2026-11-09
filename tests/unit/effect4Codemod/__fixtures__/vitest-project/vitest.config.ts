// A vitest project the test ratchet's smoke test runs with the real runner. Its files end
// in `.check.ts`, so the repository's own suite never collects them.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["passing.check.ts", "failing.check.ts", "skipped.check.ts"],
        },
      },
      {
        extends: true,
        test: { name: "integration", include: ["flaky.check.ts"] },
      },
      {
        // Not run by the ratchet: it asks for the unit and integration projects only.
        extends: true,
        test: { name: "other", include: ["*.check.ts"] },
      },
    ],
  },
});
