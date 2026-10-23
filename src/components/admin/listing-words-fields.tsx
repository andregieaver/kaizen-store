import { PLATFORM_LANG_FACTS, PLATFORM_LANGS } from "@/lib/platform-lang";
import { HIGHLIGHT_KINDS, HIGHLIGHT_WORDS_MAX } from "@/lib/theme-highlights";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import { LISTING_WORDS_MAX, type ListingLanguages } from "@/lib/theme-store";

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * A theme's own words in the site's other languages (D312 P3), part of its listing form, folded away: its summary, description and
 * highlights' words in each, as `words:{lang}:…`. Empty words show the English ones there, marked as English. Written by a person; a launch
 * theme's are the code's (`LAUNCH_WORDS_NB`) wherever it has them.
 */
export function ListingWordsFields({
  initial,
  words: f = platformSiteEn.fields,
  names = platformSiteEn.tables.highlights,
}: {
  initial: ListingLanguages | undefined;
  words?: PlatformSiteMessages["fields"];
  names?: PlatformSiteMessages["tables"]["highlights"];
}) {
  const langs = PLATFORM_LANGS.filter((lang) => lang !== "en");
  return (
    <>
      {langs.map((lang) => {
        const words = initial?.[lang] ?? {};
        const name = PLATFORM_LANG_FACTS[lang].english;
        const field = (key: string) => `words:${lang}:${key}`;
        return (
          <details key={lang} className="rounded-panel border border-line text-sm" data-listing-words={lang}>
            <summary className="flex min-h-10 cursor-pointer items-center px-3 font-medium">{fillWords(f.inLang, { name })}</summary>
            <div className="flex flex-col gap-3 border-t border-line p-3" lang={PLATFORM_LANG_FACTS[lang].tag}>
              <p className="text-muted">
                {fillWords(f.inLangNote, { name })}
              </p>
              <label className="flex flex-col gap-1 font-medium">
                {f.summary}
                <input name={field("summary")} maxLength={LISTING_WORDS_MAX.summary} defaultValue={words.summary ?? ""} className={control} />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                {f.description}
                <textarea name={field("description")} maxLength={LISTING_WORDS_MAX.description} rows={4} defaultValue={words.description ?? ""} className={`${control} py-2`} />
              </label>
              {HIGHLIGHT_KINDS.map((kind) => (
                <div key={kind} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                  <p className="text-caption text-muted">{fillWords(f.highlightOf, { name: names[kind].toLowerCase() })}</p>
                  <label className="flex flex-col gap-1 font-medium">
                    {f.title}
                    <input name={field(`highlight:${kind}:title`)} maxLength={HIGHLIGHT_WORDS_MAX.title} defaultValue={words.highlights?.[kind]?.title ?? ""} className={control} />
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    {f.line}
                    <input name={field(`highlight:${kind}:text`)} maxLength={HIGHLIGHT_WORDS_MAX.text} defaultValue={words.highlights?.[kind]?.text ?? ""} className={control} />
                  </label>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}
