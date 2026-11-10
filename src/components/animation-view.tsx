"use client";

import { useEffect, useRef, useState } from "react";

import {
  ANIMATION_START_WAIT_MS,
  ANIMATION_VISIBLE_SHARE,
  PLAYER_FRAGMENT_SHADER,
  PLAYER_VERTEX_SHADER,
  animationPlays,
  animationSeenKey,
  animationSeenScript,
} from "@/lib/animation";

/**
 * An animation as the site plays it (D538, `src/lib/animation.ts`): a canvas with a see-through background, drawn from a
 * video that holds the picture above its mask, and over it the last frame as a picture. Nothing shows until it starts,
 * as an animation opens on its first frame; it starts when a quarter of it is on the screen, plays without sound or
 * controls, and then the picture is laid over the canvas's last frame, sharp at any size; the video is let go at once and
 * the canvas once the picture has loaded, so there is never a moment with neither.
 * Set to go round, it keeps playing instead. The picture is shown at once, and nothing is fetched to play, for visitors
 * who prefer less motion, in a browser that cannot draw it, where the browser will not start it (a phone saving power),
 * on a line too slow to start it, and without scripts (less motion and no scripts need no script of ours: the picture's
 * own classes and a `noscript` copy show it). `once`: a visitor who has seen it in this tab (the header's logo on the page
 * before) gets the picture, so it plays once a visit, not on every page; a script in the page itself says so before
 * anything is drawn (`animationSeenScript()`), so a logo is never late. `fit`: `width` is a picture in a page, as wide
 * as `width` and no wider than its place (the picture itself holds the place, the canvas lies over it); `height` is a
 * logo, as tall as `height` (or as its classes say) and as wide as its shape makes it.
 */
