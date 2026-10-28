// Every unit and integration suite runs with the provider store variables
// empty, which phax reads as unset (`resolveProviderStoreRoots`), so a
// suite's stubbed HOME governs every provider store, in the test process and
// in any child that inherits its environment. Not used by vitest.e2e.config.ts,
// which also backs `test:e2e:real`: a real provider binary would read an
// empty value.
for (const variable of ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
  process.env[variable] = "";
}
