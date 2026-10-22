/**
 * The admin's words every area shares (D312 A0, `docs/platform-admin-i18n.md` 3.3): the account menu, the language choice. English is
 * the type, so a language without a key does not compile. Read on the server with `adminText(lang, "common")` (`src/lib/admin-text.ts`)
 * and in a client part with `useAdminText("common")`; a slice that reaches the browser holds strings only (a choice by number goes through
 * `src/lib/icu-lite.ts`). Legal and financial words come only from the glossary (`src/lib/i18n-glossary.ts`).
 */
import { ORDER_STATUS_LABELS } from "../order-status";

export const commonEn = {
  /** An order's status as the admin's lists show it (D312 A3): `ORDER_STATUS_LABELS`, in each language. */
  orderStatus: { ...ORDER_STATUS_LABELS },
  accountMenu: {
    yourAccount: "Your account",
    contactSupport: "Contact Kaizena Flow support",
    colours: "Colours",
    toDark: "Switch to dark colours",
    toLight: "Switch to light colours",
    language: "Language",
    signOut: "Sign out",
  },
  /** A store feature's name (D178, `STORE_FEATURES`), what it needs in a sentence, and what a page says while it is off (`FeatureOff`, D312 A8). */
  features: {
    labels: {
      shop: "Online shop",
      subscriptions: "Subscriptions",
      boxes: "Subscription boxes",
      appointments: "Appointments",
      bookings: "Stays and rentals",
      gift_cards: "Gift cards",
      countries: "Several countries",
      languages: "Several languages",
      currencies: "Several currencies",
      business: "Sell to businesses",
      bonus: "Bonus program",
      referrals: "Referral program",
      reviews: "Product reviews",
    },
    /** A feature that another needs, in a sentence: "needs the online shop". */
    need: {
      shop: "the online shop",
      subscriptions: "the subscriptions",
      boxes: "the subscription boxes",
      appointments: "the appointments",
      bookings: "the stays and rentals",
      gift_cards: "the gift cards",
      countries: "the several countries",
      languages: "the several languages",
      currencies: "the several currencies",
      business: "the sell to businesses",
      bonus: "the bonus program",
      referrals: "the referral program",
      reviews: "the product reviews",
    },
    or: " or ",
    off: { one: "{label} is switched off", many: "{label} are switched off" },
    /** What a server action says when a stale page asks for something of a feature that is off (`featureOffText()`). */
    offUnder: { one: "{label} is switched off under Settings, Features.", many: "{label} are switched off under Settings, Features." },
    asleep: "{label} needs {need}, which is switched off.",
    hidden: "This page is hidden while the feature is off. Nothing has been deleted: switch it on and everything is as it was.",
    goTo: "Go to Features",
    onlyOwner: "Only an owner can switch features on or off, under Settings → Features.",
    noteOff: "{label} is switched off, so this is hidden.",
    noteSwitch: "Switch it on under Features",
    noteOwner: "An owner can switch it on under Settings, Features",
  },
  /** What forms say on their own (`SubmitButton`, `PasswordField`). */
  form: {
    working: "Working …",
    show: "Show",
    hide: "Hide",
    delete: "Delete",
    deleting: "Deleting …",
  },
  language: {
    title: "Language",
    description: "The language the admin is shown in for you. Your stores' shoppers see the languages chosen for each store.",
    saving: "Saving …",
    kept: "Kept with your account, so the admin is in the same language on every device you sign in on.",
    partly: "Parts of the admin not yet written in your language are shown in English.",
  },
};

export type Widen<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : T extends object ? { [K in keyof T]: Widen<T[K]> } : string;

export type CommonMessages = Widen<typeof commonEn>;
