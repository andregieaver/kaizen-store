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
  /** The theme store (D312 P3): its list, a theme's page and the full-screen preview. A client part's words are plain texts with `{name}`. */
  themeStore: {
    title: "Themes",
    description: "Themes for your Kaizena Flow store: preview each on its demo store at computer and phone widths, then start with the one you like.",
    intro:
      "A theme is how your store looks: colours, fonts, buttons, sections and, for some, a header, footer and product page of their own. Switching never changes your words, pictures, products or menus.",
    filters: "Filter themes",
    store: "Store",
    style: "Style",
    includes: "Includes",
    any: "Any",
    clear: "Clear filters",
    none: "No themes yet.",
    noMatch: "No theme matches all of these.",
    count: (n: number, allFree: boolean) => `${n} ${n === 1 ? "theme" : "themes"}${allFree ? ", all free" : ""}`,
    shownOn: (trades: string[]) => {
      const words = trades.map((trade) => trade.toLowerCase());
      if (words.length === 1) return `Shown on ${/^[aeiou]/.test(words[0]) ? "an" : "a"} ${words[0]} store`;
      return `Shown on ${words.slice(0, -1).join(", ")} and ${words.at(-1)} stores`;
    },
    presets: (n: number) => `${n} presets`,
    free: "Free",
    priceLine: (prices: string) => `${prices}, excl. VAT, once per store. Free to try: you pay when your store goes live with it.`,
    kinds: {
      fashion: "Fashion and accessories",
      food: "Food and drink",
      home: "Home and interior",
      beauty: "Health and beauty",
      crafts: "Crafts and art",
      services: "Services and bookings",
      digital: "Digital products",
    },
    styles: { minimal: "Minimal", warm: "Warm", bold: "Bold", classic: "Classic", natural: "Natural", playful: "Playful", artistic: "Artistic" },
    features: {
      dark: "Light and dark",
      switch: "Visitors choose light or dark",
      header: "Its own header",
      footer: "Its own footer",
      productPage: "Its own product page",
      fonts: "Its own fonts",
      sections: "Section styles beyond the core six",
    },
    trades: {
      fashion: "Fashion",
      beauty: "Beauty",
      food: "Food and drink",
      home: "Home",
      electronics: "Electronics",
      services: "Services",
      astronomy: "Astronomy and space",
      ceramics: "Ceramics",
      neon: "Neon signs",
      plants: "Plants",
      sports: "Sports and running",
      consulting: "Consulting",
    },
    sectionStyles: { plain: "Plain", hero: "Hero", feature: "Feature", muted: "Muted", contrast: "Contrast", quote: "Quote" },
    stage: {
      breadcrumb: "Breadcrumb",
      themes: "Themes",
      use: "Use this theme",
      preview: "Preview",
      fullScreen: "{name} full screen",
      addToStore: "Already have a store? Add it to your store",
      onComputer: "{name} on a computer",
      onPhone: "{name} on a phone",
      presets: "Presets",
      sample: "Sample content: your own words, pictures and products take its place.",
    },
    live: {
      heading: "See it live",
      text: "Demo stores wearing {theme}, with their own words, pictures and products.",
      wears: (look: string) => `Wears ${look}`,
    },
    highlights: {
      heading: "Highlights",
      devices: "On a computer and two phones",
      collage: "The page, section by section",
      closeup: "The product page up close",
    },
    pictures: { label: "Pictures", picture: (title: string, n: number) => `${title}, picture ${n}` },
    whatYouGet: { heading: "What you get", text: "Your words, pictures and products stay as they are when you switch." },
    details: {
      heading: "Details",
      about: "About this theme",
      suits: "Suits",
      anyStore: "Any kind of store",
      style: "Style",
      sectionStyles: "Section styles",
      version: "Version",
      changelog: "Changelog",
      versionN: (n: number) => `Version ${n}`,
    },
    meta: {
      themeTitle: (title: string) => `${title} theme`,
      themeDescription: (title: string, free: boolean) => `${title}, a ${free ? "free " : ""}theme for Kaizena Flow stores.`,
      notFound: "Theme not found",
      previewTitle: (title: string) => `${title} theme, full preview`,
    },
    preview: {
      otherThemes: "Other themes",
      previous: "Previous",
      next: "Next",
      theme: (title: string) => ` theme: ${title}`,
      page: "Page",
      home: "Home",
      product: "A product",
      screen: "Screen",
      computer: "Computer",
      phone: "Phone",
    },
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
  accessEmails: {
    received: {
      subject: "We got your request for {store}",
      preview: "We will write to you again when your store is ready.",
      heading: "Thank you, {name}",
      body: "We got your request to open {store} on Kaizena Flow. We read every request, and we write to you again when your store is ready.",
      nothing: "You do not need to do anything now.",
    },
    approved: {
      subject: "{store} is ready on Kaizena Flow",
      preview: "Sign in with this email address to start.",
      heading: "Your store is ready",
      body: "{store} is set up. Sign in with this email address to start. We have also sent you a sign-in link in an email of its own.",
      button: "Sign in",
    },
    declined: {
      subject: "Your request for {store}",
      preview: "About your request to open a store on Kaizena Flow.",
      heading: "About your request",
      body: "Thank you for your interest in Kaizena Flow. We cannot open {store} for you now. You are welcome to ask again later.",
    },
  },
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
