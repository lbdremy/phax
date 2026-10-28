import { Either, Schema } from "effect";

/**
 * What phax reads from `vibe -p --output streaming` (Vibe 3). Each line is a
 * typed entry (`message`, `effect`, `callback`) carrying the `sessionId` and
 * the `createdAt` (epoch milliseconds) of the session it belongs to. A
 * message's `content` is an array of blocks. Only those keys are decoded; the
 * rest of an entry is ignored, and a line that does not decode is skipped.
 */
const VibeEntryHeaderSchema = Schema.Struct({
  type: Schema.String,
  sessionId: Schema.NonEmptyString,
  createdAt: Schema.Number.pipe(Schema.finite()),
});

const VibeMessageSchema = Schema.Struct({
  type: Schema.Literal("message"),
  role: Schema.String,
  content: Schema.Array(Schema.Unknown),
});

const VibeTextBlockSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const decodeVibeEntryHeader = Schema.decodeUnknownEither(VibeEntryHeaderSchema);
const decodeVibeMessage = Schema.decodeUnknownEither(VibeMessageSchema);
const decodeVibeTextBlock = Schema.decodeUnknownEither(VibeTextBlockSchema);

function parseJsonLine(line: string): unknown {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A text block of a message's content, or undefined for any other block:
 * a `type: text` block whose `text` is not a string is not one either.
 */
function textOfBlock(block: unknown): string | undefined {
  const decoded = decodeVibeTextBlock(block);
  return Either.isRight(decoded) ? decoded.right.text : undefined;
}

/**
 * The text of the last assistant message of vibe's stream: the text blocks of
 * the last entry with `type: message` and `role: assistant` that holds at
 * least one `type: text` block, joined in order with no separator. Effect and
 * callback entries, other roles and messages without a text block are
 * skipped, as is any line that does not decode. `undefined` when there is no
 * such message.
 */
export function findVibeResultEvent(lines: readonly string[]): { finalText: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonLine(lines[i] ?? "");
    if (parsed === undefined) continue;
    const message = decodeVibeMessage(parsed);
    if (Either.isLeft(message) || message.right.role !== "assistant") continue;
    const texts = message.right.content.flatMap((block) => {
      const text = textOfBlock(block);
      return text === undefined ? [] : [text];
    });
    if (texts.length > 0) return { finalText: texts.join("") };
  }
  return undefined;
}

/** The session id and the creation time (epoch milliseconds) a stream's entry carries. */
export interface VibeStreamHead {
  readonly sessionId: string;
  readonly createdAt: number;
}

/**
 * The first entry of a stream that decodes, as its session id and creation
 * time: how a kept turn stream is told to belong to a session, and where it
 * falls among that session's turns. `undefined` when no line decodes.
 */
export function findVibeStreamHead(lines: readonly string[]): VibeStreamHead | undefined {
  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (parsed === undefined) continue;
    const header = decodeVibeEntryHeader(parsed);
    if (Either.isRight(header)) {
      return { sessionId: header.right.sessionId, createdAt: header.right.createdAt };
    }
  }
  return undefined;
}

/** A Vibe release as `vibe --version` prints it. */
export interface VibeVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * The first `major.minor.patch` triple in what `vibe --version` printed
 * (`vibe 3.0.3`), or undefined when the text holds none.
 */
export function parseVibeVersion(text: string): VibeVersion | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
