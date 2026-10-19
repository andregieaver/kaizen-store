import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PaymentMethodsCard } from "@/components/admin/payment-methods-card";
import { StripeAccountPanel } from "@/components/admin/stripe-account-panel";
import { accountStage } from "@/lib/stripe-account";
import { memberCan, requireOwnerRole } from "@/server/permissions";
import { ensureTestAccount, requestIp } from "@/server/connect";
import { kaizenInvoicingOn } from "@/server/invoice-settings";
import { methodChoices, methodStates } from "@/server/payment-methods";
import { getPaymentSettings, recentAudit } from "@/server/settings";
import { Card, PageHeader } from "@/components/admin/ui";

import { savePaymentMethodsAction, setStripeProviderAction } from "../../../actions";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentSettingsPage({
  params,
}: PageProps<"/admin/[store]/settings/payments">) {
  const current = await requireOwnerRole((await params).store);
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { account, store } = current;
  const [settings, audit, kaizenInvoices, choices] = await Promise.all([getPaymentSettings(store), recentAudit(store.id), kaizenInvoicingOn(store.id), methodChoices(store.id)]);
  const isOwner = memberCan(current, "owner");
  const { accounts, stripe } = settings;
  const modes = settings.modes;
  // Test payments need nothing from the owner: Kaizen sets up the store's
  // test Stripe account itself (D20). Only live needs the owner's Stripe setup.
  const readyModes = modes.filter(
    (mode) => mode === "test" || accountStage(accounts[mode] ?? null) === "ready",
  );
  // Not ready yet: set it up now, so any problem from Stripe is shown here.
  const testSetup =
    modes.includes("test") && accounts.test?.cardPayments !== "active"
      ? await ensureTestAccount(store.id, account.id, await requestIp())
      : null;
  const testReady = accounts.test?.cardPayments === "active" || (testSetup?.ok === true && testSetup.ready);
  // What Stripe says of each method (D291), on the account checkout uses: the live one once it is there, else the test one.
  const methods = { choices, states: await methodStates(store.id, stripe.enabled ? stripe.activeMode : modes.includes("live") && accounts.live ? "live" : "test") };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payments"
        description={<>Shoppers pay your business directly through your store&apos;s own Stripe account.{" "}{isOwner ? "" : "Only an owner can switch payments on and off."}</>}
      />

      {modes.length === 0 && (
        <div role="status">
          <Card title="Payments are not available yet" className="text-sm" compact>
            {account.platformAdmin ? (
              <p>
                Add Kaizena Flow&apos;s Stripe keys in Vercel (<code>STRIPE_SECRET_KEY_TEST</code> and{" "}
                <code>STRIPE_PUBLISHABLE_KEY_TEST</code>, and the <code>_LIVE</code> pair when going
                live), redeploy, then connect the webhooks under Platform → Stripe.
              </p>
            ) : (
              <p>Kaizena Flow is switching payments on shortly. Your other settings already work.</p>
            )}
          </Card>
        </div>
      )}

      {modes.includes("test") && (
        <Card title="Test payments" className="flex flex-col gap-2 text-sm" compact>
          <p>
            {testReady
              ? "Ready. Nothing to set up: Kaizena Flow created a test Stripe account for your store."
              : testSetup && !testSetup.ok
                ? `Kaizena Flow could not create your test Stripe account yet: ${testSetup.problem}`
                : "Kaizena Flow is creating a test Stripe account for your store. It is ready in a few seconds, with nothing for you to fill in."}
          </p>
          <p className="text-muted">
            Try your checkout with the card 4242 4242 4242 4242, any future date and any CVC. Test
            orders show under Orders; no real money moves. Your storefront says it is in test mode
            while it is.
          </p>
        </Card>
      )}

      {modes.includes("live") && (
        <StripeAccountPanel
          storeSlug={store.slug}
          mode="live"
          account={accounts.live}
          isOwner={isOwner}
          title="Real payments"
        />
      )}

      {modes.length > 0 && (
        <Card title="Checkout" compact>
          <p className="mb-4 text-sm text-muted">
            Currently {stripe.enabled ? "on" : "off"}
            {stripe.enabled ? `, in ${stripe.activeMode} mode` : ""}.{" "}
            {!modes.includes("live") && "Real payments open when Kaizena Flow goes live."}
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
                      <input
                        type="radio"
                        name="activeMode"
                        value={mode}
                        defaultChecked={stripe.activeMode === mode}
                        disabled={!readyModes.includes(mode)}
                      />
                      {mode === "test" ? "Test (no real money)" : readyModes.includes("live") ? "Live" : "Live (set up Stripe above first)"}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <input type="hidden" name="activeMode" value={modes[0]} />
              )}
              <label className="flex items-start gap-2 text-sm">
                {/* Kaizen's own invoices (D159) replace Stripe's while they are on: the choice is kept as it was, and not used. */}
                <input
                  type="checkbox"
                  name={kaizenInvoices ? undefined : "orderInvoices"}
                  defaultChecked={stripe.orderInvoices}
                  disabled={kaizenInvoices}
                  className="mt-0.5 size-4"
                />
                {kaizenInvoices && stripe.orderInvoices && <input type="hidden" name="orderInvoices" value="on" />}
                <span>
                  Email an invoice (PDF) with each order
                  <span className="block text-muted">
                    Stripe sends it with your business details and the VAT included. Stripe charges
                    a small fee per invoice. Without it, shoppers get Stripe&apos;s receipt if receipts
                    are on in your Stripe Dashboard.
                  </span>
                  {kaizenInvoices && (
                    <span className="mt-1 block font-medium">
                      Not used while Kaizena Flow makes the invoices: every paid order gets a numbered invoice from the store, and a shopper never gets two. Change this in the{" "}
                      <Link href={`/admin/${store.slug}/settings/invoices`} className="underline">
                        invoicing settings
                      </Link>
                      .
                    </span>
                  )}
                </span>
              </label>
              <div>
                <SubmitButton>Save</SubmitButton>
              </div>
            </fieldset>
          </ActionForm>
        </Card>
      )}

      {modes.length > 0 && (
        <PaymentMethodsCard
          states={methods.states}
          choices={methods.choices}
          markets={store.markets.map((m) => m.code)}
          isOwner={isOwner}
          action={savePaymentMethodsAction.bind(null, store.slug)}
        />
      )}

      <Card title="Recent changes" compact>
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
      </Card>
    </div>
  );
}
