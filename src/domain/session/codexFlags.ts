import { SecurityEnforcementError } from "../errors.js";
import type { SecurityPolicy } from "../security/types.js";

/** The `providers.json` entry fields the model lookup reads. */
export interface CodexModelEntry {
  readonly families?:
    | Readonly<Record<string, { readonly models?: readonly { readonly id: string }[] | undefined }>>
    | undefined;
}

/**
 * The model id codex runs a phase on: the provider entry's first `openai-gpt`
 * model id when `providers.json` names one, else the resolved model. The
 * headless argv and the continue and fresh-start commands all use it, so a
 * continued session runs the model the headless phase ran.
 */
export function codexModelId(entry: CodexModelEntry, model: string): string {
  return entry.families?.["openai-gpt"]?.models?.[0]?.id ?? model;
}

/**
 * Map a resolved effort (already an openai-gpt level: low|medium|high|xhigh,
 * with the legacy off|max kept as safe synonyms) to the value codex accepts
 * for `model_reasoning_effort`. Codex does not accept `xhigh`; clamp it to
 * `high`.
 */
export function mapReasoningEffort(effort: string): string {
  switch (effort) {
    case "off":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return "medium";
  }
}

/**
 * The `approval_policy` a codex command carries. Headless runs use `never`
 * (nobody can approve); an interactive continue command may use `on-request`
 * so the person approves anything outside the sandbox.
 */
export type CodexApprovalPolicy = "never" | "on-request";

// Centralized secure-mode Codex flag set. Runbook 04b will validate which of
// these the installed `codex` CLI actually enforces; corrections feed back
// here. Today's surface:
//   -c sandbox_mode="workspace-write"
//       Restricts subprocess writes to the workspace + writable_roots and (with
//       network_access=false) blocks subprocess network. Replaces the
//       --dangerously-bypass-approvals-and-sandbox vector used in unsafe mode.
//       Uses the `-c` config-override form rather than the `-s/--sandbox` flag
//       because `codex exec resume` (verified 0.136.0) does NOT accept
//       `--sandbox` — passing it makes clap reject the whole vector ("unexpected
//       argument '--sandbox'") and the secure handoff resume exits with code 2.
//       The `sandbox_mode` config key is accepted by both `codex exec` and
//       `codex exec resume` and is verified recognized under `--strict-config`.
//   -c approval_policy="never"
//       Non-interactive approval that does NOT silently escape the sandbox: a
//       sandbox denial fails the action instead of escalating to host-level
//       execution. NOTE: `codex exec` (verified 0.136.0 in runbook 04b) has NO
//       `-a`/`--ask-for-approval` flag — passing `-a never` makes clap reject
//       the whole vector ("unexpected argument '-a'"), so secure runs never
//       start. The config-key form `approval_policy="never"` is the exec-
//       compatible equivalent and was confirmed live to block an out-of-root
//       write without re-running it unsandboxed. An interactive session at a
//       stop carries `on-request` instead, so the person approves what leaves
//       the sandbox.
//   -c sandbox_workspace_write.writable_roots=[...]
//       JSON-encoded list of writable roots (worktree + ~/.phax + configured).
//       Codex de-duplicates roots; including cwd is harmless.
//   -c sandbox_workspace_write.network_access=true|false
//       Controls subprocess network. provider-only → false (most conservative;
//       the codex parent process still reaches api.openai.com outside the
//       sandbox boundary). dev-allowlist/open → true. Codex offers no
//       domain-level allowlist, and the policy carries none — only the binary
//       network.profile maps here (04b confirmed no provider enforces domains).
//
// Not yet expressible via Codex CLI flags (tracked in 04b):
//   - Per-command allowlist: Codex provides no command-level restriction flag.
//     The frozen agentCommands set (config ∪ gates) is recorded in security.json
//     with enforcement: "none"; the sandbox boundary is the effective constraint.
//   - MCP scoping: codex configures MCP via [mcp_servers.*] tables in
//     ~/.codex/config.toml. There is no single-flag disable that PHAX can rely
//     on across versions. The resolved mcp policy is carried on SecurityPolicy
//     and recorded in security.json; live enforcement awaits 04b confirmation
//     of an override surface (or the future external sandbox).
export function buildCodexSecurityFlags(
  security: SecurityPolicy,
  approval: CodexApprovalPolicy = "never",
): string[] {
  if (security.mode === "unsafe") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  // secure / isolated (CLI gates isolated before reaching here; treat as
  // secure for type totality).
  if (security.filesystem.allowWrite.length === 0) {
    throw new SecurityEnforcementError({
      message:
        "Codex CLI secure mode requires at least one writable path in the security policy; refusing to run with danger-full-access.",
      provider: "codex-cli",
      mode: security.mode,
    });
  }

  const writableRootsJson = JSON.stringify([...security.filesystem.allowWrite]);
  const networkAccess = security.network.profile !== "provider-only";

  return [
    "-c",
    `sandbox_mode="workspace-write"`,
    "-c",
    `approval_policy="${approval}"`,
    "-c",
    `sandbox_workspace_write.writable_roots=${writableRootsJson}`,
    "-c",
    `sandbox_workspace_write.network_access=${networkAccess}`,
  ];
}
