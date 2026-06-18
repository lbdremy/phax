import { Either } from "effect";
import { open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  decodePhaseAgentBinding,
  encodePhaseAgentBinding,
  type PhaseAgentBinding,
} from "../schemas/phaseAgentBinding.js";

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

export async function writeAgentBinding(
  phaseFolderPath: string,
  binding: PhaseAgentBinding,
): Promise<void> {
  const filePath = join(phaseFolderPath, "agent-binding.json");
  await writeAtomic(filePath, JSON.stringify(encodePhaseAgentBinding(binding), null, 2));
}

export async function patchAgentBindingSession(
  phaseFolderPath: string,
  patch: { sessionId: string; status: PhaseAgentBinding["status"] },
): Promise<void> {
  const filePath = join(phaseFolderPath, "agent-binding.json");
  try {
    const text = await readFile(filePath, "utf8");
    const decoded = decodePhaseAgentBinding(JSON.parse(text) as unknown);
    if (Either.isRight(decoded)) {
      const updated: PhaseAgentBinding = {
        ...decoded.right,
        sessionId: patch.sessionId,
        status: patch.status,
      };
      await writeAtomic(filePath, JSON.stringify(encodePhaseAgentBinding(updated), null, 2));
    }
  } catch {
    // Absent or malformed binding — no-op, mirrors persistSessionId's try/catch
  }
}

export async function patchAgentBindingStatus(
  phaseFolderPath: string,
  status: PhaseAgentBinding["status"],
): Promise<void> {
  const filePath = join(phaseFolderPath, "agent-binding.json");
  try {
    const text = await readFile(filePath, "utf8");
    const decoded = decodePhaseAgentBinding(JSON.parse(text) as unknown);
    if (Either.isRight(decoded)) {
      const updated: PhaseAgentBinding = { ...decoded.right, status };
      await writeAtomic(filePath, JSON.stringify(encodePhaseAgentBinding(updated), null, 2));
    }
  } catch {
    // Absent or malformed binding — no-op
  }
}

export async function readAgentBinding(
  phaseFolderPath: string,
): Promise<Either.Either<PhaseAgentBinding, string>> {
  const filePath = join(phaseFolderPath, "agent-binding.json");
  try {
    const text = await readFile(filePath, "utf8");
    const decoded = decodePhaseAgentBinding(JSON.parse(text) as unknown);
    if (Either.isRight(decoded)) {
      return Either.right(decoded.right);
    }
    return Either.left(`Failed to decode agent-binding.json: ${String(decoded.left)}`);
  } catch (err) {
    return Either.left(
      `Cannot read agent-binding.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
