"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { browserText as t } from "@/lib/browser-text";
import { EMBED_NAMES, type EmbedSource } from "@/lib/video-embed";
import { restingTime, videoPlay, videoPoster } from "@/lib/video-play";

import { usePageLanguage } from "./page-language";

/**
 * A video uploaded to the site (D91), played by the browser. One set to
 * start by itself starts muted (browsers only start muted videos) and
 * stays still for visitors who prefer less motion. One set to play once
 * (D536: an animated logo, an intro) stops on its last frame, and shows
 * that frame to visitors who prefer less motion and where the browser
 * will not start it. Nothing is drawn behind the video, so one with a
 * see-through background shows the page through it.
 */
export function UploadedVideo({
  src,
  poster,
  title,
  controls,
  autoplay,
  loop,
  once = false,
  style,
}: {
  src: string;
  poster: string | undefined;
  title: string;
  controls: boolean;
  autoplay: boolean;
  loop: boolean;
  once?: boolean;
  style: CSSProperties;
}) {
  const play = videoPlay({ controls, autoplay, loop, once });
  const rests = play.once;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !autoplay) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const toEnd = () => {
      const end = restingTime(video.duration);
      if (end !== null) video.currentTime = end;
    };
    // The last frame, without playing up to it.
    const rest = () => {
      video.pause();
      if (video.readyState >= 1) toEnd();
      else video.addEventListener("loadedmetadata", toEnd, { once: true });
    };
    const follow = () => {
      video.removeEventListener("loadedmetadata", toEnd);
      if (reduce.matches) {
        if (rests) rest();
        else video.pause();
        return;
      }
      // React does not write `muted` into the page, and browsers only start muted videos by themselves.
      video.muted = true;
      void video.play().catch(() => {
        // A browser that will not start it (a phone saving power): the finished picture rather than nothing.
        if (rests) rest();
      });
    };
    follow();
    reduce.addEventListener("change", follow);
    return () => {
      reduce.removeEventListener("change", follow);
      video.removeEventListener("loadedmetadata", toEnd);
    };
  }, [autoplay, rests]);
  return (
    <video
      ref={ref}
      src={src}
      poster={videoPoster(play, poster)}
      controls={play.controls}
      muted={play.muted}
      loop={play.loop}
      playsInline
      preload="metadata"
      aria-label={title || undefined}
      className="h-full w-full rounded-lg object-cover"
      style={style}
    />
  );
}

/**
 * A YouTube or Vimeo video (D91): its poster (or a plain panel) and a play
 * button, saying where it plays from; the player is loaded from there only
 * when the button is pressed, so nothing is fetched from YouTube or Vimeo
 * before the visitor chooses to play.
 */
export function EmbeddedVideo({
  source,
  player,
  poster,
  title,
  style,
}: {
  source: EmbedSource;
  /** The player's address. */
  player: string;
  poster: string | undefined;
  title: string;
  style: CSSProperties;
}) {
  const [playing, setPlaying] = useState(false);
  const m = t(usePageLanguage());
  const name = EMBED_NAMES[source];
  if (playing) {
    return (
      <iframe
        src={player}
        title={title || name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="h-full w-full rounded-lg border-0 bg-black"
        style={style}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`${title || m.playVideo} (${m.playsFrom(name)})`}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-900 text-white focus-visible:outline-2 focus-visible:outline-offset-2"
      style={style}
    >
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span aria-hidden className="relative flex size-16 items-center justify-center rounded-full bg-black/70 transition group-hover:scale-105 group-hover:bg-black/85">
        <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      <span aria-hidden className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs">
        {name}
      </span>
    </button>
  );
}
