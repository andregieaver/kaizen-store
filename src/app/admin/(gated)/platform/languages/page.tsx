import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { nativeName, worldLanguages } from "@/lib/languages";
import { fullCatalog, isBuiltIn } from "@/lib/ui-catalog-all";
import { requirePlatformAdmin } from "@/server/auth";
import { listLanguages, storesUsing } from "@/server/languages";
import { uiCoverage } from "@/server/ui-text";

import { addLanguageAction, saveLocalesAction, setEnabledAction } from "./actions";

export const metadata: Metadata = { title: "Languages" };

const input = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

/**
 * The languages stores can offer (D111): chosen here from the world's, each
 * with the state of its interface text (buttons, cart, checkout, emails),
 * which the platform translates with AI and a person reviews.
 */
export default async function LanguagesPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [languages, coverage] = await Promise.all([listLanguages(), uiCoverage()]);
  const uses = new Map(await Promise.all(languages.map(async (l) => [l.lang, await storesUsing(l.lang)] as const)));
  const have = new Set(languages.map((l) => l.lang));
  const addable = worldLanguages().filter((l) => !have.has(l.lang));
  const total = fullCatalog().length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Languages</h1>
        <p className="max-w-3xl text-sm text-muted">
          The languages store owners can offer under Languages and currencies. Products, pages and menus can be
          written or translated in any of them; the interface (buttons, cart, checkout and the emails shoppers get)
          is written by hand in Norwegian, Swedish, Danish and English, and translated by AI and reviewed here for the
          others. A language without interface text shows English there.
        </p>
      </div>

      <section aria-labelledby="add-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="add-heading" className="font-medium">Add a language</h2>
        <ActionForm action={addLanguageAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            From the world&apos;s languages
            <select name="lang" defaultValue="" className={`${input} min-w-64`}>
              <option value="">Choose …</option>
              {addable.map((l) => (
                <option key={l.lang} value={l.lang}>{l.name} ({l.lang})</option>
              ))}
            </select>
          </label>
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="sr-only">Languages</h2>
        <ul className="flex flex-col gap-3">
          {languages.map((language) => {
            const c = coverage[language.lang];
            const builtIn = isBuiltIn(language.lang);
            return (
              <li key={language.lang} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {language.name} <span className="font-normal text-muted">· {nativeName(language.lang)} · {language.lang}</span>
                    {language.direction === "rtl" && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs">right to left</span>}
                  </span>
                  <span className="text-muted">
                    {builtIn
                      ? "Interface written by hand."
                      : c
                        ? `Interface: ${c.translated} of ${total} translated${c.stale > 0 ? `, ${c.stale} out of date` : ""}, ${c.reviewed} reviewed.`
                        : "Interface: not translated yet (shows English)."}
                    {" "}
                    {uses.get(language.lang) ?? 0} {uses.get(language.lang) === 1 ? "store uses" : "stores use"} it.
                  </span>
                  <ActionForm action={saveLocalesAction.bind(null, language.lang)} className="mt-1 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Locales, the main one first
                      <input name="locales" defaultValue={language.locales.join(", ")} className={`${input} min-h-8 w-56 text-foreground`} />
                    </label>
                    <SubmitButton variant="secondary">Save</SubmitButton>
                  </ActionForm>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!builtIn && (
                    <Link href={`/admin/platform/languages/${language.lang}`} className="flex min-h-10 items-center rounded-md border border-border px-4 text-sm">
                      Translate and review
                    </Link>
                  )}
                  <ActionForm action={setEnabledAction.bind(null, language.lang, !language.enabled)}>
                    <SubmitButton variant={language.enabled ? "secondary" : "primary"}>{language.enabled ? "Switch off" : "Switch on"}</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
