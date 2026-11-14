"use client";

import { loadStripe, type Appearance, type StripeElementLocale } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  ContactDetailsElement,
  ExpressCheckoutElement,
  PaymentElement,
  ShippingAddressElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { checkoutAccountAction } from "@/app/s/[store]/[market]/account/actions";
import { captureCheckoutEmailAction, checkoutNewsAction, checkoutRemindersAction, checkoutSmsAction, deliveryReadyAction, saveCheckoutContactAction } from "@/app/s/[store]/[market]/checkout/actions";
import { recordTermsAction } from "@/app/s/[store]/[market]/checkout/terms-actions";
import { stripeAppearance, stripeFonts, type CheckoutAppearance } from "@/lib/checkout-appearance";
import { cleanContact, type CheckoutContactSettings, type ContactProblem } from "@/lib/checkout-contact";
import { payHeld, payStep, type TermsDisplay } from "@/lib/checkout-terms";

import { useShowsDark } from "./color-mode-switch";
import { termsKey, useTicked } from "./terms-choice";

export type CheckoutFormLabels = {
  contact: string;
  delivery: string;
  payment: string;
  /** "Pay 249,00 kr". */
  pay: string;
  paying: string;
  loading: string;
  unavailable: string;
  secure: string;
  expired: string;
  backToCart: string;
  seeOrder: string;
};

/**
 * Reminders about the cart (D33), for shoppers who are not signed in when
 * the store sends them: the email is kept as soon as it is typed, and the
 * notice under the field lets the shopper say no.
 */
export type CheckoutReminderOption = {
  store: string;
  market: string;
  optedOut: boolean;
  labels: { notice: string; optOut: string; optedOut: string; undo: string };
};

/**
 * Marketing email (D295): an unticked box with the words the shopper agrees to. Ticked, the pay press asks for consent for the address typed
 * (by its emailed link, or at once for a signed-in customer with a verified email); it never holds up the payment.
 */
export type CheckoutNewsOption = {
  store: string;
  market: string;
  labels: { consent: string };
};

/**
 * Marketing texts (D565): an unticked box with the words the shopper agrees to, and their mobile number once ticked. Ticked, the pay press
 * keeps the consent on the order, made a subscription once it is paid; it never holds up the payment. Shown only by a store with SMS on.
 */
export type CheckoutSmsOption = {
  store: string;
  market: string;
  labels: { consent: string; phone: string; hint: string };
};

/** Opening an account with the order (D32), offered to shoppers who are not signed in. */
export type CheckoutAccountOption = {
  store: string;
  market: string;
  labels: { create: string; hint: string; password: string; rule: string };
};

/**
 * The terms the store shows at checkout (wave 1, 1e): what the shopper pressed pay under is kept with the order, and in
 * `checkbox` mode the button is held until the box is ticked. The sentence and box are drawn by their own piece
 * (`CheckoutTerms`), which may sit anywhere on the page; they meet here through the in-memory choice.
 */
export type CheckoutTermsOption = {
  store: string;
  market: string;
  display: TermsDisplay;
  labels: { hint: string; failed: string };
};

/**
 * The store's own delivery (D237 2.4 point 4): the pay press first asks the server whether the delivery is settled. It waits for a postal code when the
 * price depends on one, refuses a basket nothing delivers, and, once, a delivery that no longer prices the basket: the order is then placed again and the
 * shopper opens it to see the new price.
 */
export type CheckoutDeliveryCheck = {
  store: string;
  market: string;
  labels: { postal_code: string; changed: string; no_shipping: string; seeNewPrice: string; checkFailed: string };
};

/**
 * Contact details besides the email (D357): a person's name and a phone, each as this order asks them (`contactAsked()`: the store's choice,
 * a local delivery always the phone). Stripe draws neither on our page, so the page asks them, checks them (`cleanContact()`) and keeps them on
 * the order before paying (`saveCheckoutContactAction()`). A local delivery's phone also goes to `confirm({ phoneNumber })`, as its session
 * collects one for the driver (D237). Wallets give their own.
 */
