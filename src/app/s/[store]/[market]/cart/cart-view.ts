import "server-only";

import { choicesFor } from "@/lib/customer-addresses";
import { listAddresses } from "@/server/customer-addresses";
import { quotableLine } from "@/lib/quotes";
import { quotePrefill, quotesOfferedHere } from "@/server/quote-requests";
import { stripeLocale } from "@/lib/checkout";
import { expressFits } from "@/lib/express-checkout";
import { expressAreaFor, klarnaMessaging } from "@/server/express-checkout";
import { companyRequired, withoutVat } from "@/lib/b2b";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { vatText } from "@/lib/vat-text";
import { getBuyer } from "@/server/b2b";
import { getCart, getCartGift, readCartId } from "@/server/cart";
import { checkoutQuestionsFor } from "@/server/checkout-rules";
import { perRequest } from "@/server/request-memo";
import { cartSummary } from "@/server/cart-summary";
import { getCustomer } from "@/server/customers";
import { buyerFacts } from "@/server/company-locations";
import { termsForBasket } from "@/server/payment-terms";
import { termsDisplayFor } from "@/server/checkout-terms";
import { termsTemplate } from "@/lib/checkout-terms";
import { dayWords, TERMS_DAYS } from "@/lib/payment-terms";
import { featureOn } from "@/lib/store-features";
import { accountsMode, signInRequired } from "@/lib/customer-accounts";
import type { Store } from "@/server/stores";
import { readCartBonus } from "./bonus";

export type CartView = Awaited<ReturnType<typeof loadCartView>>;
export type Filled = Extract<CartView, { empty: false }>;

/** The cart and everything its pieces show of it, read once for a request whichever pieces a page holds (D117). */
export function cartView(store: Store, market: Market, m: Messages) {
  return perRequest(`cart:${store.id}:${market.slug}`, () => loadCartView(store, market, m));
}

