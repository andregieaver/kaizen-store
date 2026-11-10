/**
 * The builder's words for the Animation component (D538), in English. They are here, not in the admin's catalogues, because
 * every admin screen's first scripts carry the catalogues' English and the builder's alone needs these (D534's way,
 * `e2e/signed-in/admin-scripts.spec.ts`): the `animation` area is server-only (`SERVER_AREAS` in `admin-text.ts`), a page
 * that draws the builder in another language hands it down (`useHandedText("animation")`), and in English the fields read
 * this module, which comes with them.
 */
export const ANIMATION_WORDS = {
  none: "No animation yet",
  upload: "Upload an animation",
  another: "Choose another animation",
  hint: "A WebM video with a see-through background, up to 20 seconds, without sound. Your browser prepares it so that it plays everywhere, iPhones too.",
  preparing: "Preparing … {percent} %",
  /** What the video is called in the media library: it holds the picture above its mask, which is odd to look at. */
  fileName: "{name} (animation: picture and mask)",
  ownSize: "Shown at {width} × {height} pixels at most.",
  description: "Description",
  descriptionHint: "What it shows, for people using screen readers. It is read while it plays and after.",
  logo: "Animated logo",
  logoHint: "Plays once when a visitor arrives, here, and then rests as the logo. It is drawn as tall as the logo, so frame it closely on the logo itself. Without one, the site's logo shows.",
  loop: "Play again and again",
  loopHint: "Off: it plays once as it comes into view and rests on its last frame. Visitors who prefer less motion see that last frame.",
  refusals: {
    type: "Use a WebM video: the format with a see-through background that browsers can read. Most animation programs export it.",
    size: "That file is too large. Use one under 200 MB.",
    opaque: "That video has no see-through background, so it would play in a box. Use the Video component for it.",
    long: "An animation is 20 seconds at most. Use the Video component for a longer film.",
    small: "That video is too small to show.",
    browser: "This browser cannot prepare an animation. Use Chrome or Edge on a computer or an Android phone.",
    unreadable: "That file could not be read as a video.",
  },
};

export type AnimationWords = typeof ANIMATION_WORDS;
