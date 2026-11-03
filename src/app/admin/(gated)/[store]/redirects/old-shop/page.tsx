import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { OldShopFix, OldShopForget, OldShopStart, OldShopTable } from "@/components/admin/redirects/old-shop-check";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { momentText } from "@/lib/data-admin";
import { OLD_SHOP_SUGGESTED_ROWS } from "@/lib/old-shop";
import { oldShopCheck } from "@/server/old-shop";
import { memberCan, requirePermission } from "@/server/permissions";

import { fixOldShopAction, forgetOldShopAction, readOldShopAction, redirectOldAddressAction } from "./actions";

export const metadata: Metadata = { title: "Your old shop's links" };
/** Reading an old shop's sitemap is up to 60 files, one after another. */
export const maxDuration = 300;

type Props = PageProps<"/admin/[store]/redirects/old-shop">;

/**
 * The old shop's links (D445 step 1, `docs/moving-from-shopify.md` 8.2, 8.3): for Homer, one field and one button, then one line that says
 * whether every old link leads somewhere, one press that fixes the sure ones, and a short list of the rest with suggestions. The counts of
 * the old shop beside this store's are below, and how it works under them. Needs the right to read the website; changing needs the right to
 * change it.
 */
export default async function OldShopPage({ params }: Props) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const w = adminText(adminLangOf(account.adminLocale), "redirects");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead slug={store.slug} active="oldShop" title={w.oldShop.title} intro={w.oldShop.intro} words={w} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "redirects");
  const o = w.oldShop;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const canWrite = memberCan(member, "website:write");
  const check = await oldShopCheck(member);
  const actions = {
    read: readOldShopAction.bind(null, store.slug),
    fix: fixOldShopAction.bind(null, store.slug),
    forget: forgetOldShopAction.bind(null, store.slug),
    redirect: redirectOldAddressAction.bind(null, store.slug),
  };
  const n = (value: number) => value.toLocaleString(locale);

  if (!check)
    return (
      <AdminTextScope texts={adminTexts(lang, ["redirects"])}>
        <section className={card}>{canWrite ? <OldShopStart read={actions.read} /> : <p className="text-sm">{o.start.help}</p>}</section>
        <HowItWorks words={o.notes} />
      </AdminTextScope>
    );

  const needing = check.total - check.working;
  const unsure = check.needing.filter((r) => r.sure === null);
  const shown = unsure.slice(0, OLD_SHOP_SUGGESTED_ROWS);
  const here: Partial<Record<string, number>> = check.here;
  return (
    <AdminTextScope texts={adminTexts(lang, ["redirects"])}>
      <section className={`${card} flex flex-col gap-3`} aria-live="polite">
        <p className="text-lg font-medium" role="status">
          {needing === 0 ? countWords(check.total, o.all, { n: n(check.total) }) : fillWords(o.some, { working: n(check.working), total: n(check.total) })}
        </p>
        {needing > 0 && <p className="text-sm">{countWords(needing, o.needing, { n: n(needing) })}</p>}
        {canWrite && check.sure > 0 && <OldShopFix fix={actions.fix} count={check.sure} />}
      </section>

      {unsure.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title text-ink">{o.rest}</h2>
          <p className={hint}>{o.restHelp}</p>
          <OldShopTable rows={shown} redirect={actions.redirect} canWrite={canWrite} />
          {unsure.length > shown.length && <p className={hint}>{countWords(unsure.length - shown.length, o.more, { n: n(unsure.length - shown.length) })}</p>}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-title text-ink">{o.counts.title}</h2>
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{o.counts.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {o.counts.what}
                </th>
                <th scope="col" className={th}>
                  {o.counts.there}
                </th>
                <th scope="col" className={th}>
                  {o.counts.working}
                </th>
                <th scope="col" className={th}>
                  {o.counts.here}
                </th>
              </tr>
            </thead>
            <tbody>
              {check.byKind.map((row) => (
                <tr key={row.kind} className="border-b border-line last:border-0">
                  <th scope="row" className={`${td} text-left font-normal`}>
                    {o.kinds[row.kind]}
                  </th>
                  <td className={td}>{n(row.total)}</td>
                  <td className={td}>
                    {n(row.working)}
                    {row.working === row.total ? " ✓" : ""}
                  </td>
                  <td className={td}>{here[row.kind] === undefined ? "" : n(here[row.kind]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={hint}>
          {fillWords(o.read, { origin: check.origin.replace(/^https?:\/\//, ""), when: momentText(check.readAt, store.timeZone, locale) })} {check.truncated ? o.truncated : ""}
        </p>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-4">
            <OldShopStart read={actions.read} initial={check.origin} again />
            <OldShopForget forget={actions.forget} />
          </div>
        )}
      </section>
      <HowItWorks words={o.notes} />
    </AdminTextScope>
  );
}

function HowItWorks({ words }: { words: { title: string; sitemap: string; leads: string; again: string; words: string } }) {
  return (
    <Notice title={words.title}>
      <ul className="list-disc pl-5">
        <li>{words.sitemap}</li>
        <li>{words.leads}</li>
        <li>{words.again}</li>
        <li>{words.words}</li>
      </ul>
    </Notice>
  );
}
