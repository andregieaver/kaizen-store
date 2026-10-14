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
import { Button, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

import { setCartRemindersAction } from "./actions";

export const metadata: Metadata = { title: "Cart reminders" };

const STATUS: Record<AbandonedCheckoutRow["status"], string> = {
  waiting: "Waiting",
  reminded: "Reminded",
  recovered: "Bought after a reminder",
  bought: "Bought",
  opted_out: "Opted out",
  expired: "No more reminders",
};

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
  const base = `/admin/${store.slug}/cart-reminders`;
  const firstLocale = store.markets[0]?.locale ?? "";
  const codeOf = (id: string | null) => discounts.find((d) => d.id === id)?.code ?? null;
  const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const recovered = Object.entries(stats.recoveredMinor)
    .map(([currency, minor]) => formatMoney(minor, currency, locale))
    .join(" + ");
  const active = settings.steps.filter((s) => s.active).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cart reminders"
        description={<>Emails to shoppers who typed their email at checkout but did not pay, with a link back to the same cart.</>}
      />

      <Card
        title={<>{settings.enabled ? (active > 0 ? "Reminders are on" : "On, but every reminder is switched off") : "Reminders are off"}</>}
        aside={
          <form action={setCartRemindersAction.bind(null, store.slug, !settings.enabled)}>
            <Button type="submit" kind={settings.enabled ? "secondary" : "main"}>
              {settings.enabled ? "Turn off" : "Turn on"}
            </Button>
          </form>
        }
        compact
      >
        <div className="text-body text-ink-2">
          {settings.enabled ? (
            <p>
              Checkout keeps the email of shoppers who are not signed in as soon as they type it, and says under the email
              field that a reminder may come, with a link to say no. Every reminder has a link to stop them, and they stop
              as soon as the cart is bought. Emails and carts are erased after 60 days.
            </p>
          ) : (
            <p>
              Turn them on to start with three reminders, after an hour, a day and three days, which you can change. Nothing
              is kept at checkout while they are off.
            </p>
          )}
        </div>
      </Card>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="text-title text-ink">
          The last 30 days
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={tile}>
            <span className="text-sm text-muted">Carts with an email</span>
            <span className="text-metric text-ink tabular-nums">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Reminded</span>
            <span className="text-metric text-ink tabular-nums">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Bought after a reminder</span>
            <span className="text-metric text-ink tabular-nums">{stats.recovered}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Sales after reminders</span>
            <span className="text-metric text-ink tabular-nums">{recovered || formatMoney(0, mainCurrency(store), locale)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="text-title text-ink">
            Reminders
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
            New reminder
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            No reminders yet. Turn reminders on to start with three, or make one.
          </p>
        ) : (
          <Card compact>
            <List label="Reminders">
              {settings.steps.map((step) => (
                <ListRow key={step.id}>
                  <RowLead
                    title={`After ${describeDelay(step.delayMinutes)}`}
                    href={`${base}/${step.id}`}
                    sub={
                      <>
                        {(step.content[firstLocale]?.subject ?? Object.values(step.content)[0]?.subject ?? "").replaceAll("{store}", store.name)}
                        {codeOf(step.discountCodeId) && (
                          <>
                            {" · code "}
                            <span className="font-mono">{codeOf(step.discountCodeId)}</span>
                          </>
                        )}
                      </>
                    }
                  />
                  <Chip signal={step.active ? "positive" : "neutral"} dot>
                    {step.active ? "On" : "Switched off"}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>

      <section aria-labelledby="carts-heading" className="flex flex-col gap-3">
        <h2 id="carts-heading" className="text-title text-ink">
          Latest carts
        </h2>
        {carts.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            No carts yet. They show here once a shopper types their email at checkout.
          </p>
        ) : (
          <Card compact>
            <List label="Carts">
              {carts.map((cart) => (
                <ListRow key={cart.id}>
                  <RowLead
                    title={<span className="block max-w-72 truncate">{cart.email ?? "Erased"}</span>}
                    sub={
                      <>
                        {cart.items > 0 ? `${cart.items} ${cart.items === 1 ? "item" : "items"} · ${formatMoney(cart.subtotalMinor, cart.currency, locale)}` : "Empty cart"}
                        {cart.capturedAt && ` · typed ${date(cart.capturedAt)}`}
                      </>
                    }
                  />
                  <RowFact className="hidden sm:block" sub={cart.clickedAt ? "opened the link" : undefined}>
                    {cart.remindersSent === 1 ? "1 reminder" : `${cart.remindersSent} reminders`}
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

      <Card title="For your privacy policy" className="text-sm" compact>
        <p className="text-muted">
          Say that when a shopper types their email at checkout and does not finish, you may email reminders about the
          cart; that they can say no at checkout or in any reminder; and that the email and cart are erased after 60 days.
        </p>
      </Card>
    </div>
  );
}
