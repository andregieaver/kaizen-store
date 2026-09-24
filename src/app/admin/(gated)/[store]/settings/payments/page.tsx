import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StripeAccountPanel } from "@/components/admin/stripe-account-panel";
import { accountStage } from "@/lib/stripe-account";
import { requireMember } from "@/server/auth";
import { getPaymentSettings, recentAudit } from "@/server/settings";

import { setStripeProviderAction } from "../../../actions";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentSettingsPage({
  params,
}: PageProps<"/admin/[store]/settings/payments">) {
  const { account, store, role } = await requireMember((await params).store);
  const [settings, audit] = await Promise.all([getPaymentSettings(store), recentAudit(store.id)]);
  const isOwner = role === "owner";
  const { accounts, stripe } = settings;
  // Store owners set up one Stripe account: live once Kaizen is live. Only
  // Kaizen's own admins also see test mode, to try things out.
  const modes = account.platformAdmin
    ? settings.modes
    : settings.modes.includes("live")
      ? (["live"] as const)
      : settings.modes;
  const readyModes = modes.filter((mode) => accountStage(accounts[mode] ?? null) === "ready");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Payments</h1>
        <p className="text-sm text-muted">
          Payments run through your store&apos;s own Stripe account: shoppers pay your business
          directly and Stripe pays out to your bank.{" "}
          {isOwner ? "" : "Only an owner can set up Stripe or switch payments on and off."}
        </p>
      </div>

      {modes.length === 0 ? (
        <section role="status" className="rounded-lg border border-border bg-background p-5 text-sm">
          <h2 className="mb-2 font-medium">Payments are not available yet</h2>
          {account.platformAdmin ? (
            <p>
              Add Kaizen&apos;s Stripe keys in Vercel (<code>STRIPE_SECRET_KEY_TEST</code> and{" "}
              <code>STRIPE_PUBLISHABLE_KEY_TEST</code>, and the <code>_LIVE</code> pair when going
              live), redeploy, then connect the webhooks under Platform → Stripe.
            </p>
          ) : (
            <p>Kaizen is switching payments on shortly. Your other settings already work.</p>
          )}
        </section>
      ) : (
        modes.map((mode) => (
          <StripeAccountPanel
            key={mode}
            storeSlug={store.slug}
            mode={mode}
            account={accounts[mode]}
            isOwner={isOwner}
          />
        ))
      )}

      {modes.length > 0 && (
        <section aria-labelledby="checkout-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="checkout-heading" className="mb-1 font-medium">
            Checkout
          </h2>
          <p className="mb-4 text-sm text-muted">
            Currently {stripe.enabled ? "on" : "off"}
            {stripe.enabled ? `, in ${stripe.activeMode} mode` : ""}.{" "}
            {readyModes.length === 0 && "Finish setting up Stripe above to switch it on."}
          </p>
          <ActionForm action={setStripeProviderAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <fieldset disabled={!isOwner || readyModes.length === 0} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={stripe.enabled} className="size-4" />
                Shoppers can pay
              </label>
              {modes.length > 1 ? (
                <fieldset className="flex gap-4 text-sm">
                  <legend className="mb-1 font-medium">Mode</legend>
                  {modes.map((mode) => (
                    <label key={mode} className="flex items-center gap-2">
                      <input type="radio" name="activeMode" value={mode} defaultChecked={stripe.activeMode === mode} />
                      {mode === "test" ? "Test (no real money)" : "Live"}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <input type="hidden" name="activeMode" value={modes[0]} />
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="orderInvoices"
                  defaultChecked={stripe.orderInvoices}
                  className="mt-0.5 size-4"
                />
                <span>
                  Email an invoice (PDF) with each order
                  <span className="block text-muted">
                    Stripe sends it with your business details and the VAT included. Stripe charges
                    a small fee per invoice. Without it, shoppers get Stripe&apos;s receipt if receipts
                    are on in your Stripe Dashboard.
                  </span>
                </span>
              </label>
              <div>
                <SubmitButton>Save</SubmitButton>
              </div>
            </fieldset>
          </ActionForm>
        </section>
      )}

      {modes.length > 0 && (
        <section aria-labelledby="methods-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="methods-heading" className="mb-1 font-medium">
            Payment methods
          </h2>
          <p className="text-sm text-muted">
            Stripe shows each shopper the methods that suit them from the ones you turn on in your
            Stripe Dashboard under{" "}
            <a
              href="https://dashboard.stripe.com/settings/payment_methods"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              Settings → Payment methods
            </a>
            : cards, Apple Pay and Google Pay, Klarna, MobilePay in Denmark, Swish in Sweden, and
            more.
          </p>
        </section>
      )}

      <section aria-labelledby="audit-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="audit-heading" className="mb-3 font-medium">
          Recent changes
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">No changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.createdAt} className="text-muted">
                  {entry.createdAt.slice(0, 16).replace("T", " ")} UTC
                </time>{" "}
                · {entry.email ?? "system"} · <code>{entry.action}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