async function loadCartView(store: Store, market: Market, m: Messages) {
  const [cart, buyer] = await Promise.all([getCart({ storeId: store.id, market }), getBuyer(store)]);
  const home = marketPath(store.slug, market.slug);
  if (cart.lines.length === 0) return { empty: true as const, home };

  const [summary, bonus, gift] = await Promise.all([
    cartSummary({ storeId: store.id, market }, cart),
    readCartBonus(store, market),
    // The gift box (wave 3, D173): whether the store offers gift messages, and what the cart holds of one.
    getCartGift({ storeId: store.id, market }),
  ]);
  const { plan, checkout, renewal } = summary;
  // The VAT wording (D157): hand-written, so apart from the interface texts the AI translates.
  const vatWords = vatText(market.lang);
  const every = plan ? m.planEvery(plan.interval, plan.intervalCount) : "";
  // Businesses see amounts without VAT, and the VAT on its own line (B2B); they pay the total with it.
  const business = buyer === "business";
  const money = (minor: number) => formatMoney(minor, cart.currency, market.locale, market.priceStyle);
  // Each line at its product's VAT rate, shipping at the standard one, as checkout works it out (D65).
  const net = (minor: number, rate = checkout.vatRate) => money(business ? withoutVat(minor, rate) : minor);
  const sumNet = (parts: { minor: number; rate: number }[]) =>
    money(parts.reduce((sum, part) => sum + (business ? withoutVat(part.minor, part.rate) : part.minor), 0));
  // A signed-in customer's saved company and details fill the fields in. A company's account may also buy on its payment terms (D293).
  const businessOn = featureOn(store, "business");
  // Who pays is asked here when no payment page follows: a booking paid at the venue, Mollie's page, or gift cards that pay it all (D300 F3).
  const asksPayer = summary.atVenueOnly || checkout.provider === "mollie" || summary.giftCards.coverAll;
  const mustSignIn = accountsMode(store) === "required";
  const customer = (business && !cart.company) || asksPayer || businessOn || mustSignIn ? await getCustomer(store.id) : null;
  const saved = (business && !cart.company) || asksPayer ? customer : null;
  // Goods bought once only: no booking, subscription, venue part or host's listing (`placeOrder()` checks the same under the company's lock).
  const goodsOnly = summary.balance === 0 && cart.lines.every((line) => !line.plan && !line.booking && !line.hostId && !line.payment);
  const termsOffer =
    businessOn && customer && !summary.blocked
      ? await termsForBasket(store.id, customer.id, { goodsOnly, totalMinor: summary.total, currency: cart.currency })
      : null;
  // No payment page follows an order on terms: the store's terms of sale (D158) are shown here instead, as the checkout shows them.
  const termsDisplay = termsOffer?.ok || summary.giftCards.coverAll || summary.atVenueOnly ? await termsDisplayFor(store, market) : null;
  // Gift cards that pay it all (D300 F3): no payment page follows either, so the terms of sale are shown with the button here.
  // A booking paid wholly at the venue (D66, D379): no payment page follows, so the terms are shown here too and the button confirms the booking.
  const cardsPayAll =
    summary.giftCards.coverAll || summary.atVenueOnly
      ? {
          display: termsDisplay,
          template: termsDisplay ? termsTemplate(m.terms, termsDisplay) : "",
          newTab: m.terms.newTab,
          place: summary.atVenueOnly ? m.booking.confirmBooking : m.giftCardPay.place,
        }
      : null;
  const onTerms =
    termsOffer?.ok && customer
      ? {
          note: m.paymentTerms.choiceNote(termsOffer.companyName ?? "", TERMS_DAYS[termsOffer.terms], dayWords(termsOffer.dueOn, market.locale)),
          customer,
          display: termsDisplay,
          template: termsDisplay ? termsTemplate(m.terms, termsDisplay) : "",
        }
      : null;
  // A company member's purchase (D321 C.2): the location and PO number, and whether an order over the company's limit will wait for an approver.
  const companyFacts = businessOn && customer ? await buyerFacts(store.id, customer.id) : null;
  const chosenPlace = companyFacts
    ? companyFacts.places.length === 1
      ? companyFacts.places[0]
      : (companyFacts.places.find((p) => p.id === cart.companyPurchase.locationId) ?? null)
    : null;
  const companyBuy = companyFacts
    ? {
        facts: companyFacts,
        chosen: chosenPlace?.id ?? null,
        poNumber: cart.companyPurchase.poNumber,
        limitText: companyFacts.limit && chosenPlace?.role === "orderer" ? formatMoney(companyFacts.limit.minor, companyFacts.limit.currency, market.locale, market.priceStyle) : null,
      }
    : null;
  // The store's own questions at checkout (D357), with what the cart holds of the answers.
  const questions = await checkoutQuestionsFor(store.id, market.locale, await readCartId({ storeId: store.id, market }));
  // A signed-in customer's saved addresses in the market's country (D304), offered where this page asks the address itself.
  const addressChoices = customer && (asksPayer || onTerms) ? choicesFor(await listAddresses(store.id, customer.id), market.code) : [];
  const companyNeeded = companyRequired(
    store.audience,
    cart.lines.map((line) => line.audience),
  );
  const company = cart.company ?? {
    name: saved?.companyName ?? "",
    number: saved?.organisationNumber ?? "",
  };
  // Express checkout (D373): a basket of goods sent by post, nothing to ask first (a company, questions, terms or cards that pay it all).
  const expressable =
    expressFits(cart.lines) && !summary.blocked && !summary.giftCards.coverAll && !termsOffer?.ok && !companyNeeded && !business && questions.fields.length === 0;
  const [express, klarna] = await Promise.all([
    expressable ? expressAreaFor(store, market, m) : null,
    expressable ? klarnaMessaging(store, market) : null,
  ]);
  // The subscription's terms, said the same way in the summary and the consent (D29).
  const terms = plan
    ? [
        m.renewsEvery(every, money(renewal ?? 0)),
        plan.trialDays > 0 && m.trialNote(plan.trialDays),
        plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  return {
    empty: false as const,
    home,
    cart,
    summary,
    bonus,
    gift,
    every,
    business,
    money,
    net,
    sumNet,
    saved,
    // A store that requires accounts (D365) asks the shopper to sign in before the checkout button.
    mustSignInFirst: signInRequired(store, Boolean(customer)),
    addressChoices,
    companyNeeded,
    company,
    terms,
    vatWords,
    onTerms,
    cardsPayAll,
    companyBuy,
    questions,
    express,
    klarna: klarna ? { ...klarna, currency: market.currency, country: market.code, locale: stripeLocale(market.lang) } : null,
    quote: await cartQuote(store, cart),
  };
}

/**
 * Request a quote for the cart (D431): where the store offers quotes to this shopper, and every line is goods sent by post and bought once (a
 * draft sells only those, D173). The server reads the lines from the cart itself; these are only what the form lists.
 */
async function cartQuote(store: Store, cart: Awaited<ReturnType<typeof getCart>>) {
  if (cart.lines.length === 0 || !cart.lines.every(quotableLine) || !(await quotesOfferedHere(store))) return null;
  return { lines: cart.lines.map((line) => ({ title: line.title, quantity: line.quantity })), prefill: await quotePrefill(store.id) };
}
