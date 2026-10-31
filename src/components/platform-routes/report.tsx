import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";

import { sendContentReport } from "@/app/(platform)/report/actions";
import { UrlFromAddress } from "@/app/(platform)/report/url-from-address";
import { EXPLANATION_MAX, REPORT_CATEGORIES, URL_MAX } from "@/lib/content-reports";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { languageMeta } from "@/server/platform-lang-meta";

/** The report page's search texts in `lang` (D312). */
export async function reportMetadata(lang: PlatformLang): Promise<Metadata> {
  const w = platformText(lang).report;
  return { title: w.title, description: w.description, alternates: await languageMeta(lang, "/report") };
}

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";
const hint = "font-normal text-muted";

/**
 * Reporting illegal content on a store (DSA art. 16, D411): one form, easy to reach from every store's footer, holding what art. 16(2) asks
 * of a notice (why, where, who, good faith). A person decides each notice and the sender hears back (`src/server/content-reports.ts`).
 */
export function ReportRoute({ lang }: { lang: PlatformLang }) {
  const w = platformText(lang).report;
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{w.title}</h1>
        <p className="mt-2 text-muted">{w.intro}</p>
      </div>
      <ActionForm action={sendContentReport} className="flex flex-col gap-4" replaceOnSuccess id="report-form">
        <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
        <UrlFromAddress />
        <label className={field}>
          {w.url}
          <input type="url" name="url" required maxLength={URL_MAX} inputMode="url" className={control} />
          <span className={hint}>{w.urlHint}</span>
        </label>
        <label className={field}>
          {w.category}
          <select name="category" required defaultValue="" className={control}>
            <option value="" disabled />
            {REPORT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {w.categories[category]}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {w.explanation}
          <textarea name="explanation" required rows={5} maxLength={EXPLANATION_MAX} className={`${control} py-2`} />
          <span className={hint}>{w.explanationHint}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            {w.name}
            <input name="name" autoComplete="name" maxLength={200} className={control} />
          </label>
          <label className={field}>
            {w.email}
            <input type="email" name="email" autoComplete="email" maxLength={320} className={control} />
          </label>
        </div>
        <p className="-mt-2 text-sm text-muted">{w.contactHint}</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="goodFaith" required className="mt-1 size-4 shrink-0" />
          <span>{w.goodFaith}</span>
        </label>
        {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
        <div aria-hidden="true" className="hidden">
          <label>
            {platformText(lang).signUp.website}
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div>
          <SubmitButton>{w.send}</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}
