import { Either } from "effect";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ClaudeSessionId } from "../../domain/branded.js";
import { decodePhaseStatus, encodePhaseStatus } from "../../schemas/status.js";
import { patchAgentBindingSession } from "../../app/agentBinding.js";

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const rand = randomBytes(6).toString("hex");
  const tmpPath = `${filePath}.tmp.${rand}`;
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, filePath);
}

export async function persistSessionId(
  sessionId: ClaudeSessionId,
  phaseFolderPath: string,
): Promise<void> {
  const sessionIdPath = join(phaseFolderPath, "claude-session-id.txt");
  const statusPath = join(phaseFolderPath, "status.json");

  await writeAtomic(sessionIdPath, sessionId);

  try {
    const text = await readFile(statusPath, "utf8");
    const decoded = decodePhaseStatus(JSON.parse(text) as unknown);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        claudeSessionId: sessionId,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  } catch {
    // Status file absent or malformed — session-id.txt already written, continue.
  }

  await patchAgentBindingSession(phaseFolderPath, { sessionId, status: "running" });
}
