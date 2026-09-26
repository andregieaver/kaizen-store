import { fontCssHref } from "@/lib/fonts";

/**
 * The self-hosted stylesheets of the families a part of the page uses
 * (D59). React puts them in the head once each, however many blocks ask,
 * on the site and in the page builder alike.
 */
export function FontLinks({ families }: { families: (string | undefined | null)[] }) {
  const unique = [...new Set(families.filter((family): family is string => Boolean(family)))];
  return unique.map((family) => <link key={family} rel="stylesheet" href={fontCssHref(family)} precedence="fonts" />);
}
