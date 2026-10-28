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
import { Card, PageHeader } from "@/components/admin/ui";

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
  const [settings, audit, kaizenInvoices, choices] = await Promise.all([getPaymentSettings(store), recentAudit(store.id), kaizenInvoicingOn(store.id), methodChoices(store.id)]);
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

  return (
    <AdminTextScope texts={adminTexts(lang, ["payments"])}>
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.page.title}
        description={<>{w.page.intro}{" "}{isOwner ? "" : w.page.ownerOnly}</>}
      />

      {modes.length === 0 && (
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

      <Card title={w.audit.title} compact>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">{w.audit.none}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.createdAt} className="text-muted">
                  {entry.createdAt.slice(0, 16).replace("T", " ")} UTC
                </time>{" "}
                · {entry.email ?? w.audit.system} · <code>{entry.action}</code>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
    </AdminTextScope>
  );
}
