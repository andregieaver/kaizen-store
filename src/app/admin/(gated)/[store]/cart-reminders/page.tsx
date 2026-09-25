import type { Metadata } from "next";
import Link from "next/link";

import { describeDelay } from "@/lib/cart-reminders";
import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import {
  cartReminderStats,
  getCartReminderSettings,
  listAbandonedCheckouts,
  type AbandonedCheckoutRow,
} from "@/server/cart-reminders";
import { listDiscounts } from "@/server/discounts";

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

const tile = "flex flex-col gap-1 rounded-lg border border-border bg-background p-4";

/**
 * Reminders about carts left at checkout (D33): whether they go out, the
 * reminders and their texts, how they do, and the latest carts.
 */
export default async function CartRemindersPage({ params }: PageProps<"/admin/[store]/cart-reminders">) {
  const { store } = await requireMember((await params).store);
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
      <div>
        <h1 className="text-2xl font-semibold">Cart reminders</h1>
        <p className="text-sm text-muted">
          Emails to shoppers who typed their email at checkout but did not pay, with a link back to the same cart.
        </p>
      </div>

      <section aria-labelledby="switch-heading" className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-background p-5">
        <div className="flex max-w-2xl flex-col gap-2 text-sm">
          <h2 id="switch-heading" className="text-base font-medium">
            {settings.enabled ? (active > 0 ? "Reminders are on" : "On, but every reminder is switched off") : "Reminders are off"}
          </h2>
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
        <form action={setCartRemindersAction.bind(null, store.slug, !settings.enabled)}>
          <button
            type="submit"
            className={
              settings.enabled
                ? "min-h-10 rounded-md border border-border px-4 text-sm"
                : "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
            }
          >
            {settings.enabled ? "Turn off" : "Turn on"}
          </button>
        </form>
      </section>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="font-medium">
          The last 30 days
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={tile}>
            <span className="text-sm text-muted">Carts with an email</span>
            <span className="text-2xl font-semibold">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Reminded</span>
            <span className="text-2xl font-semibold">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Bought after a reminder</span>
            <span className="text-2xl font-semibold">{stats.recovered}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Sales after reminders</span>
            <span className="text-2xl font-semibold">{recovered || formatMoney(0, store.markets[0]?.currency ?? "NOK", locale)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="font-medium">
            Reminders
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            New reminder
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            No reminders yet. Turn reminders on to start with three, or make one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Sent after</th>
                  <th scope="col" className="px-4 py-2 font-medium">Subject</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Code</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.steps.map((step) => (
                  <tr key={step.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{describeDelay(step.delayMinutes)}</td>
                    <td className="px-4 py-2">
                      {(step.content[firstLocale]?.subject ?? Object.values(step.content)[0]?.subject ?? "").replaceAll("{store}", store.name)}
                    </td>
                    <td className="hidden px-4 py-2 font-mono sm:table-cell">{codeOf(step.discountCodeId) ?? "—"}</td>
                    <td className="px-4 py-2">{step.active ? "On" : "Switched off"}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`${base}/${step.id}`} className="underline">
                        Edit<span className="sr-only"> the reminder after {describeDelay(step.delayMinutes)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="carts-heading" className="flex flex-col gap-3">
        <h2 id="carts-heading" className="font-medium">
          Latest carts
        </h2>
        {carts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            No carts yet. They show here once a shopper types their email at checkout.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Email</th>
                  <th scope="col" className="px-4 py-2 font-medium">Cart</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Typed</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Reminders</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {carts.map((cart) => (
                  <tr key={cart.id} className="border-b border-border last:border-0">
                    <td className="max-w-56 truncate px-4 py-2">{cart.email ?? <span className="text-muted">Erased</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {cart.items > 0
                        ? `${cart.items} ${cart.items === 1 ? "item" : "items"} · ${formatMoney(cart.subtotalMinor, cart.currency, locale)}`
                        : "—"}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2 md:table-cell">{cart.capturedAt ? date(cart.capturedAt) : "—"}</td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      {cart.remindersSent}
                      {cart.clickedAt && <span className="text-muted"> · opened the link</span>}
                    </td>
                    <td className="px-4 py-2">
                      {cart.recoveredOrderId ? (
                        <Link href={`/admin/${store.slug}/orders/${cart.recoveredOrderId}`} className="underline">
                          {STATUS[cart.status]}
                        </Link>
                      ) : (
                        STATUS[cart.status]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="privacy-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 id="privacy-heading" className="mb-2 font-medium">
          For your privacy policy
        </h2>
        <p className="text-muted">
          Say that when a shopper types their email at checkout and does not finish, you may email reminders about the
          cart; that they can say no at checkout or in any reminder; and that the email and cart are erased after 60 days.
        </p>
      </section>
    </div>
  );
}
