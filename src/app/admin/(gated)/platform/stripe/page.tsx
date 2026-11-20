import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { PAYMENT_MODES } from "@/lib/stripe-account";
import { getCheckoutUi, getSaleFeeBps, listPlatformWebhooks } from "@/server/connect";
import { platformModes, WEBHOOK_KINDS } from "@/server/stripe";

import { connectWebhooksAction, saveCheckoutUiAction, saveSaleFeeAction } from "../actions";
import { requirePlatformReader } from "@/server/auth";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";

export const metadata: Metadata = { title: "Stripe" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

export default async function PlatformStripePage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_WORDS[lang].stripe;
  const [webhooks, saleFeeBps, checkoutUi] = await Promise.all([
    listPlatformWebhooks(),
    getSaleFeeBps(),
    getCheckoutUi(),
  ]);
  const modes = platformModes();
  const ph = w.phone;
  const row = { flat: true, change: ph.change, done: ph.close } as const;
  return (
    <>
      <PageHeader
        title={w.title}
        description={(() => {
          const [before, rest] = w.description.split("{keys}");
          const [middle, after] = rest.split("{live}");
          return (
            <>
              <span className="sm:hidden">{ph.lead}</span>
              <span className="max-sm:hidden">
              {before}
              <code>{"STRIPE_SECRET_KEY_TEST"}</code>, <code>{"STRIPE_PUBLISHABLE_KEY_TEST"}</code>
              {middle}
              <code>{"_LIVE"}</code>
              {after}
              </span>
            </>
          );
        })()}
      />
      {/* Round 71 (D853): on a phone the two modes are rows of one card, each saying keys and webhooks in a line; Connect stays on its row. */}
      <ul className="grid gap-3 sm:grid-cols-2 max-sm:gap-0 max-sm:divide-y max-sm:divide-line max-sm:overflow-hidden max-sm:rounded-panel max-sm:bg-card">
        {PAYMENT_MODES.map((mode) => {
          const configured = modes.includes(mode);
          const hooks = webhooks.filter((hook) => hook.mode === mode);
          const connected = WEBHOOK_KINDS.every((kind) => hooks.some((hook) => hook.kind === kind));
          return (
            <li key={mode} className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4 text-sm max-sm:min-h-14 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:gap-2 max-sm:rounded-none max-sm:border-0 max-sm:px-4 max-sm:py-2">
              <span className="flex min-w-0 flex-col gap-3 max-sm:gap-0.5">
              <h2 className="text-title text-ink max-sm:text-body">{mode === "test" ? w.testMode : w.liveMode}</h2>
              <span className={`text-caption sm:hidden ${configured && connected ? "text-ink-2" : "text-danger-text"}`}>
                {[configured ? ph.keys : ph.noKeys, connected ? ph.connected : ph.notConnected].join(" · ")}
              </span>
              <p className="max-sm:hidden">{configured ? w.keysSet : w.keysNotSet}</p>
              <p className={`max-sm:hidden ${connected ? "" : "text-muted"}`}>
                {connected
                  ? fillWords(w.connected, { date: adminDate(PLATFORM_TIME_ZONE, hooks[0].updatedAt, "day", lang), host: new URL(hooks[0].url).host })
                  : hooks.length > 0
                    ? w.reconnectNeeded
                    : w.notConnected}
              </p>
              </span>
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
      {/* Round 71 (D853): on a phone where shoppers pay and the default fee are rows saying what is set, opening their forms. */}
      <PhoneRows>
      <PhoneRow {...row} title={w.wherePay} sub={checkoutUi === "custom" ? w.custom : w.hosted}>
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
      </PhoneRow>
      <PhoneRow {...row} last title={w.defaultFee} sub={fillWords(ph.feeSub, { n: saleFeeBps / 100 })}>
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
      </PhoneRow>
      </PhoneRows>
    </>
  );
}
