import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { MollieCard } from "@/components/admin/mollie-card";
import { PaymentMethodsCard } from "@/components/admin/payment-methods-card";
import { WalletsCard } from "@/components/admin/wallets-card";
import { StripeAccountPanel } from "@/components/admin/stripe-account-panel";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { paymentsEn } from "@/lib/admin-messages/payments.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { knownText } from "@/lib/known-words";
import { mainCurrency } from "@/lib/markets";
import { accountStage } from "@/lib/stripe-account";
import { memberCan, requireOwnerRole } from "@/server/permissions";
import { ensureTestAccount, requestIp } from "@/server/connect";
import { kaizenInvoicingOn } from "@/server/invoice-settings";
import { checkoutProviderOf, chosenCheckoutProviders, mollieAppOn, mollieConnection, mollieMethodStates } from "@/server/mollie";
import { methodChoices, methodStates } from "@/server/payment-methods";
import { walletDomains, walletHosts } from "@/server/express-checkout";
import { getPaymentSettings, recentAudit } from "@/server/settings";
import { getSetupProgress } from "@/server/setup";
import { Check } from "lucide-react";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import {
  activateMollieMethodAction,
  checkWalletsAction,
  connectMollieAction,
  disconnectMollieAction,
  saveCheckoutProviderAction,
  savePaymentMethodsAction,
  setStripeProviderAction,
} from "../../../actions";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentSettingsPage({
  params,
}: PageProps<"/admin/[store]/settings/payments">) {
  const current = await requireOwnerRole((await params).store);
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { account, store } = current;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "payments");
  const [settings, audit, kaizenInvoices, choices, progress] = await Promise.all([
    getPaymentSettings(store),
    // Round 5 (D615): the payment changes only, never the whole store's log.
    recentAudit(store.id, 20, ["payments.", "settings.payments", "stripe.", "wallets."]),
    kaizenInvoicingOn(store.id),
    methodChoices(store.id),
    getSetupProgress(store),
  ]);
  const isOwner = memberCan(current, "owner");
  const { accounts, stripe } = settings;
  const modes = settings.modes;
  // Test payments need nothing from the owner: Kaizen sets up the store's
  // test Stripe account itself (D20). Only live needs the owner's Stripe setup.
  // Real payments through Mollie (D292) need no Stripe account of the store's own: Mollie's, chosen and connected, is enough.
  const liveOnMollie = (await checkoutProviderOf(store.id, "live")) === "mollie";
  const readyModes = modes.filter(
    (mode) => mode === "test" || accountStage(accounts[mode] ?? null) === "ready" || (mode === "live" && liveOnMollie),
  );
  // Not ready yet: set it up now, so any problem from Stripe is shown here.
  const testSetup =
    modes.includes("test") && accounts.test?.cardPayments !== "active"
      ? await ensureTestAccount(store.id, account.id, await requestIp())
      : null;
  const testReady = accounts.test?.cardPayments === "active" || (testSetup?.ok === true && testSetup.ready);
  // What Stripe says of each method (D291), on the account checkout uses: the live one once it is there, else the test one.
  const methodMode = stripe.enabled ? stripe.activeMode : modes.includes("live") && accounts.live ? "live" : "test";
  const methods = { choices, states: await methodStates(store.id, methodMode) };
  // Wallets on each web address (D373), on the same account: what was last read from Stripe, and when.
  const wallets = { hosts: walletHosts(store.slug), read: await walletDomains(store.id, methodMode) };
  // Mollie (D292): offered once Kaizena Flow's Mollie app is set up; its methods are read for the mode the store is in, in its main currency.
  const mollieOn = mollieAppOn();
  const [mollie, mollieChosen] = mollieOn ? await Promise.all([mollieConnection(store.id), chosenCheckoutProviders(store.id)]) : [null, {}];
  const mollieMethods = mollie ? await mollieMethodStates(store.id, stripe.activeMode, mainCurrency(store)) : null;

  // Round 5 (D615): where the store is, in a sentence, and the four steps to real money with the one it is on.
  const liveOn = stripe.enabled && stripe.activeMode === "live" && readyModes.includes("live");
  const testOn = stripe.enabled && stripe.activeMode === "test";
  const state = modes.length === 0 ? "none" : liveOn ? "live" : testOn ? "test" : "off";
  const liveReady = readyModes.includes("live");
  type Step = { key: string; title: string; text: string; status: "done" | "needs" | "soon" | "later"; href?: string; button?: string };
  const steps: Step[] = [
    { key: "details", ...w.steps.details, status: progress.details ? "done" : "needs", href: `/admin/${store.slug}/settings/company` },
    { key: "connect", title: w.steps.connect.title, text: modes.includes("live") ? w.steps.connect.text : w.steps.connect.soonText, status: liveReady ? "done" : modes.includes("live") ? "needs" : "soon" },
    { key: "test", ...w.steps.test, status: liveOn || (testOn && testReady) ? "done" : "later" },
    { key: "live", ...w.steps.live, status: liveOn ? "done" : "later" },
  ];
  // Only the first step not done is the one to press; the others say where they stand.
  const pressHere = steps.find((step) => step.status === "needs")?.key ?? null;
  const stepLook = { done: "bg-positive-soft", needs: "bg-warning-soft", soon: "bg-sunken", later: "bg-sunken" } as const;
  const stepWord = (step: Step, i: number) => (step.status === "done" ? w.steps.done : step.status === "needs" ? w.steps.needsYou : step.status === "soon" ? w.steps.soon : i === steps.length - 1 ? w.steps.last : w.steps.then);

  return (
    <AdminTextScope texts={adminTexts(lang, ["payments"])}>
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.page.title}
        meta={[
          <span key="state">
            <span className="text-ink">{w.state[state]}</span>
            {w.state[`${state}More` as const]}
          </span>,
        ]}
      />

      <section aria-labelledby="pay-steps" className={`flex flex-col gap-4 px-6 py-5.5 ${CARD_CLASS}`}>
        <h2 id="pay-steps" className="text-title text-ink">
          {w.steps.title}
        </h2>
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(12.5rem,100%),1fr))] gap-3">
          {steps.map((step, i) => (
            <li key={step.key} className={`flex flex-col gap-2 rounded-panel p-4 ${stepLook[step.status]}`}>
              <span className={`flex items-center gap-2 text-caption ${step.status === "done" ? "text-positive-text" : step.status === "needs" ? "text-warning-text" : "text-muted"}`}>
                <span aria-hidden className={`flex size-5.5 items-center justify-center rounded-pill text-[12px] ${step.status === "done" ? "bg-brand text-brand-ink" : step.status === "needs" ? "bg-warning-solid text-ink" : "bg-line text-ink-2"}`}>
                  {step.status === "done" ? <Check className="size-3.5" /> : i + 1}
                </span>
                {stepWord(step, i)}
              </span>
              <span className="text-body text-ink">{step.title}</span>
              <span className="text-caption text-ink-2">{step.text}</span>
              {step.key === pressHere && step.href && step.button && (
                <Link href={step.href} className="mt-auto inline-flex h-9 items-center self-start rounded-pill bg-brand px-3.5 text-caption font-medium text-brand-ink">
                  {step.button}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      {modes.length === 0 && <p className={`px-6 py-4 text-body text-ink-2 ${CARD_CLASS}`}>{w.waysSoon}</p>}

      {modes.length === 0 && account.platformAdmin && (
        <div role="status">
          <Card title={w.page.unavailableTitle} className="text-sm" compact>
            {account.platformAdmin ? (
              <p>{fillWords(w.page.unavailableAdmin, { secret: "STRIPE_SECRET_KEY_TEST", publishable: "STRIPE_PUBLISHABLE_KEY_TEST", live: "_LIVE" })}</p>
            ) : (
              <p>{w.page.unavailable}</p>
            )}
          </Card>
        </div>
      )}

      {modes.includes("test") && (
        <Card title={w.test.title} className="flex flex-col gap-2 text-sm" compact>
          <p>
            {testReady
              ? w.test.ready
              : testSetup && !testSetup.ok
                ? fillWords(w.test.failed, { problem: knownText(testSetup.problem, paymentsEn.problems, w.problems) })
                : w.test.creating}
          </p>
          <p className="text-muted">{w.test.howTo}</p>
        </Card>
      )}

      {modes.includes("live") && (
        <StripeAccountPanel
          storeSlug={store.slug}
          mode="live"
          account={accounts.live}
          isOwner={isOwner}
          title={w.stripe.realPayments}
          words={w.stripe}
        />
      )}

      {modes.length > 0 && (
        <Card title={w.checkout.title} compact>
          <p className="mb-4 text-sm text-muted">
            {stripe.enabled ? fillWords(w.checkout.on, { mode: w.checkout.modes[stripe.activeMode] }) : w.checkout.off}{" "}
            {!modes.includes("live") && w.checkout.liveLater}
          </p>
          <ActionForm action={setStripeProviderAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <fieldset disabled={!isOwner || readyModes.length === 0} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={stripe.enabled} className="size-4" />
                {w.checkout.canPay}
              </label>
              {modes.length > 1 ? (
                <fieldset className="flex gap-4 text-sm">
                  <legend className="mb-1 font-medium">{w.checkout.mode}</legend>
                  {modes.map((mode) => (
                    <label key={mode} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="activeMode"
                        value={mode}
                        defaultChecked={stripe.activeMode === mode}
                        disabled={!readyModes.includes(mode)}
                      />
                      {mode === "test" ? w.checkout.testMode : readyModes.includes("live") ? w.checkout.live : w.checkout.liveSetup}
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
                  {w.checkout.invoices}
                  <span className="block text-muted">{w.checkout.invoicesHint}</span>
                  {kaizenInvoices && (
                    <span className="mt-1 block font-medium">
                      {w.checkout.kaizenInvoices}{" "}
                      <Link href={`/admin/${store.slug}/settings/invoices`} className="underline">
                        {w.checkout.invoicingSettings}
                      </Link>
                      .
                    </span>
                  )}
                </span>
              </label>
              <div>
                <SubmitButton>{w.checkout.save}</SubmitButton>
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
          words={w.methods}
          locale={ADMIN_LANG_FACTS[lang].locale}
        />
      )}

      {modes.length > 0 && (
        <WalletsCard
          hosts={wallets.hosts}
          domains={wallets.read?.domains ?? null}
          readAt={wallets.read?.readAt ?? null}
          states={methods.states}
          isOwner={isOwner}
          action={checkWalletsAction.bind(null, store.slug, methodMode)}
          words={w.wallets}
          methodWords={w.methods}
          locale={ADMIN_LANG_FACTS[lang].locale}
        />
      )}

      <MollieCard
        connection={mollie}
        appOn={mollieOn}
        isOwner={isOwner}
        modes={["test", "live"]}
        chosen={mollieChosen}
        methods={mollieMethods}
        connectAction={connectMollieAction.bind(null, store.slug)}
        providerAction={saveCheckoutProviderAction.bind(null, store.slug)}
        disconnectAction={disconnectMollieAction.bind(null, store.slug)}
        activateAction={activateMollieMethodAction.bind(null, store.slug)}
        words={w.mollie}
      />

      <details className={`px-6 py-4 ${CARD_CLASS}`}>
        <summary className="cursor-pointer text-body text-ink">
          {w.audit.fold} <span className="text-caption text-muted">{w.audit.foldSub}</span>
        </summary>
        {audit.length === 0 ? (
          <p className="mt-3 text-body text-muted">{w.audit.none}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-body">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2">
                <span className="text-ink">{entry.email ?? w.audit.system}</span>
                <span className="text-ink-2">{w.audit.actions[entry.action] ?? entry.action}</span>
                <time dateTime={entry.createdAt} className="text-muted">
                  · {new Date(entry.createdAt).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
    </AdminTextScope>
  );
}
