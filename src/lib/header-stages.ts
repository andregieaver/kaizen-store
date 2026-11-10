import { colourCss } from "./colour";
import { BACKDROP_BLUR_MAX, type GradientBackground, type HeaderOverlay, type HeaderStage } from "./page-content";

/**
 * A header over the page in its two stages (D533): at the top of the page, over the first row, and when it comes back
 * as the visitor scrolls (`HidingHeader` slides it in again on the way up). Each stage may have a background of its own
 * (a colour, a gradient or none), a blur of what is behind and a text colour; whatever a stage leaves out is drawn as it
 * was before the stages, from the header row's own settings, so a header no one has touched looks as it did.
 *
 * The site draws a stage from data attributes and custom properties on the header's wrapper (`headerStageLook()`) and a
 * stage's gradient as a layer in the header (`HeaderStageLayers`); `globals.css` says which shows when. Pure.
 */

export const HEADER_STAGES = ["top", "revealed"] as const;
export type HeaderStageName = (typeof HEADER_STAGES)[number];

/** The short names a stage's hooks carry (`data-hs-top-bg`, `--hs-rev-blur`). */
const PREFIX: Record<HeaderStageName, string> = { top: "top", revealed: "rev" };

const HEX = /^#[0-9a-f]{6}$/i;

/** A stage as it is drawn: the top's text colour as it was kept before the stages (`overlay.textColor`) unless the stage has its own. */
export function headerStage(overlay: HeaderOverlay | undefined, stage: HeaderStageName): HeaderStage {
  const own = overlay?.[stage] ?? {};
  if (stage === "top" && !own.textColor && overlay?.textColor) return { ...own, textColor: overlay.textColor };
  return own;
}

/** Whether a stage has nothing of its own, so the header row's settings draw it all. */
export const stageIsEmpty = (stage: HeaderStage): boolean => !stage.background && stage.blur === undefined && !stage.textColor;

/**
 * The overlay with one stage changed. An empty stage leaves no key; the top's text colour moves into the stage, so it is
 * kept in one place.
 */
export function withHeaderStage(overlay: HeaderOverlay, stage: HeaderStageName, next: HeaderStage): HeaderOverlay {
  const clean: HeaderStage = {
    ...(next.background && { background: next.background }),
    ...(next.blur !== undefined && { blur: Math.min(BACKDROP_BLUR_MAX, Math.max(0, Math.round(next.blur))) }),
    ...(next.textColor && { textColor: next.textColor }),
  };
  const { [stage]: _old, ...rest } = overlay;
  void _old;
  const out: HeaderOverlay = stageIsEmpty(clean) ? rest : { ...rest, [stage]: clean };
  if (stage === "top") delete out.textColor;
  return out;
}

/** What the header's wrapper carries for its stages: which settings each has (`attrs`) and their values (`style`). */
export type HeaderStageLook = { attrs: Record<string, string>; style: Record<string, string> };

export function headerStageLook(overlay: HeaderOverlay | undefined): HeaderStageLook {
  const attrs: Record<string, string> = {};
  const style: Record<string, string> = {};
  if (!overlay) return { attrs, style };
  for (const name of HEADER_STAGES) {
    const p = PREFIX[name];
    const stage = headerStage(overlay, name);
    const background = stage.background;
    if (background?.type === "color" && HEX.test(background.color)) {
      attrs[`data-hs-${p}-bg`] = "color";
      style[`--hs-${p}-bg`] = colourCss(background.color, background.opacity);
    } else if (background?.type === "gradient" || background?.type === "none") {
      // Drawn with no colour of its own: a gradient lies in a layer (`HeaderStageLayers`), and none is see-through.
      attrs[`data-hs-${p}-bg`] = background.type;
    }
    if (stage.blur !== undefined && Number.isFinite(stage.blur)) {
      attrs[`data-hs-${p}-blur`] = "";
      style[`--hs-${p}-blur`] = `${Math.min(BACKDROP_BLUR_MAX, Math.max(0, Math.round(stage.blur)))}px`;
    }
    if (stage.textColor && HEX.test(stage.textColor)) {
      attrs[`data-hs-${p}-text`] = "";
      // The top's has always been `--header-overlay-text` (D80), which `globals.css` reads.
      style[name === "top" ? "--header-overlay-text" : `--hs-${p}-text`] = stage.textColor;
    }
  }
  return { attrs, style };
}

/** The stages drawn with a gradient, each to be laid in the header as a layer that shows at its stage. */
export function headerStageGradients(overlay: HeaderOverlay | undefined): { stage: HeaderStageName; gradient: GradientBackground }[] {
  return HEADER_STAGES.flatMap((stage) => {
    const background = headerStage(overlay, stage).background;
    return background?.type === "gradient" ? [{ stage, gradient: background }] : [];
  });
}
