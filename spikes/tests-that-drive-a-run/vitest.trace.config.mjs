// The integration project of vitest.config.ts, unchanged (include globs, pool, isolation,
// timeouts, its setup files), with one more setup file: trace-setup.mjs, which records git's
// trace, the run-driving helpers' calls and the children each test starts. Only
// spikes/tests-that-drive-a-run/measure.mjs runs it, with PHAX_MEASURE_TRACE_DIR set.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const integration = base.test.projects.find((p) => p.test?.name === "integration");
if (integration === undefined) throw new Error("vitest.config.ts has no integration project");

export default defineConfig({
  root,
  test: {
    ...base.test,
    setupFiles: [
      base.test.setupFiles ?? [],
      "spikes/tests-that-drive-a-run/trace-setup.mjs",
    ].flat(),
    projects: [integration],
  },
});
