import type { AnimationFile } from "@/lib/animation";

import { AnimationPlayer } from "./lazy/blocks";

/** The logo's usual height in a header and in a footer, in pixels (`LOGO_HEIGHT` in the page model; the classes below by screen size). */
const USUAL = { header: 40, footer: 32 } as const;

/**
 * The logo as an animation (D538), where a header's or footer's logo part holds one: it plays once a visit, in the first
 * place this tab shows it, and rests on its last frame, which is the logo there; on every later page it is that picture
 * from the start. As tall as the logo is (the part's own height, else the usual one by screen size) and as wide as its
 * shape makes it. Its script comes only to pages that draw it (`lazy/blocks`).
 */
export function AnimatedLogo({
  animation,
  alt,
  name,
  height,
  size,
}: {
  animation: AnimationFile;
  /** The site's name: what the logo says to a screen reader. */
  alt: string;
  /** Which site's logo it is, so one site's does not count as another's seen. */
  name: string;
  height?: number;
  size: "header" | "footer";
}) {
  const tall = height ?? USUAL[size];
  const wide = Math.max(1, Math.round((tall * animation.still.width) / animation.still.height));
  return (
    <AnimationPlayer
      video={animation.video.url}
      still={animation.still.url}
      alt={alt}
      width={wide}
      height={tall}
      pictureWidth={animation.width}
      pictureHeight={animation.height}
      fit="height"
      once={`logo:${name}`}
      className={height ? "" : size === "header" ? "h-8 md:h-10" : "h-8"}
    />
  );
}