export type CheckoutContactOption = {
  store: string;
  market: string;
  /** The market's country, for a phone typed without its country code. */
  country: string;
  asked: CheckoutContactSettings;
  /** A local delivery: the phone is the driver's, and Stripe's session collects it too. */
  driver: boolean;
  labels: {
    name: string;
    phone: string;
    /** Added to a field's label when it may be left empty. */
    optional: string;
    driverPhone: string;
    driverHint: string;
    nameProblem: string;
    phoneProblem: string;
    saveFailed: string;
  };
};

/** Stripe's form in the store's own look (D337), light or dark: the theme's colours, body font and corners, and the checkout's own choices. */
function appearance(look: CheckoutAppearance, dark: boolean): Appearance {
  return stripeAppearance(look, dark);
}

const noSubscribe = () => () => {};

/**
 * Kaizen's checkout form (decision D22): Stripe's contact, address, express
 * and payment Elements for the order's Checkout Session, on the store's own
 * Stripe account. Card details go from the shopper's browser straight to
 * Stripe. Paying takes the shopper to the order page (the session's return
 * address); a problem is shown here.
 */
export function CheckoutForm({
  publishableKey,
  stripeAccount,
  clientSecret,
  locale,
  ships,
  labels,
  links,
  account = null,
  reminders = null,
  news = null,
  sms = null,
  terms = null,
  termsSlot = null,
  delivery = null,
  contact = null,
  look,
}: {
  /** The store's look for Stripe's form (`checkoutAppearanceFor()`, D337), worked out on the server from its theme. */
  look: CheckoutAppearance;
  publishableKey: string;
  stripeAccount: string;
  clientSecret: string;
  locale: string;
  /** Something to ship: ask for the delivery address (not for downloads only). */
  ships: boolean;
  labels: CheckoutFormLabels;
  /** The cart, and the order page (for a session paid meanwhile). */
  links: { cart: string; order: string };
  account?: CheckoutAccountOption | null;
  reminders?: CheckoutReminderOption | null;
  news?: CheckoutNewsOption | null;
  sms?: CheckoutSmsOption | null;
  terms?: CheckoutTermsOption | null;
  /** The sentence and box for the terms (`CheckoutTerms`), drawn above the pay button; null where the page has its own piece. */
  termsSlot?: ReactNode;
  delivery?: CheckoutDeliveryCheck | null;
  /** A name and a phone besides the email, as the order asks them; Stripe's form on our page asks neither. */
  contact?: CheckoutContactOption | null;
}) {
  // Stripe runs in the browser only; the server sends the waiting state.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  // Stripe's fields in the colours the page shows: the store's, the device's or the visitor's choice (D99).
  const dark = useShowsDark();
  const stripe = useMemo(
    () => (inBrowser ? loadStripe(publishableKey, { stripeAccount, locale: locale as StripeElementLocale }) : null),
    [inBrowser, publishableKey, stripeAccount, locale],
  );
  // The body font from our own stylesheet, by the page's own origin (a font Stripe is given only once, when its form starts).
  const fonts = useMemo(() => (inBrowser ? stripeFonts(look, window.location.origin) : []), [inBrowser, look]);
  if (!stripe) return <Waiting label={labels.loading} />;
  return (
    <CheckoutElementsProvider
      stripe={stripe}
      options={{ clientSecret, elementsOptions: { appearance: appearance(look, dark), fonts, loader: "auto" } }}
    >
      <Form
        labels={labels}
        links={links}
        ships={ships}
        account={account}
        reminders={reminders}
        news={news}
        sms={sms}
        terms={terms}
        termsSlot={termsSlot}
        delivery={delivery}
        contact={contact}
      />
    </CheckoutElementsProvider>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-12 animate-pulse rounded-md bg-surface" />
      <div className="h-40 animate-pulse rounded-md bg-surface" />
      <div className="h-56 animate-pulse rounded-md bg-surface" />
    </div>
  );
}

