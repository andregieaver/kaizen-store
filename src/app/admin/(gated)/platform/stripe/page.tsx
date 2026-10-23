import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PAYMENT_MODES } from "@/lib/stripe-account";
import { getCheckoutUi, getSaleFeeBps, listPlatformWebhooks } from "@/server/connect";
import { platformModes, WEBHOOK_KINDS } from "@/server/stripe";

import { connectWebhooksAction, saveCheckoutUiAction, saveSaleFeeAction } from "../actions";
import { requirePlatformAdmin } from "@/server/auth";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Stripe" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

export default async function PlatformStripePage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const w = adminText(adminLangOf(account.adminLocale), "platform").stripe;
  const [webhooks, saleFeeBps, checkoutUi] = await Promise.all([
    listPlatformWebhooks(),
    getSaleFeeBps(),
    getCheckoutUi(),
  ]);
  const modes = platformModes();
  return (
    <>
      <PageHeader
        title={w.title}
        description={(() => {
          const [before, rest] = w.description.split("{keys}");
          const [middle, after] = rest.split("{live}");
          return (
            <>
              {before}
              <code>STRIPE_SECRET_KEY_TEST</code>, <code>STRIPE_PUBLISHABLE_KEY_TEST</code>
              {middle}
              <code>_LIVE</code>
              {after}
            </>
          );
        })()}
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {PAYMENT_MODES.map((mode) => {
          const configured = modes.includes(mode);
          const hooks = webhooks.filter((hook) => hook.mode === mode);
          const connected = WEBHOOK_KINDS.every((kind) => hooks.some((hook) => hook.kind === kind));
          return (
            <li key={mode} className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4 text-sm">
              <h2 className="text-title text-ink">{mode === "test" ? w.testMode : w.liveMode}</h2>
              <p>{configured ? w.keysSet : w.keysNotSet}</p>
              <p className={connected ? "" : "text-muted"}>
                {connected
                  ? fillWords(w.connected, { date: hooks[0].updatedAt.slice(0, 10), host: new URL(hooks[0].url).host })
                  : hooks.length > 0
                    ? w.reconnectNeeded
                    : w.notConnected}
              </p>
              {configured && (
                <ActionForm action={connectWebhooksAction}>
                  <input type="hidden" name="mode" value={mode} />
                  <SubmitButton variant={connected ? "secondary" : "primary"}>
                    {connected ? w.reconnect : w.connect}
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>
      <ActionForm
        action={saveCheckoutUiAction}
        successMessage={w.savedUi}
        className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}
      >
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{w.wherePay}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="ui" value="custom" defaultChecked={checkoutUi === "custom"} className="mt-0.5 size-4" />
            <span>
              {w.custom}
              <span className="block text-muted">{w.customNote}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="ui" value="hosted" defaultChecked={checkoutUi === "hosted"} className="mt-0.5 size-4" />
            <span>
              {w.hosted}
              <span className="block text-muted">{w.hostedNote}</span>
            </span>
          </label>
        </fieldset>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={saveSaleFeeAction} className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.defaultFee}
          <input
            name="percent"
            inputMode="decimal"
            defaultValue={String(saleFeeBps / 100)}
            className={`${control} w-32`}
            aria-describedby="fee-hint"
          />
        </label>
        <p id="fee-hint" className="text-sm text-muted">
          {w.feeHint}
        </p>
        <div>
          <SubmitButton>{w.saveFee}</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
