import { fontCssHref, fontSlug, FONT_SLUG } from "@/lib/fonts";

/**
 * The self-hosted stylesheets of the families a part of the page uses
 * (D59). React puts them in the head once each, however many blocks ask,
 * on the site and in the page builder alike. React holds a streamed
 * boundary until its stylesheets load and gives it up if one fails, so
 * only a name the stylesheet route answers is linked: it answers every
 * such name, with an empty stylesheet when Kaizena Flow has none for it.
 */
export function FontLinks({ families }: { families: (string | undefined | null)[] }) {
  const unique = [...new Set(families.filter((family): family is string => typeof family === "string" && FONT_SLUG.test(fontSlug(family))))];
  return unique.map((family) => <link key={family} rel="stylesheet" href={fontCssHref(family)} precedence="fonts" />);
}
