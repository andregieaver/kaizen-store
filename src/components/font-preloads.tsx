import { preload } from "react-dom";

import { fontSlug, FONT_SLUG, latinUprightFile } from "@/lib/fonts";
import { fontCss } from "@/server/fonts";

/**
 * Starts a site's own fonts (D59) with the page instead of after its stylesheets (D211): the file each of the site's families
 * draws upright Latin text from (`latinUprightFile()`), preloaded, so React names it in the response's `Link` header or at the top
 * of the head. Found only through the stylesheet, a font was the last thing a phone on slow 4G finished before the largest paint
 * (`docs/performance.md`, Fonts found late). Draws nothing; a family it cannot read is simply not preloaded, as its stylesheet
 * still loads it.
 */
export async function FontPreloads({ families }: { families: string[] }) {
  const slugs = [...new Set(families.map(fontSlug))].filter((slug) => FONT_SLUG.test(slug));
  const files = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const css = await fontCss(slug);
        return css ? latinUprightFile(css) : null;
      } catch {
        return null;
      }
    }),
  );
  // A font is fetched without credentials (CORS), so its preload says the same, or the browser fetches it twice.
  for (const file of new Set(files)) if (file) preload(file, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return null;
}
