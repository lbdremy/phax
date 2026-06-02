import { spawnSync } from "node:child_process";

export interface BackendEntry {
  readonly executable: string;
  readonly requestedModel: string;
}

const BACKEND_REGISTRY: Readonly<Record<string, BackendEntry>> = {
  "claude-code-cli": {
    executable: "claude",
    requestedModel: "claude-haiku-4-5-20251001",
  },
  "mistral-vibe": {
    executable: "vibe",
    requestedModel: "mistral-medium",
  },
  "codex-cli": {
    executable: "codex",
    requestedModel: "gpt-5.5",
  },
};

export interface ResolvedBackend {
  readonly id: string;
  readonly entry: BackendEntry;
}

export function resolveBackend(envValue: string | undefined): ResolvedBackend {
  const id = envValue ?? "claude-code-cli";
  const entry = BACKEND_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `Unknown PHAX_E2E_BACKEND value: "${id}". Known backends: ${Object.keys(BACKEND_REGISTRY).join(", ")}`,
    );
  }
  return { id, entry };
}

export function probeBackend(entry: BackendEntry): boolean {
  try {
    const r = spawnSync(entry.executable, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: "pipe",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}