export function AnimationPlayer({
  video,
  still,
  alt,
  width,
  height,
  pictureWidth,
  pictureHeight,
  loop = false,
  once,
  fit = "width",
  className = "",
}: {
  /** The MP4: picture above, mask below. */
  video: string;
  /** The last frame as a picture. */
  still: string;
  alt: string;
  /** The size it is drawn at, in pixels; it shrinks to a narrower place, keeping its shape. */
  width: number;
  height: number;
  /** The picture's size inside the video. */
  pictureWidth: number;
  pictureHeight: number;
  loop?: boolean;
  /** A name: played once in this tab under it, later it is the picture. */
  once?: string;
  /** Which side sets its size: its width (a picture in a page) or its height (a logo). */
  fit?: "width" | "height";
  className?: string;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  // `wait`: nothing shows yet. `play`: the canvas. `rest`: the picture, over the canvas until it has loaded.
  const [stage, setStage] = useState<"wait" | "play" | "rest">("wait");
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const surface = canvas.current;
    if (!frame || !surface) return;
    const seenKey = once ? animationSeenKey(once) : null;
    const seen = () => {
      try {
        return seenKey !== null && sessionStorage.getItem(seenKey) === "1";
      } catch {
        return false;
      }
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGLRenderingContext | null = null;
    let film: HTMLVideoElement | null = null;
    let late: ReturnType<typeof setTimeout> | undefined;
    let watcher: IntersectionObserver | null = null;
    let over = false;

    const letGo = () => {
      clearTimeout(late);
      watcher?.disconnect();
      watcher = null;
      if (film) {
        film.pause();
        film.removeAttribute("src");
        film.load();
        film.remove();
        film = null;
      }
      gl = null;
    };
    const rest = () => {
      if (over) return;
      over = true;
      setStage("rest");
      letGo();
      // The canvas keeps its last frame under the picture until the picture is there to cover it.
      const shown = picture.current;
      const cover = () => setCovered(true);
      if (shown?.complete && shown.naturalWidth > 0) cover();
      else shown?.addEventListener("load", cover, { once: true });
    };

    const start = () => {
      gl = surface.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!animationPlays({ reducedMotion: reduce.matches, canDraw: gl !== null }) || !gl) return rest();
      const context = gl;
      const shader = (type: number, source: string) => {
        const made = context.createShader(type)!;
        context.shaderSource(made, source);
        context.compileShader(made);
        return made;
      };
      const program = context.createProgram()!;
      context.attachShader(program, shader(context.VERTEX_SHADER, PLAYER_VERTEX_SHADER));
      context.attachShader(program, shader(context.FRAGMENT_SHADER, PLAYER_FRAGMENT_SHADER));
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) return rest();
      context.useProgram(program);
      context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
      const at = context.getAttribLocation(program, "p");
      context.enableVertexAttribArray(at);
      context.vertexAttribPointer(at, 2, context.FLOAT, false, 0, 0);
      context.bindTexture(context.TEXTURE_2D, context.createTexture());
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);

      const player = document.createElement("video");
      film = player;
      // Browsers only start a video by themselves without its sound, and a phone only in the page, not full screen.
      player.muted = true;
      player.playsInline = true;
      player.setAttribute("muted", "");
      player.setAttribute("playsinline", "");
      // The file is on the storage's own address; drawing it on a canvas needs its leave, which public files give.
      player.crossOrigin = "anonymous";
      player.preload = "auto";
      player.loop = loop;
      player.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
      frame.appendChild(player);

      const draw = () => {
        if (over || !film || film.readyState < 2) return;
        try {
          context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, film);
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        } catch {
          rest();
        }
      };
      const next = () => {
        draw();
        if (over || !film || film.ended) return;
        if (film.requestVideoFrameCallback) film.requestVideoFrameCallback(next);
        else requestAnimationFrame(next);
      };
      player.addEventListener("ended", () => {
        draw();
        rest();
      });
      player.addEventListener("error", rest);
      surface.addEventListener("webglcontextlost", rest, { once: true });
      player.addEventListener(
        "playing",
        () => {
          clearTimeout(late);
          try {
            if (seenKey) sessionStorage.setItem(seenKey, "1");
          } catch {
            // Storage switched off: it plays again on the next page.
          }
          setStage("play");
          next();
        },
        { once: true },
      );
      late = setTimeout(() => {
        if (film && film.currentTime === 0) rest();
      }, ANIMATION_START_WAIT_MS);
      player.src = video;
      void player.play().catch(rest);
    };

    if (reduce.matches || seen()) {
      rest();
    } else {
      watcher = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          watcher?.disconnect();
          watcher = null;
          start();
        },
        { threshold: ANIMATION_VISIBLE_SHARE },
      );
      watcher.observe(frame);
    }
    // Less motion asked for while it plays: the picture.
    const calm = () => {
      if (reduce.matches) rest();
    };
    reduce.addEventListener("change", calm);
    return () => {
      reduce.removeEventListener("change", calm);
      over = true;
      letGo();
    };
  }, [video, loop, once]);

  const fill = "absolute inset-0 h-full w-full";
  // Hidden until it rests; shown at once to a visitor who prefers less motion, and where the page's own script has
  // marked it as seen, without waiting for this component.
  const hidden = "opacity-0 motion-reduce:opacity-100 [[data-kz-seen]>&]:opacity-100";
  const logo = fit === "height";
  // A logo is as tall as it is told, and its shape makes its width. A picture in a page gets its size from the picture
  // itself, which is in the flow of the page: only a real picture gives way to a narrower place wherever it stands
  // (a fixed width would hold a centred column open on a phone), so the canvas lies over it and follows it.
  const place = logo
    ? { className: `relative block shrink-0 ${className}`, style: { ...(className === "" ? { height } : {}), aspectRatio: `${width} / ${height}` } }
    : { className: `relative inline-block max-w-full align-top ${className}`, style: undefined };
  return (
    <>
      {/* The page's own script may have marked it as seen before React arrives: that attribute is its, not a mismatch. */}
      <span ref={frameRef} data-kz-animation={stage} className={place.className} style={place.style} suppressHydrationWarning>
        {!covered && <canvas ref={canvas} aria-hidden width={pictureWidth} height={pictureHeight} className={`${fill} motion-reduce:hidden`} />}
        {/* eslint-disable-next-line @next/next/no-img-element -- the site's own picture, the exact frame the canvas ends on, shown as it is */}
        <img ref={picture} src={still} alt={alt} width={width} height={height} decoding="async" className={`${logo ? fill : "block h-auto max-w-full"} ${stage === "rest" ? "" : hidden}`} />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- without scripts nothing plays: the picture */}
          <img src={still} alt={alt} width={width} height={height} className={fill} />
        </noscript>
      </span>
      {once && <script dangerouslySetInnerHTML={{ __html: animationSeenScript(once) }} />}
    </>
  );
}
