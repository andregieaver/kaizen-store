import type { Metadata } from "next";
import Link from "next/link";

import { StoreTranslator } from "@/components/admin/store-translator";
import { pageLanguages } from "@/lib/page-translation";
import { featureOn } from "@/lib/store-features";
import { aiFor } from "@/server/ai";
import { requirePermission } from "@/server/permissions";
import { countryTextCounts, translationCoverage } from "@/server/store-translate";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";

import { translateStorePageAction } from "../pages/actions";
import { applyAction, worklistAction } from "./actions";

export const metadata: Metadata = { title: "Translate the store" };

export default async function TranslatePage({ params }: PageProps<"/admin/[store]/translate">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "website").translate;
  const languages = pageLanguages(store.localization.locales);
  const connection = languages.length > 1 ? await aiFor(store.id) : null;
  const countryTexts = await countryTextCounts({ store });

  return (
    <AdminTextScope texts={adminTexts(lang, ["website"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      {languages.length < 2 ? (
        <p className={`p-5 text-sm ${CARD_CLASS}`}>
          {featureOn(store, "languages") ? (
            <>
              {w.oneLanguage}
              <Link href={`/admin/${store.slug}/settings/localization`} className="underline">{w.localization}</Link>
              {w.end}
            </>
          ) : (
            // D178: the store's other languages are hidden, their translations kept.
            <>
              {w.languagesOff}
              <Link href={`/admin/${store.slug}/settings/features`} className="underline">{w.features}</Link>
              {w.languagesOffEnd}
            </>
          )}
        </p>
      ) : !connection?.textModel ? (
        <p className={`p-5 text-sm ${CARD_CLASS}`}>
          {w.noModel}
          <Link href={`/admin/${store.slug}/settings/ai`} className="underline">{w.aiSettings}</Link>
          {w.end}
        </p>
      ) : (
        <StoreTranslator
          languages={languages}
          coverage={await translationCoverage({ store })}
          actions={{
            worklist: worklistAction.bind(null, store.slug),
            translate: translateStorePageAction.bind(null, store.slug),
            apply: applyAction.bind(null, store.slug),
          }}
        />
      )}
      {countryTexts.length > 0 && (
        <Card title={w.countryTexts} description={w.countryTextsIntro}>
          <ul className="flex flex-col gap-1 text-sm" data-country-text-counts="">
            {countryTexts.map((row) => (
              <li key={row.locale}>
                {fillWords(w.countryTextsLine, { language: languages.find((l) => l.locale === row.locale)?.name ?? row.locale, products: row.products, menus: row.menus })}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
    </AdminTextScope>
  );
}
