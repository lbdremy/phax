import { Context } from "effect";

/**
 * The phax home a provider session is handed as PHAX_HOME: the home of the run the session
 * serves (its recorded home), or the current home for a command that serves no run. The CLI
 * edge provides it beside the backend (`makeProviderBackendLayer`); the Claude Code, Codex and
 * Vibe adapters read it when they spawn a session and set PHAX_HOME to it, on top of the
 * environment they build, adding nothing else. The default holds no home: the session's
 * environment is then exactly what the adapter builds.
 */
export const SessionPhaxHome = Context.Reference<string | undefined>("phax/SessionPhaxHome", {
  defaultValue: (): string | undefined => undefined,
});

/** `env` with PHAX_HOME set to `home`; `env` itself when there is no home. */
export function withSessionPhaxHome<E extends Readonly<Record<string, string | undefined>>>(
  env: E,
  home: string | undefined,
): E | (E & { readonly PHAX_HOME: string }) {
  return home === undefined ? env : { ...env, PHAX_HOME: home };
}
