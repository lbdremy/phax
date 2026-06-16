import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { Editor, EditorError } from "../ports/editor.js";

const osOpener = process.platform === "darwin" ? "open" : "xdg-open";

export function makeNodeEditorLayer(): Layer.Layer<Editor> {
  return Layer.succeed(Editor, {
    open: (path: string) =>
      Effect.try({
        try: () => {
          const proc = spawn(osOpener, [path], { detached: true, stdio: "ignore" });
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
