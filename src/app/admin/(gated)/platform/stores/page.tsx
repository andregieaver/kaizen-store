import type { Metadata } from "next";

import { PhoneRow } from "@/components/admin/phone-row";
import Link from "next/link";
import { connection } from "next/server";

import { adminDate } from "@/lib/admin-date";
import { listOffset, listPage, LIST_PAGE_SIZE } from "@/lib/list-page";
import { formatBps, priceLabel } from "@/lib/plans";
import { countStoreBilling, listStoreBilling } from "@/server/billing";
import { sandboxFunnel, sandboxSettings } from "@/server/sandbox";
import { requirePlatformReader } from "@/server/auth";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, Pager, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Stores" };

/** Every store with its plan, subscription and fee, a hundred a page with the count. */
export default async function PlatformStoresPage({ searchParams }: PageProps<"/admin/platform/stores">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").stores;
  const billingWords = adminText(lang, "billing");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const raw = (await searchParams).page;
  const page = listPage(raw);
  const [stores, total, funnel, sandbox] = await Promise.all([
    listStoreBilling({ includeClosed: true, limit: LIST_PAGE_SIZE, offset: listOffset(page) }),
    countStoreBilling({ includeClosed: true }),
    sandboxFunnel(),
    sandboxSettings(),
  ]);
  const f = adminText(lang, "sandbox").funnel;
  const share = (n: number, of: number) => (of > 0 ? ` (${Math.round((n / of) * 100)} %)` : "");
  return (
    <>
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          // The Dream Factory (D409) builds a store in the platform admin's name, from Your stores.
          <ButtonLink href="/admin/stores" size="header">
            {w.dreamLink}
          </ButtonLink>
        }
      />
      {/* The page builder's sandbox (D457 S4): how far visitors who tried it went, beside the stores they became. */}
      {/* Round 63 (D827): on a phone the sandbox is one row saying whether it is on, and each store one row of two lines. */}
      <div className="max-sm:overflow-hidden max-sm:rounded-panel">
      <PhoneRow flat last title={f.title} sub={sandbox.on ? f.on : f.off} change={w.phoneOpen} done={w.phoneClose}>
      <Card
        compact
        title={f.title}
        description={f.description}
        aside={
          <span>
            {sandbox.on ? f.on : f.off}{" "}
            <Link href="/admin/platform/requests" className="underline">
              {f.switchLink}
            </Link>
          </span>
        }
      >
        <table className="w-full text-left text-body">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-4 font-normal" />
              <th scope="col" className="py-1 pr-4 font-normal">{f.made}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{f.changed}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{f.published}</th>
              <th scope="col" className="py-1 font-normal">{f.kept}</th>
            </tr>
          </thead>
          <tbody>
            {funnel.map((period) => (
              <tr key={period.days} className="border-t border-line">
                <th scope="row" className="py-2 pr-4 font-normal text-ink-2">{countWords(period.days, f.period)}</th>
                <td className="py-2 pr-4 text-ink">{period.made}</td>
                <td className="py-2 pr-4 text-ink">{period.changed}{share(period.changed, period.made)}</td>
                <td className="py-2 pr-4 text-ink">{period.published}{share(period.published, period.made)}</td>
                <td className="py-2 text-ink">{period.kept}{share(period.kept, period.made)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      </PhoneRow>
      </div>
      <Card compact>
        <List label={w.title}>
          {stores.map((store) => (
            <ListRow key={store.storeId}>
              <RowLead
                title={store.name}
                href={`/admin/platform/stores/${store.slug}`}
                sub={
                  <>
                    <span className="max-sm:hidden">
                      {store.slug} · {store.ownerEmail ? (store.ownerName ? `${store.ownerName}, ${store.ownerEmail}` : store.ownerEmail) : w.noOwner}
                    </span>
                    <span className="sm:hidden">
                      {store.slug} · {store.planName ?? w.noPlan} · {fillWords(w.aSale, { fee: formatBps(store.feeBps, locale) })}
                    </span>
                  </>
                }
              />
              <span className="contents max-sm:hidden">
              <RowFact
                sub={[
                  store.status ? (billingWords.statuses[store.status] ?? store.status) : null,
                  store.cancelAtPeriodEnd && w.endsAtPeriodEnd,
                  store.mode === "test" && w.testMode,
                  store.currentPeriodEnd && !store.cancelAtPeriodEnd && store.status !== "canceled" && fillWords(w.nextInvoice, { date: adminDate(store, store.currentPeriodEnd, "day", lang) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {store.planName ? `${store.planName}${store.price ? `, ${priceLabel(store.price.amountMinor, store.price.currency, store.price.interval, billingWords.intervals)}` : ""}` : w.noPlan}
              </RowFact>
              </span>
              {store.storeStatus !== "active" && (
                <Chip signal={store.storeStatus === "closed" ? "neutral" : "danger"} dot>
                  {store.storeStatus === "closed" ? w.closed : w.suspended}
                </Chip>
              )}
              <span className="contents max-sm:hidden">
              <RowAmount>
                {fillWords(w.aSale, { fee: formatBps(store.feeBps, locale) })}
                {store.saleFeeBpsOverride !== null && <span className="block text-caption text-muted">{w.ownFee}</span>}
              </RowAmount>
              </span>
            </ListRow>
          ))}
        </List>
        <Pager
          words={{ ...adminText(lang, "kit").pager, shownOf: w.shownOf, previous: w.previous, next: w.next }}
          label={w.title}
          base="/admin/platform/stores"
          page={page}
          size={LIST_PAGE_SIZE}
          shown={stores.length}
          total={total}
        />
      </Card>
    </>
  );
}
