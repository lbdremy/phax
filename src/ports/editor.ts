import { Context, Data, Effect } from "effect";

export class EditorError extends Data.TaggedError("EditorError")<{
  message: string;
  cause?: unknown;
}> {}

export interface EditorOps {
  open(path: string): Effect.Effect<void, EditorError>;
}

export class Editor extends Context.Tag("phax/Editor")<Editor, EditorOps>() {}
