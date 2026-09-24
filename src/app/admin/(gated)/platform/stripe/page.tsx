import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PAYMENT_MODES } from "@/lib/stripe-account";
import { getSaleFeeBps, listPlatformWebhooks } from "@/server/connect";
import { platformModes, WEBHOOK_KINDS } from "@/server/stripe";

import { connectWebhooksAction, saveSaleFeeAction } from "../actions";

export const metadata: Metadata = { title: "Stripe" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

export default async function PlatformStripePage() {
  const [webhooks, saleFeeBps] = await Promise.all([listPlatformWebhooks(), getSaleFeeBps()]);
  const modes = platformModes();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Stripe</h1>
        <p className="text-sm text-muted">
          Kaizen is a Stripe Connect platform: each store sells through its own Stripe account, and
          Kaizen bills stores for their plans from its own. Keys come from Vercel (
          <code>STRIPE_SECRET_KEY_TEST</code>, <code>STRIPE_PUBLISHABLE_KEY_TEST</code> and the{" "}
          <code>_LIVE</code> pair). Plans are billed in live mode once live keys are set.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {PAYMENT_MODES.map((mode) => {
          const configured = modes.includes(mode);
          const hooks = webhooks.filter((hook) => hook.mode === mode);
          const connected = WEBHOOK_KINDS.every((kind) => hooks.some((hook) => hook.kind === kind));
          return (
            <li key={mode} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-sm">
              <h2 className="font-medium">{mode === "test" ? "Test mode" : "Live mode"}</h2>
              <p>{configured ? "Keys are set." : "Keys are not set."}</p>
              <p className={connected ? "" : "text-muted"}>
                {connected
                  ? `Webhooks connected ${hooks[0].updatedAt.slice(0, 10)} (${new URL(hooks[0].url).host}).`
                  : hooks.length > 0
                    ? "Webhooks need reconnecting: plan events do not reach Kaizen yet."
                    : "Webhooks are not connected: payments, account changes and plans will not reach Kaizen."}
              </p>
              {configured && (
                <ActionForm action={connectWebhooksAction}>
                  <input type="hidden" name="mode" value={mode} />
                  <SubmitButton variant={connected ? "secondary" : "primary"}>
                    {connected ? "Reconnect webhooks" : "Connect webhooks"}
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>
      <ActionForm action={saveSaleFeeAction} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Default fee on each sale (%)
          <input
            name="percent"
            inputMode="decimal"
            defaultValue={String(saleFeeBps / 100)}
            className={`${control} w-32`}
            aria-describedby="fee-hint"
          />
        </label>
        <p id="fee-hint" className="text-sm text-muted">
          For stores without a plan. A plan&apos;s own fee, or a fee set for one store, takes its
          place. Stores pay Stripe&apos;s own fees themselves. 0 means no fee.
        </p>
        <div>
          <SubmitButton>Save fee</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
