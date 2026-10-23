import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { describeDelay } from "@/lib/cart-reminders";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { requirePermission } from "@/server/permissions";
import {
  cartReminderStats,
  getCartReminderSettings,
  listAbandonedCheckouts,
  type AbandonedCheckoutRow,
} from "@/server/cart-reminders";
import { listDiscounts } from "@/server/discounts";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { Button, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

import { setCartRemindersAction } from "./actions";

export const metadata: Metadata = { title: "Cart reminders" };

const STATUS_SIGNAL = { waiting: "insight", reminded: "warning", recovered: "positive", bought: "positive", opted_out: "neutral", expired: "neutral" } as const;

const tile = "flex flex-col gap-1 rounded-lg border border-line bg-card p-4";

/**
 * Reminders about carts left at checkout (D33): whether they go out, the
 * reminders and their texts, how they do, and the latest carts.
 */
export default async function CartRemindersPage({ params }: PageProps<"/admin/[store]/cart-reminders">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const [settings, stats, carts, discounts] = await Promise.all([
    getCartReminderSettings(store.id),
    cartReminderStats(store.id),
    listAbandonedCheckouts(store.id),
    listDiscounts(store.id),
  ]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "bookings").cartReminders;
  const STATUS: Record<AbandonedCheckoutRow["status"], string> = w.status;
  const base = `/admin/${store.slug}/cart-reminders`;
  const firstLocale = store.markets[0]?.locale ?? "";
  const codeOf = (id: string | null) => discounts.find((d) => d.id === id)?.code ?? null;
  const date = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const recovered = Object.entries(stats.recoveredMinor)
    .map(([currency, minor]) => formatMoney(minor, currency, locale))
    .join(" + ");
  const active = settings.steps.filter((s) => s.active).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />

      <Card
        title={settings.enabled ? (active > 0 ? w.on : w.onAllOff) : w.off}
        aside={
          <form action={setCartRemindersAction.bind(null, store.slug, !settings.enabled)}>
            <Button type="submit" kind={settings.enabled ? "secondary" : "main"}>
              {settings.enabled ? w.turnOff : w.turnOn}
            </Button>
          </form>
        }
        compact
      >
        <div className="text-body text-ink-2">
          {settings.enabled ? (
            <p>{w.onText}</p>
          ) : (
            <p>{w.offText}</p>
          )}
        </div>
      </Card>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="text-title text-ink">
          {w.last30}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={tile}>
            <span className="text-sm text-muted">{w.captured}</span>
            <span className="text-metric text-ink tabular-nums">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">{w.reminded}</span>
            <span className="text-metric text-ink tabular-nums">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">{w.recovered}</span>
            <span className="text-metric text-ink tabular-nums">{stats.recovered}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">{w.sales}</span>
            <span className="text-metric text-ink tabular-nums">{recovered || formatMoney(0, mainCurrency(store), locale)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="text-title text-ink">
            {w.reminders}
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
            {w.newReminder}
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.noReminders}
          </p>
        ) : (
          <Card compact>
            <List label={w.reminders}>
              {settings.steps.map((step) => (
                <ListRow key={step.id}>
                  <RowLead
                    title={fillWords(w.after, { delay: describeDelay(step.delayMinutes, w.delay) })}
                    href={`${base}/${step.id}`}
                    sub={
                      <>
                        {(step.content[firstLocale]?.subject ?? Object.values(step.content)[0]?.subject ?? "").replaceAll("{store}", store.name)}
                        {codeOf(step.discountCodeId) && (
                          <>
                            {` · ${w.code} `}
                            <span className="font-mono">{codeOf(step.discountCodeId)}</span>
                          </>
                        )}
                      </>
                    }
                  />
                  <Chip signal={step.active ? "positive" : "neutral"} dot>
                    {step.active ? w.stepOn : w.stepOff}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>

      <section aria-labelledby="carts-heading" className="flex flex-col gap-3">
        <h2 id="carts-heading" className="text-title text-ink">
          {w.latest}
        </h2>
        {carts.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.noCarts}
          </p>
        ) : (
          <Card compact>
            <List label={w.carts}>
              {carts.map((cart) => (
                <ListRow key={cart.id}>
                  <RowLead
                    title={<span className="block max-w-72 truncate">{cart.email ?? w.erased}</span>}
                    sub={
                      <>
                        {cart.items > 0 ? `${countWords(cart.items, w.items)} · ${formatMoney(cart.subtotalMinor, cart.currency, locale)}` : w.empty}
                        {cart.capturedAt && ` · ${fillWords(w.typed, { date: date(cart.capturedAt) })}`}
                      </>
                    }
                  />
                  <RowFact className="hidden sm:block" sub={cart.clickedAt ? w.opened : undefined}>
                    {countWords(cart.remindersSent, w.sent)}
                  </RowFact>
                  {cart.recoveredOrderId ? (
                    <Link href={`/admin/${store.slug}/orders/${cart.recoveredOrderId}`} className="underline-offset-2 hover:underline">
                      <Chip signal={STATUS_SIGNAL[cart.status]} dot>
                        {STATUS[cart.status]}
                      </Chip>
                    </Link>
                  ) : (
                    <Chip signal={STATUS_SIGNAL[cart.status]} dot>
                      {STATUS[cart.status]}
                    </Chip>
                  )}
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>

      <Card title={w.privacy} className="text-sm" compact>
        <p className="text-muted">{w.privacyText}</p>
      </Card>
    </div>
  );
}
