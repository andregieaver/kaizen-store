import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { isKnownMethod, PAYMENT_METHODS } from "@/lib/payment-methods";
import { requireMember } from "@/server/auth";
import { StripeKeysForm } from "@/components/admin/stripe-keys-form";
import { getPaymentSettings, recentAudit } from "@/server/settings";

import {
  setPaymentMethodsAction,
  setStripeProviderAction,
} from "../../../actions";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentSettingsPage({
  params,
}: PageProps<"/admin/[store]/settings/payments">) {
  const { account, store, role } = await requireMember((await params).store);
  const [settings, audit] = await Promise.all([
    getPaymentSettings(store),
    recentAudit(store.id),
  ]);
  const isOwner = role === "owner";
  const markets = store.markets;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Payments</h1>
        <p className="text-sm text-muted">
          Payments run through Stripe. Keys are stored encrypted and are never shown again after
          saving. {isOwner ? "" : "Only an owner can change keys or switch Stripe on and off."}
        </p>
      </div>

      {!settings.encryptionKeyConfigured && (
        <section role="alert" className="rounded-lg border border-border bg-background p-5 text-sm">
          <h2 className="mb-2 font-medium">Payment keys cannot be saved right now</h2>
          {account.platformAdmin ? (
            <p>
              The server has no <code>SETTINGS_ENCRYPTION_KEY</code>. Add it in Vercel (Settings →
              Environment Variables, Production and Preview, marked Sensitive) as 32 random bytes in
              base64, then redeploy. Keep a copy in a password manager: without it, saved keys cannot
              be read back.
            </p>
          ) : (
            <p>We are fixing this. Your other settings still work.</p>
          )}
        </section>
      )}

      <section aria-labelledby="stripe-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="stripe-heading" className="mb-1 font-medium">
          Stripe
        </h2>
        <p className="mb-4 text-sm text-muted">
          Currently {settings.stripe.enabled ? "enabled" : "disabled"}, in {settings.stripe.activeMode} mode.
          Test mode takes no real payments.
        </p>
        <ActionForm action={setStripeProviderAction.bind(null, store.slug)} className="flex flex-col gap-3">
          <fieldset disabled={!isOwner} className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={settings.stripe.enabled} className="size-4" />
              Take payments with Stripe
            </label>
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1 font-medium">Mode</legend>
              {(["test", "live"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="activeMode"
                    value={mode}
                    defaultChecked={settings.stripe.activeMode === mode}
                  />
                  {mode === "test" ? "Test" : "Live"}
                </label>
              ))}
            </fieldset>
            <div>
              <SubmitButton disabled={!isOwner}>Save</SubmitButton>
            </div>
          </fieldset>
        </ActionForm>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {(["test", "live"] as const).map((mode) => (
          <StripeKeysForm
            key={mode}
            storeSlug={store.slug}
            mode={mode}
            status={settings.credentials[mode]}
            disabled={!isOwner || !settings.encryptionKeyConfigured}
          />
        ))}
      </div>

      <section aria-labelledby="methods-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="methods-heading" className="mb-1 font-medium">
          Payment methods
        </h2>
        <p className="mb-4 text-sm text-muted">
          Choose which methods shoppers see in each country. A method must also be enabled in your
          Stripe Dashboard. Vipps is not offered through Stripe here.
        </p>
        <ActionForm action={setPaymentMethodsAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 font-medium">
                  Method
                </th>
                {markets.map((market) => (
                  <th key={market.code} scope="col" className="py-2 text-center font-medium">
                    {market.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PAYMENT_METHODS.map((method) => (
                <tr key={method.id} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 font-normal">
                    {method.name}
                    {method.note && <span className="block text-xs text-muted">{method.note}</span>}
                  </th>
                  {markets.map((market) => (
                    <td key={market.code} className="py-2 text-center">
                      {isKnownMethod(market.code, method.id) ? (
                        <input
                          type="checkbox"
                          name={`method:${market.code}:${method.id}`}
                          defaultChecked={settings.methods[market.code]?.has(method.id)}
                          aria-label={`${method.name} in ${market.name}`}
                          className="size-4"
                        />
                      ) : (
                        <span className="text-muted" aria-label={`Not available in ${market.name}`}>
                          –
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <SubmitButton>Save payment methods</SubmitButton>
          </div>
        </ActionForm>
      </section>

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
