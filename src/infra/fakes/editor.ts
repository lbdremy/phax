import { Effect, Layer } from "effect";
import { Editor, type EditorOps } from "../../ports/editor.js";

export class FakeEditorImpl implements EditorOps {
  readonly openCalls: string[] = [];

  open(path: string): Effect.Effect<void> {
    this.openCalls.push(path);
    return Effect.void;
  }
}

export const makeFakeEditor = () => {
  const impl = new FakeEditorImpl();
  const layer = Layer.succeed(Editor, impl);
  return { impl, layer } as const;
};
