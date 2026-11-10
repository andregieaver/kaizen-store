/**
 * How an uploaded video plays (D91, D536), from what its component is set to. Pure: the site's player
 * (`UploadedVideo`) and the builder's fields (`VideoStyleFields`) both read it, so they cannot disagree.
 */

export type VideoSettings = {
  /** The browser's controls are asked for. */
  controls: boolean;
  /** Starts by itself. */
  autoplay: boolean;
  /** Loops, set on a video that does not start by itself. */
  loop: boolean;
  /** A video that starts by itself plays once instead of looping. */
  once: boolean;
};

export type VideoPlay = {
  controls: boolean;
  muted: boolean;
  loop: boolean;
  /** Plays once by itself and rests on its last frame: an animated logo, an intro. */
  once: boolean;
};

export function videoPlay(settings: VideoSettings): VideoPlay {
  const once = settings.autoplay && settings.once;
  return {
    // A video that does not start by itself always has its controls, so it can be played.
    controls: settings.controls || !settings.autoplay,
    // Browsers only start a video by itself without its sound.
    muted: settings.autoplay,
    // One that starts by itself loops unless it is set to play once (videos from before D536 have no `once` and loop on).
    loop: once ? false : settings.loop || settings.autoplay,
    once,
  };
}

/**
 * The picture shown before a video plays. A video that plays once shows none: its still is taken from a little way in,
 * so it would flash before the first frame. It opens on its first frame and rests on its last.
 */
export function videoPoster(play: VideoPlay, poster: string | undefined): string | undefined {
  return play.once ? undefined : poster;
}

/** The moment a video rests on: just inside its end, where every browser still has a frame to show. */
export function restingTime(duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration - 0.05);
}
