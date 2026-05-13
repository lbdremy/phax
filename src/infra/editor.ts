import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { Editor, EditorError } from "../ports/editor.js";

export function makeNodeEditorLayer(command: string): Layer.Layer<Editor> {
  return Layer.succeed(Editor, {
    open: (path: string) =>
      Effect.try({
        try: () => {
          const proc = spawn(command, [path], { detached: true, stdio: "ignore" });
          proc.unref();
        },
        catch: (err): EditorError =>
          new EditorError({
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }),
  });
}
