/**
 * Kaizena Flow's own site's words (D312 P2, `docs/platform-admin-i18n.md` 3.2): the chrome every page draws, the standard front page,
 * sign-up and its answers, the blog's lists, cookies, not found and unsubscribing. English is the type, so a language without a key does
 * not compile. Read through `platformText(lang)` (`src/lib/platform-text.ts`); a client part gets only its slice as a prop. Legal and
 * financial words come only from the glossary (`src/lib/i18n-glossary.ts`, whose test reads the Norwegian file).
 */
export const platformEn = {
  site: {
    description:
      "Online stores for Norway and the EU: prices, VAT, product safety and consumer rules handled from the start, and pages that load in under half a second.",
    orgNumber: (number: string) => `Org. ${number}`,
  },
  nav: { home: "Home", signUp: "Start your store", signIn: "Sign in", blog: "Blog" },
  home: {
    lead: "Online stores for Norway and the EU: prices, VAT, product safety and consumer rules handled from the start, and pages that load in under half a second.",
    beta: "Kaizena Flow is in a private beta.",
    start: "Start your store",
    demo: "See the demo store",
    signIn: "Sign in",
  },
  signUp: {
    title: "Start your store",
    description: "Kaizena Flow is in a private beta. Ask for a store and we will set one up for you.",
    intro: "Kaizena Flow is in a private beta. Tell us who you are and we will set up your store, ready to try with demo products.",
    name: "Your name",
    email: "Email",
    storeName: "Store name",
    storeNameHint: "You can change it later.",
    themeLegend: "Theme (optional)",
    themeHint:
      "Your store starts with the theme's look and its demo store's products and pages, which you remove in one press when yours are in. Preview opens it in a new window; see them all on the Themes page.",
    sell: "What will you sell?",
    optional: "(optional)",
    website: "Website",
    submit: "Request a store",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
    received: "Thanks! We have your request. When your store is ready you will get an email with a link to sign in.",
    failed: "Your request could not be saved. Please try again.",
    errors: {
      name: "Enter your name.",
      email: "Enter a valid email address.",
      storeName: "Enter a name for your store.",
      message: "Keep the message under 1,000 characters.",
    },
    kaizenLife: {
      // A plain text with `{email}`: the words go to a client component, which cannot take a function.
      noAccount:
        "No Kaizena Flow account uses {email} yet. Ask for a store below. If you already have a store under another email, sign in with that and connect Kaizen Life under Your account.",
      thatEmail: "that email address",
    },
  },
  themeCards: {
    preview: "Preview",
    opensInNewWindow: "(opens in a new window)",
    orPreset: "Or one of its presets",
    moreAbout: "More about it",
    premium: "Premium:",
    premiumNote: (price: string) => `${price} excl. VAT, once. Nothing to pay now: it is charged when your store opens with it.`,
    startsWithDemo: (name: string) => `Starts with the demo store ${name}`,
    startsWithStandard: "Starts with the standard demo products",
  },
  blog: {
    title: "Blog",
    description: "News and guides from Kaizena Flow: selling online across the EU, and how the platform works.",
    categories: "Categories",
    noArticles: "No articles yet.",
    noArticlesHere: "No articles here yet.",
    noPagesHere: "No pages here yet.",
  },
  cookies: {
    title: "Cookies",
    description: "The cookies Kaizena Flow's site uses, who sets them, why and for how long.",
  },
  notFound: { title: "This page does not exist.", home: "Kaizena Flow's front page" },
  unsubscribe: {
    title: "Plan reminders",
    done: "You are unsubscribed. Kaizena Flow will send you no more reminders about plans.",
    unknown: "We could not find this link. It may be too old.",
    ask: "Stop getting reminders from Kaizena Flow about plans you started paying for? You can turn them on again on your Billing page.",
    button: "Unsubscribe",
  },
};

type Widen<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : T extends object ? { [K in keyof T]: Widen<T[K]> } : string;

/** Every language's words have this shape: English's, with any text. */
export type PlatformMessages = Widen<typeof platformEn>;
