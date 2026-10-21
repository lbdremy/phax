// The control under the hero's actions (the home's `video` frontmatter, whose
// files the build checks in site/public): it opens a modal dialog that plays
// the video, with its sound, from the click. Nothing loads before that click.
import { useFrontmatter } from "@rspress/core/runtime";
import { useRef, type ReactElement, type SyntheticEvent } from "react";
import type { HomeVideo } from "../build/pageMap.js";

// The test typecheck has no DOM library; the dialog and video APIs used here.
interface Modal {
  showModal(): void;
  close(): void;
}
interface Playable {
  play(): Promise<void>;
  pause(): void;
}

function isVideo(value: unknown): value is HomeVideo {
  if (typeof value !== "object" || value === null) return false;
  const { label, src, poster } = value as Record<string, unknown>;
  return typeof label === "string" && typeof src === "string" && typeof poster === "string";
}

export function WatchVideo(): ReactElement | null {
  const { frontmatter } = useFrontmatter();
  const video = frontmatter["video"];
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  if (!isVideo(video)) return null;

  const open = () => {
    (dialog.current as Modal | null)?.showModal();
    (player.current as Playable | null)?.play().catch(() => undefined);
  };
  const close = () => (dialog.current as Modal | null)?.close();
  // A click on the backdrop lands on the dialog itself, not on its content.
  const closeOnBackdrop = (event: SyntheticEvent) => {
    if (event.target === event.currentTarget) close();
  };

  return (
    <>
      <button type="button" className="phax-watch" onClick={open}>
        <span className="phax-watch__play" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
          </svg>
        </span>
        {video.label}
      </button>
      <dialog
        className="phax-watch__dialog"
        ref={dialog}
        aria-label={video.label}
        onClick={closeOnBackdrop}
        onClose={() => (player.current as Playable | null)?.pause()}
      >
        <video
          ref={player}
          src={video.src}
          poster={video.poster}
          preload="none"
          controls
          playsInline
        />
        <button type="button" className="phax-watch__close" onClick={close}>
          Close
        </button>
      </dialog>
    </>
  );
}
