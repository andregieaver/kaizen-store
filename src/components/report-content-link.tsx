import { t } from "@/lib/i18n";
import { platformPath, type PlatformLang } from "@/lib/platform-lang";
import { siteUrl } from "@/lib/site";

/**
 * The footer's *Report illegal content* link (DSA art. 16(1), D411): to Kaizena Flow's form, which is on Kaizena Flow's own site, so a
 * store on its own domain links to it in full. The form is in Norwegian for a Norwegian page and in English otherwise; it fills in the page
 * the visitor came from.
 */
export function ReportContentLink({ lang, absolute = false }: { lang: string; absolute?: boolean }) {
  const platformLang: PlatformLang = lang === "nb" ? "nb" : "en";
  const path = platformPath(platformLang, "/report");
  return (
    <a href={absolute ? `${siteUrl()}${path}` : path} className="inline-flex min-h-6 w-fit items-center text-muted underline">
      {t(lang).reportContent}
    </a>
  );
}