function Form({
  labels,
  links,
  ships,
  account,
  reminders,
  news,
  sms,
  terms,
  termsSlot,
  delivery,
  contact,
}: {
  labels: CheckoutFormLabels;
  links: { cart: string; order: string };
  ships: boolean;
  account: CheckoutAccountOption | null;
  reminders: CheckoutReminderOption | null;
  news: CheckoutNewsOption | null;
  sms: CheckoutSmsOption | null;
  terms: CheckoutTermsOption | null;
  termsSlot: ReactNode;
  delivery: CheckoutDeliveryCheck | null;
  contact: CheckoutContactOption | null;
}) {
  const state = useCheckoutElements();
  // Where the order placed again after a delivery change waits (D237): the shopper opens it to see the new price.
  const [nextHref, setNextHref] = useState<string | null>(null);
  const ticked = useTicked(terms ? termsKey(terms.store, terms.market) : "");
  const held = payHeld(terms?.display ?? null, ticked);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [express, setExpress] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  // A password saved on an earlier try, to take back if the box is unticked.
  const saved = useRef(false);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [optedOut, setOptedOut] = useState(reminders?.optedOut ?? false);
  const [wantsNews, setWantsNews] = useState(false);
  const [wantsSms, setWantsSms] = useState(false);
  const smsPhone = useRef<HTMLInputElement>(null);
  // A name and a phone besides the email (D357): checked on the pay press, the field that is not right said under it and focused.
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const [contactProblem, setContactProblem] = useState<ContactProblem | null>(null);
  // The last complete email typed, and the pause before keeping it.
  const typedEmail = useRef<string | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onContactChange = (event: { complete: boolean; value: { email: string } }) => {
    typedEmail.current = event.complete ? event.value.email : null;
    if (!reminders) return;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    if (!event.complete || optedOut) return;
    const typed = event.value.email;
    // Kept as soon as the shopper stops typing a valid address.
    captureTimer.current = setTimeout(() => void captureCheckoutEmailAction(reminders.store, reminders.market, typed), 600);
  };

  const toggleReminders = () => {
    if (!reminders) return;
    const next = !optedOut;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    setOptedOut(next);
    void checkoutRemindersAction(reminders.store, reminders.market, next, typedEmail.current);
  };

  if (state.type === "loading") return <Waiting label={labels.loading} />;
  if (state.type === "error") {
    return (
      <p role="alert" className="rounded-md border border-border p-4">
        {labels.unavailable}
      </p>
    );
  }
  const { checkout } = state;
  // Paid in another tab, or Stripe closed the session: nothing to pay here.
  if (checkout.status.type === "complete") {
    return (
      <p role="status">
        <a href={links.order} className="underline">
          {labels.seeOrder}
        </a>
      </p>
    );
  }
  if (checkout.status.type === "expired") {
    return (
      <p role="alert" className="flex flex-col gap-2">
        {labels.expired}{" "}
        <a href={links.cart} className="underline">
          {labels.backToCart}
        </a>
      </p>
    );
  }

  const fail = (message: string) => {
    setProblem(message);
    setBusy(false);
    requestAnimationFrame(() => problemRef.current?.focus());
  };

  /** The account asked for, saved with the order before paying; false if that failed. */
  const saveAccount = async (): Promise<boolean> => {
    if (!account || (!createAccount && !saved.current)) return true;
    const result = await checkoutAccountAction(account.store, account.market, createAccount ? (password.current?.value ?? "") : null);
    if (!result.ok) {
      fail(result.message);
      if (createAccount) password.current?.focus();
      return false;
    }
    saved.current = createAccount;
    return true;
  };

  /**
   * What the shopper pressed pay under, kept with the order before Stripe is asked (wave 1, 1e). In `checkbox` mode a record
   * that fails stops the payment and says so; in `link` mode the payment goes on and the order simply has no record.
   */
  const recordTerms = async (): Promise<boolean> => {
    if (!terms) return true;
    const step = payStep(terms.display);
    if (!step.record) return true;
    let kept = false;
    try {
      kept = (await recordTermsAction(terms.store, terms.market)).ok;
    } catch {
      kept = false;
    }
    if (kept || !step.stopOnFailure) return true;
    fail(terms.labels.failed);
    return false;
  };

  /** The box ticked: consent asked for the address typed (D295). Never stops the payment: a failure only means no email about it. */
  const askForNews = async () => {
    if (!news || !wantsNews) return;
    try {
      await checkoutNewsAction(news.store, news.market, typedEmail.current);
    } catch {
      // The payment goes on; the shopper can subscribe from the store's pages or My account.
    }
  };

  /** The SMS box ticked (D565): the number's consent kept on the order. Never stops the payment. */
  const askForSms = async () => {
    const phone = smsPhone.current?.value.trim() ?? "";
    if (!sms || !wantsSms || !phone) return;
    try {
      await checkoutSmsAction(sms.store, sms.market, phone, typedEmail.current);
    } catch {
      // The payment goes on; the shopper is not texted.
    }
  };

  /** Whether the delivery is settled before anything is kept or paid (D237); a refusal is said and focused. */
  const deliverySettled = async (): Promise<boolean> => {
    if (!delivery) return true;
    let answer: Awaited<ReturnType<typeof deliveryReadyAction>>;
    try {
      answer = await deliveryReadyAction(delivery.store, delivery.market);
    } catch {
      // The check could not be asked: the pay press waits (D237 2.4 point 4 is refused, never let through); the mismatch flag (2.7) is the net for
      // an order paid another way.
      setNextHref(null);
      fail(delivery.labels.checkFailed);
      return false;
    }
    if (answer.ok) return true;
    setNextHref(answer.problem === "changed" ? (answer.next ?? links.cart) : null);
    fail(delivery.labels[answer.problem]);
    return false;
  };

  /** The name and phone as typed and checked, null when none is asked; false (said under the field, which is focused) when one is not right. */
  const contactTyped = (): { name: string | null; phone: string | null } | null | false => {
    if (!contact) return null;
    const checked = cleanContact({ name: nameInput.current?.value, phone: phoneInput.current?.value }, contact.asked, contact.country);
    setContactProblem(checked.ok ? null : checked.problem);
    if (checked.ok) return { name: checked.name, phone: checked.phone };
    requestAnimationFrame(() => (checked.problem === "name" ? nameInput : phoneInput).current?.focus());
    return false;
  };

  /** Keeps what was typed on the order before paying; false when it could not be kept (said, as the other checks are). */
  const saveContact = async (typed: { name: string | null; phone: string | null } | null): Promise<boolean> => {
    if (!contact || !typed || (!typed.name && !typed.phone)) return true;
    try {
      const saved = await saveCheckoutContactAction(contact.store, contact.market, { name: typed.name ?? "", phone: typed.phone ?? "" });
      if (saved.ok) return true;
      if (saved.problem === "name" || saved.problem === "phone") {
        setContactProblem(saved.problem);
        setBusy(false);
        requestAnimationFrame(() => (saved.problem === "name" ? nameInput : phoneInput).current?.focus());
        return false;
      }
    } catch {
      // Said below, as a refusal of the other checks is.
    }
    fail(contact.labels.saveFailed);
    return false;
  };

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    // The button is disabled while the box is unticked; a keyboard submit or a script gets the same answer.
    if (held) {
      setProblem(terms?.labels.hint ?? null);
      return;
    }
    // Before anything is kept or paid: a required name or phone left out, or a phone that is not one, is said under its field.
    const typed = contactTyped();
    if (typed === false) return;
    setBusy(true);
    setProblem(null);
    if (!(await deliverySettled())) return;
    if (!(await saveContact(typed))) return;
    if (!(await saveAccount())) return;
    if (!(await recordTerms())) return;
    await askForNews();
    await askForSms();
    // On success Stripe takes the shopper to the order page. A local delivery's session collects the driver's phone too (D237).
    const result = await checkout.confirm(contact?.driver && typed?.phone ? { phoneNumber: typed.phone } : undefined);
    if (result.type === "error") fail(result.error.message);
  };

  return (
    <form onSubmit={pay} className="flex flex-col gap-8" aria-busy={busy}>
      {/* Apple Pay, Google Pay, Link and the like: shown only when the shopper's device offers one. */}
      <div hidden={!express}>
        <ExpressCheckoutElement
          onReady={(event) => setExpress(Boolean(event.availablePaymentMethods))}
          onConfirm={async (event) => {
            setProblem(null);
            // Apple Pay, Google Pay and Link are held by the same box.
            if (held) {
              event.paymentFailed();
              fail(terms?.labels.hint ?? "");
              return;
            }
            // What was typed above is kept too; a wallet gives its own phone for a local delivery's session.
            const typed = contactTyped();
            if (typed === false || !(await deliverySettled()) || !(await saveContact(typed)) || !(await saveAccount()) || !(await recordTerms())) {
              event.paymentFailed();
              return;
            }
            await askForNews();
            await askForSms();
            const result = await checkout.confirm({ expressCheckoutConfirmEvent: event });
            if (result.type === "error") fail(result.error.message);
          }}
        />
      </div>

      <section aria-labelledby="contact-heading" className="flex flex-col gap-3">
        <h2 id="contact-heading" className="text-lg font-medium">
          {labels.contact}
        </h2>
        <ContactDetailsElement onChange={onContactChange} />
        {contact && contact.asked.name !== "off" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-contact-name`} className="font-medium">
              {contact.labels.name}
              {contact.asked.name === "optional" ? ` ${contact.labels.optional}` : ""}
            </label>
            <input
              ref={nameInput}
              id={`${id}-contact-name`}
              type="text"
              required={contact.asked.name === "required"}
              autoComplete="name"
              maxLength={120}
              aria-invalid={contactProblem === "name" || undefined}
              aria-describedby={contactProblem === "name" ? `${id}-contact-name-problem` : undefined}
              onChange={() => contactProblem === "name" && setContactProblem(null)}
              className="min-h-11 w-full rounded-md border border-border bg-background px-3"
            />
            {contactProblem === "name" && (
              <p id={`${id}-contact-name-problem`} role="alert" className="text-sm text-red-700 dark:text-red-400">
                {contact.labels.nameProblem}
              </p>
            )}
          </div>
        )}
        {contact && contact.asked.phone !== "off" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-contact-phone`} className="font-medium">
              {contact.driver ? contact.labels.driverPhone : contact.labels.phone}
              {contact.asked.phone === "optional" ? ` ${contact.labels.optional}` : ""}
            </label>
            <input
              ref={phoneInput}
              id={`${id}-contact-phone`}
              type="tel"
              required={contact.asked.phone === "required"}
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              aria-invalid={contactProblem === "phone" || undefined}
              aria-describedby={[contact.driver ? `${id}-contact-phone-hint` : "", contactProblem === "phone" ? `${id}-contact-phone-problem` : ""].filter(Boolean).join(" ") || undefined}
              onChange={() => contactProblem === "phone" && setContactProblem(null)}
              className="min-h-11 w-full rounded-md border border-border bg-background px-3"
            />
            {contact.driver && (
              <p id={`${id}-contact-phone-hint`} className="text-sm text-muted">
                {contact.labels.driverHint}
              </p>
            )}
            {contactProblem === "phone" && (
              <p id={`${id}-contact-phone-problem`} role="alert" className="text-sm text-red-700 dark:text-red-400">
                {contact.labels.phoneProblem}
              </p>
            )}
          </div>
        )}
        {reminders && (
          <p aria-live="polite" className="text-sm text-muted">
            {optedOut ? reminders.labels.optedOut : reminders.labels.notice}{" "}
            <button type="button" onClick={toggleReminders} className="underline hover:text-foreground">
              {optedOut ? reminders.labels.undo : reminders.labels.optOut}
            </button>
          </p>
        )}
        {news && (
          <div className="flex items-start gap-3">
            <input
              id={`${id}-news`}
              type="checkbox"
              checked={wantsNews}
              onChange={(event) => setWantsNews(event.target.checked)}
              className="mt-1 size-4"
            />
            <label htmlFor={`${id}-news`}>{news.labels.consent}</label>
          </div>
        )}
        {sms && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <input
                id={`${id}-sms`}
                type="checkbox"
                checked={wantsSms}
                onChange={(event) => setWantsSms(event.target.checked)}
                className="mt-1 size-4"
              />
              <label htmlFor={`${id}-sms`}>{sms.labels.consent}</label>
            </div>
            {wantsSms && (
              <div className="flex flex-col gap-1 pl-7">
                <label htmlFor={`${id}-sms-phone`} className="text-sm font-medium">
                  {sms.labels.phone}
                </label>
                <input
                  id={`${id}-sms-phone`}
                  ref={smsPhone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={32}
                  aria-describedby={`${id}-sms-hint`}
                  className="min-h-11 max-w-xs rounded-md border border-line bg-card px-3"
                />
                <p id={`${id}-sms-hint`} className="text-sm text-muted">
                  {sms.labels.hint}
                </p>
              </div>
            )}
          </div>
        )}
        {account && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <input
                id={`${id}-account`}
                type="checkbox"
                checked={createAccount}
                onChange={(event) => setCreateAccount(event.target.checked)}
                aria-describedby={`${id}-account-hint`}
                className="mt-1 size-4"
              />
              <div>
                <label htmlFor={`${id}-account`}>{account.labels.create}</label>
                <p id={`${id}-account-hint`} className="text-sm text-muted">
                  {account.labels.hint}
                </p>
              </div>
            </div>
            {createAccount && (
              <div className="flex flex-col gap-1">
                <label className="flex flex-col gap-1 font-medium">
                  {account.labels.password}
                  <input
                    ref={password}
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    aria-describedby={`${id}-account-rule`}
                    className="min-h-11 w-full rounded-md border border-border bg-background px-3 font-normal"
                  />
                </label>
                <p id={`${id}-account-rule`} className="text-sm text-muted">
                  {account.labels.rule}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {ships && (
        <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
          <h2 id="delivery-heading" className="text-lg font-medium">
            {labels.delivery}
          </h2>
          <ShippingAddressElement />
        </section>
      )}

      <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
        <h2 id="payment-heading" className="text-lg font-medium">
          {labels.payment}
        </h2>
        <PaymentElement options={{ layout: { type: "accordion", radios: "if_multiple", spacedAccordionItems: false } }} />
        <p className="text-sm text-muted">{labels.secure}</p>
      </section>

      <div className="flex flex-col gap-3">
        {termsSlot}
        <p ref={problemRef} tabIndex={-1} role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
          {problem}
          {problem && nextHref && delivery && (
            <>
              {" "}
              {/* A full page load: the checkout is a pay route, entered afresh (wave 1, 1e). */}
              <a href={nextHref} className="underline">
                {delivery.labels.seeNewPrice}
              </a>
            </>
          )}
        </p>
        {held && terms && (
          <p id={`${id}-held`} className="text-sm text-muted">
            {terms.labels.hint}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || held}
          aria-describedby={held ? `${id}-held` : undefined}
          className="min-h-12 button-primary px-4 font-medium disabled:opacity-40"
        >
          {busy ? labels.paying : labels.pay}
        </button>
      </div>
    </form>
  );
}
