import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, KpiTile, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { EXPIRY_CHOICES, expiryWords, GIFT_CARD_STATES, STATE_SIGNAL, STATE_WORDS, type GiftCardState } from "@/lib/gift-card-admin";
import { formatMoney } from "@/lib/money";
import { featureOn } from "@/lib/store-features";
import { giftCardCounts, giftCardOutstanding, giftCardSettings, listGiftCards } from "@/server/gift-cards-admin";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveGiftCardSettingsAction } from "./actions";

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
  const locale = store.markets[0]?.locale ?? "en";
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: store.timeZone });
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gift cards"
        description="Money your customers hold to spend in the store: cards they bought, and cards you issue. A card sold is not a sale until it is spent."
        actions={canIssue ? <ButtonLink href={`${base}/new`} kind="main">Issue a gift card</ButtonLink> : undefined}
      />

      {!featureOn(store, "gift_cards") && (
        <p className={`p-4 text-body text-ink-2 ${CARD_CLASS}`}>
          Gift cards are switched off: none are sold and the checkout has no gift card field. Cards already sold or issued are kept here.{" "}
          <Link href={`/admin/${store.slug}/settings/features`} className="underline underline-offset-2">
            Features
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {outstanding.length === 0 ? (
          <KpiTile label="Customers hold" value={formatMoney(0, store.localization.currencies[0]?.currency ?? "EUR", locale)} context="On no card yet." />
        ) : (
          outstanding.map((o) => (
            <KpiTile key={o.currency} label={`Customers hold, ${o.currency}`} value={formatMoney(o.amountMinor, o.currency, locale)} context={`On ${o.cards} ${o.cards === 1 ? "card" : "cards"}.`} />
          ))
        )}
        <KpiTile label="Active cards" value={counts.active.toLocaleString("en-GB")} href={filter({ state: "active" })} />
      </div>

      {total === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>
          No gift cards yet. Add a product of the kind Gift card for customers to buy, or issue one here.
        </p>
      ) : (
        <Card
          compact
          title={state ? STATE_WORDS[state] : "All cards"}
          aside={
            <form method="get" action={base} className="flex flex-wrap items-center gap-2">
              {state && <input type="hidden" name="state" value={state} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder={people ? "Last four, order or person" : "Last four or order"}
                aria-label="Search gift cards"
                className="min-h-10 w-64 rounded-md border border-line px-3"
              />
              <Button type="submit">Search</Button>
              {(q || state) && (
                <Link href={base} className="text-body text-ink-2 underline-offset-2 hover:underline">
                  Show all
                </Link>
              )}
            </form>
          }
        >
          <nav aria-label="Filter by state" className="mb-4 flex flex-wrap gap-2">
            {GIFT_CARD_STATES.map((s) => (
              <Link
                key={s}
                href={filter({ state: state === s ? null : s })}
                aria-current={state === s ? "true" : undefined}
                className={`rounded-pill border px-3 py-1 text-caption ${state === s ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {STATE_WORDS[s]} {counts[s]}
              </Link>
            ))}
          </nav>
          {page.rows.length === 0 ? (
            <p className="p-4 text-body text-muted">No card matches.</p>
          ) : (
            <List label="Gift cards">
              {page.rows.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={row.last4 ? `•••• ${row.last4}` : "No code yet"}
                    href={`${base}/${row.id}`}
                    sub={[row.source === "order" ? (row.orderNumber ? `Bought with order ${row.orderNumber}` : "Bought") : "Issued by staff", row.to, row.testMode ? "Test card" : null].filter(Boolean).join(" · ")}
                  />
                  <RowFact className="hidden sm:block">{date(row.issuedAt)}</RowFact>
                  <RowAmount>
                    {formatMoney(row.balanceMinor, row.currency, locale)}
                    <span className="block text-caption text-muted">of {formatMoney(row.initialMinor, row.currency, locale)}</span>
                  </RowAmount>
                  <Chip signal={STATE_SIGNAL[row.state]} dot>
                    {STATE_WORDS[row.state]}
                  </Chip>
                </ListRow>
              ))}
            </List>
          )}
          {page.more && last && (
            <div className="mt-4">
              <Link href={filter({ before: `${last.issuedAt}_${last.id}` })} className="text-body text-ink-2 underline-offset-2 hover:underline">
                Older
              </Link>
            </div>
          )}
        </Card>
      )}

      <Card title="How long cards last" description="For cards sold or issued from now on; a card keeps the date it was issued with. Many countries expect at least three years: check yours." compact>
        {memberCan(member, "products:write") ? (
          <ActionForm action={saveGiftCardSettingsAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-body">
              <span className="text-caption text-muted">New cards last</span>
              <select name="expiry" defaultValue={settings.expiryMonths === null ? "never" : String(settings.expiryMonths)} className="min-h-10 rounded-md border border-line px-3">
                {EXPIRY_CHOICES.map((months) => (
                  <option key={String(months)} value={months === null ? "never" : String(months)}>
                    {expiryWords(months)}
                  </option>
                ))}
                {settings.expiryMonths !== null && !EXPIRY_CHOICES.includes(settings.expiryMonths) && (
                  <option value={String(settings.expiryMonths)}>{expiryWords(settings.expiryMonths)}</option>
                )}
              </select>
            </label>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-body text-ink">{expiryWords(settings.expiryMonths)}</p>
        )}
      </Card>
    </div>
  );
}

