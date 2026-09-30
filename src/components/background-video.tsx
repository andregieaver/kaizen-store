"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * A row's background video: without sound, on a loop, behind the row's
 * content. People who prefer less motion see its still instead (the video
 * is hidden and never started).
 */
export function BackgroundVideo({
  src,
  poster,
  className,
  style,
  layer,
}: {
  src: string;
  poster: string | undefined;
  className: string;
  style: CSSProperties | undefined;
  /** Motion (D128): the video sits on a layer that moves with the scroll or by itself, inside its frame. */
  layer?: { attrs: Record<string, string>; style: CSSProperties };
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = () => {
      if (reduce.matches) video.pause();
      else {
        // React does not write `muted` into the page, and browsers only start muted videos by themselves.
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    };
    follow();
    reduce.addEventListener("change", follow);
    return () => reduce.removeEventListener("change", follow);
  }, []);

  const video = (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      className={`${className} motion-reduce:hidden`}
      style={style}
    />
  );
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden [border-radius:inherit]" {...(layer ? { "data-fx-bgroot": "" } : {})}>
      {layer ? (
        <div data-fx-layer="" {...layer.attrs} style={layer.style}>
          {video}
        </div>
      ) : (
        video
      )}
    </div>
  );
}
