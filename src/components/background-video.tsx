"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { videoLabels } from "@/lib/i18n";

/** The page's language as `videoLabels` knows it ("nb-NO" and "no" read as Norwegian). */
function pageLabels() {
  const lang = document.documentElement.lang.toLowerCase().split("-")[0];
  return videoLabels[lang === "no" ? "nb" : lang] ?? videoLabels.en;
}

/**
 * A row's background video: without sound, on a loop, behind the row's
 * content. People who prefer less motion see its still instead (the video
 * is hidden and never started), and on the site a button pauses and plays
 * it, as moving content must be possible to stop.
 */
export function BackgroundVideo({
  src,
  poster,
  className,
  style,
  controls,
}: {
  src: string;
  poster: string | undefined;
  className: string;
  style: CSSProperties | undefined;
  controls: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [labels, setLabels] = useState(videoLabels.en);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setLabels(pageLabels());
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = () => {
      setStill(reduce.matches);
      if (reduce.matches) video.pause();
      else {
        // React does not write `muted` into the page, and browsers only start muted videos by themselves.
        video.muted = true;
        void video.play().catch(() => setPlaying(false));
      }
    };
    follow();
    reduce.addEventListener("change", follow);
    return () => reduce.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <>
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden [border-radius:inherit]">
        <video
          ref={ref}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className={`${className} motion-reduce:hidden`}
          style={style}
        />
      </div>
      {controls && !still && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? labels.pause : labels.play}
          className="absolute right-3 bottom-3 z-10 flex size-10 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {playing ? (
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
            </svg>
          )}
        </button>
      )}
    </>
  );
}
