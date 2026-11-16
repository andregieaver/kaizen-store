import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, KpiTile, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { EXPIRY_CHOICES, expiryWords, GIFT_CARD_STATES, STATE_SIGNAL, type GiftCardState } from "@/lib/gift-card-admin";
import { formatMoney } from "@/lib/money";
import { submitClass } from "@/lib/submit-class";
import { featureOn } from "@/lib/store-features";
import { giftCardCounts, giftCardOutstanding, giftCardSettings, listGiftCards } from "@/server/gift-cards-admin";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveGiftCardSettingsAction } from "./actions";
import { switchOnFromPageAction } from "../settings/features/actions";

export const metadata: Metadata = { title: "Gift cards" };

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

/**
 * The store's gift cards (D300 F4, `docs/wave-5-marketing.md` 8.4): what customers hold now per currency, the cards newest first by state and a
 * search, *Issue a gift card*, and how long new cards last. The page stays while the feature is off: cards already sold are the customers' money.
 */
export default async function GiftCardsPage({ params, searchParams }: PageProps<"/admin/[store]/gift-cards">) {
  const member = await requirePermission((await params).store, "products:read");
  const { store } = member;
  const query = await searchParams;
  const q = first(query.q).slice(0, 100);
  const state = (GIFT_CARD_STATES as readonly string[]).includes(first(query.state)) ? (first(query.state) as GiftCardState) : null;
  const [at, id] = first(query.before).split("_");
  const before = at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
  const people = memberCan(member, "customers:read");
  const [counts, outstanding, page, settings] = await Promise.all([
    giftCardCounts(store.id),
    giftCardOutstanding(store.id),
    listGiftCards(store.id, { query: q, state, before, people }),
    giftCardSettings(store.id),
  ]);
  const base = `/admin/${store.slug}/gift-cards`;
  const lang = adminLangOf(member.account.adminLocale);
  const g = adminText(lang, "giftCards");
  const w = g.list;
  // English keeps the store's own number format and en-GB dates, as before; another language its own.
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en") : ADMIN_LANG_FACTS[lang].locale;
  const dateLocale = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone: store.timeZone });
  const filter = (next: { state?: GiftCardState | null; before?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = next.state === undefined ? state : next.state;
    if (s) p.set("state", s);
    if (next.before) p.set("before", next.before);
    const text = p.toString();
    return text ? `${base}?${text}` : base;
  };
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const last = page.rows.at(-1);
  const canIssue = memberCan(member, "products:write");
  const owner = memberCan(member, "owner");
  const on = featureOn(store, "gift_cards");
  const mainCurrencyCode = store.localization.currencies[0]?.currency ?? "EUR";
  const held = outstanding.map((o) => formatMoney(o.amountMinor, o.currency, locale)).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={!on ? undefined : [
          <span key="lead">
            <span className="text-ink">
              {!on ? w.leadOff : total === 0 ? w.leadNone : fillWords(w.leadHold, { amount: held || formatMoney(0, mainCurrencyCode, locale) })}
            </span>
            {!on ? w.leadOffRest : total === 0 ? w.leadNoneRest : w.leadHoldRest}
          </span>,
        ]}
        actions={canIssue && on ? <ButtonLink href={`${base}/new`} kind="secondary">{w.issueCard}</ButtonLink> : undefined}
      />

      {/* Round 12 (D637): off is one press to switch on, on with no card one press to make the product; tiles only once cards exist. */}
      {!on ? (
        // Round 22 (D687): while off, one offer said once: the amounts a shop usually sells, what selling gives, one wide button.
        <section aria-labelledby="sell" className={`flex flex-col gap-4 px-5 py-5 sm:px-6 ${CARD_CLASS}`}>
          <div aria-hidden className="grid max-w-md grid-cols-3 gap-2">
            {[250, 500, 1000].map((major, i) => (
              <span key={major} className={`flex h-14 items-center justify-center rounded-md text-body text-ink ${["bg-positive-soft", "bg-sunken", "bg-insight-soft"][i]}`}>
                {formatMoney(major * 100, mainCurrencyCode, locale, { decimals: "hide_whole" })}
              </span>
            ))}
          </div>
          <div className="flex max-w-xl flex-col gap-2">
            <h2 id="sell" className="text-title text-ink">{w.sellTitle}</h2>
            <p className="text-body text-ink-2">{w.leadOffRest.trim()}</p>
          </div>
          {owner ? (
            <ActionForm action={switchOnFromPageAction.bind(null, store.slug, "gift_cards")} className="flex flex-col gap-2">
              <SubmitButton className={`${submitClass("primary")} min-h-12 w-full font-medium sm:w-auto sm:min-w-56`}>{w.sellOn}</SubmitButton>
              <p className="text-caption text-muted">{w.sellText}</p>
            </ActionForm>
          ) : (
            <p className="text-caption text-muted">{w.ownerOnly}</p>
          )}
        </section>
      ) : (
        total === 0 &&
        canIssue && (
          <section aria-labelledby="make" className={`flex flex-wrap items-center justify-between gap-6 px-6 py-5 ${CARD_CLASS}`}>
            <div className="flex max-w-xl flex-col gap-2">
              <h2 id="make" className="text-title text-ink">{w.makeTitle}</h2>
              <p className="text-body text-ink-2">{w.makeText}</p>
            </div>
            <ButtonLink kind="main" href={`/admin/${store.slug}/products/new`}>
              {w.makeProduct}
            </ButtonLink>
          </section>
        )
      )}

      {total > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {outstanding.map((o) => (
            <KpiTile key={o.currency} label={fillWords(w.customersHoldIn, { currency: o.currency })} value={formatMoney(o.amountMinor, o.currency, locale)} context={countWords(o.cards, w.onCards)} />
          ))}
          <KpiTile label={w.activeCards} value={counts.active.toLocaleString(dateLocale)} href={filter({ state: "active" })} />
        </div>
      )}

      {total > 0 && (
        <Card
          compact
          title={state ? g.states[state] : w.allCards}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              {state && <input type="hidden" name="state" value={state} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder={people ? w.searchPeople : w.searchPlain}
                aria-label={w.searchLabel}
                className="min-h-10 w-64 rounded-md border border-line px-3"
              />
              <Button type="submit">{w.search}</Button>
              {(q || state) && (
                <Link href={base} className="text-body text-ink-2 underline-offset-2 hover:underline">
                  {w.showAll}
                </Link>
              )}
            </form>
          }
        >
          <nav aria-label={w.filterLabel} className="mb-4 flex flex-wrap gap-2">
            {GIFT_CARD_STATES.map((s) => (
              <Link
                key={s}
                href={filter({ state: state === s ? null : s })}
                aria-current={state === s ? "true" : undefined}
                className={`rounded-pill border px-3 py-1 text-caption ${state === s ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {g.states[s]} {counts[s]}
              </Link>
            ))}
          </nav>
          {page.rows.length === 0 ? (
            <p className="p-4 text-body text-muted">{w.noMatch}</p>
          ) : (
            <List label={w.listLabel}>
              {page.rows.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={row.last4 ? `•••• ${row.last4}` : w.noCode}
                    href={`${base}/${row.id}`}
                    sub={[row.source === "order" ? (row.orderNumber ? fillWords(w.boughtWith, { number: row.orderNumber }) : w.bought) : w.issuedByStaff, row.to, row.testMode ? w.testCard : null].filter(Boolean).join(" · ")}
                  />
                  <RowFact className="hidden sm:block">{date(row.issuedAt)}</RowFact>
                  <RowAmount>
                    {formatMoney(row.balanceMinor, row.currency, locale)}
                    <span className="block text-caption text-muted">{fillWords(w.of, { amount: formatMoney(row.initialMinor, row.currency, locale) })}</span>
                  </RowAmount>
                  <Chip signal={STATE_SIGNAL[row.state]} dot>
                    {g.states[row.state]}
                  </Chip>
                </ListRow>
              ))}
            </List>
          )}
          {page.more && last && (
            <div className="mt-4">
              <Link href={filter({ before: `${last.issuedAt}_${last.id}` })} className="text-body text-ink-2 underline-offset-2 hover:underline">
                {w.older}
              </Link>
            </div>
          )}
        </Card>
      )}

      <section aria-labelledby="how" className={`px-5 py-3 sm:px-6 ${CARD_CLASS}`}>
        <h2 id="how" className="mt-2 mb-1 text-title text-ink">{w.howTitle}</h2>
        {/* While off, issuing a card is a row here rather than the page's first button, and that sold cards stay spendable is said once (round 22). */}
        {!on && <p className="pb-2 text-caption text-ink-2">{w.off}</p>}
        {!on && canIssue && (
          <Link href={`${base}/new`} className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">{w.issueCard}</span>
              <span className="text-caption text-ink-2">{w.issueSub}</span>
            </span>
            <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{w.issueAction}</span>
          </Link>
        )}
        {canIssue ? (
          <details>
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-ink">{fillWords(w.lastRow, { time: expiryWords(settings.expiryMonths, g.expiry).toLowerCase() })}</span>
                <span className="text-caption text-ink-2">{w.lastSub}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{w.change}</span>
            </summary>
            <ActionForm action={saveGiftCardSettingsAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3 pb-5">
              <label className="flex flex-col gap-1 text-body">
                <span className="text-caption text-muted">{w.newCardsLast}</span>
                <select name="expiry" defaultValue={settings.expiryMonths === null ? "never" : String(settings.expiryMonths)} className="min-h-10 rounded-md border border-line px-3">
                  {EXPIRY_CHOICES.map((months) => (
                    <option key={String(months)} value={months === null ? "never" : String(months)}>
                      {expiryWords(months, g.expiry)}
                    </option>
                  ))}
                  {settings.expiryMonths !== null && !EXPIRY_CHOICES.includes(settings.expiryMonths) && (
                    <option value={String(settings.expiryMonths)}>{expiryWords(settings.expiryMonths, g.expiry)}</option>
                  )}
                </select>
              </label>
              <SubmitButton>{w.save}</SubmitButton>
            </ActionForm>
          </details>
        ) : (
          <p className="flex min-h-14 items-center py-3 text-body text-ink">{fillWords(w.lastRow, { time: expiryWords(settings.expiryMonths, g.expiry).toLowerCase() })}</p>
        )}
      </section>
    </div>
  );
}

