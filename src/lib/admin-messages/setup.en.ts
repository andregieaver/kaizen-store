import type { Widen } from "./common.en";

/**
 * The words of a store's setup wizard (D312 A3): its frame, every step's title, intro, lists and buttons, what its actions answer, and the
 * two forms it shares with Settings (business details, countries). The steps' names in the frame are `steps`, by step id (`setup-steps.ts`
 * keeps the English ones for other readers); the answers of "What will you sell?" are `answers`, by answer id (`onboarding.ts` keeps the
 * English). `{name}`, `{count}` and the like are filled in by `fillWords()`/`countWords()`.
 */
export const setupEn = {
  title: "Set up your store",
  ownerOnly: "Only an owner can set up {name}. Ask an owner to finish the setup.",
  frame: {
    steps: "Setup steps",
    stepOf: "Step {n} of {count}",
    stepDone: "Step {n}: done, ",
    stepNumber: "Step {n}: ",
    back: "Back",
    skip: "Skip for now",
  },
  steps: {
    features: "What you sell",
    details: "Your business",
    countries: "Where you sell",
    countriesWebsite: "Your country",
    bookings: "Bookings",
    payments: "Payments",
    products: "Products",
    launch: "Open your store",
  },
  saveAndContinue: "Save and continue",
  continue: "Continue",
  done: "Done: ",
  notDone: "Not done: ",
  features: {
    title: "What will you sell?",
    intro: "Kaizena Flow switches on what your store needs and keeps the rest out of your way. You can change all of it later under Settings, Features.",
    fromStarter: "Your store was made from the demo store {name}, so what it switches on is chosen. Change what you need.",
    answered: "This is what is switched on now.",
    sell: "I will sell",
    extras: "And I want to",
    ifLeftOut: "If you leave out something that is on now:",
    confirm: "Switch off what I left out. Nothing is deleted: switch it on again under Settings, Features.",
    later: "The bonus and referral programs, and everything here, are switched on and off later under Settings, Features.",
    tickToGoOn: "Tick “Switch off what I left out” below to go on, or choose what you need.",
  },
  answers: {
    goods: { label: "Products to ship", words: "Things you send by post or a carrier, or that customers collect." },
    downloads: { label: "Downloads", words: "Files customers buy and download, such as e-books, music or patterns." },
    appointments: { label: "Appointments", words: "Sell time with your staff, such as treatments, consultations or lessons, booked on the product page." },
    stays: { label: "Stays or rentals", words: "Rooms, homes and items booked by the night, day or hour." },
    subscriptions: { label: "Subscriptions", words: "Products bought on a schedule, every week, month or year, with a discount for subscribing." },
    boxes: { label: "Subscription boxes", words: "Customers keep a list of what they want in a box, delivered on your delivery days." },
    website: {
      label: "Just a website, no online shop",
      words: "Pages, a blog, forms and your business details. Nothing is sold; switch the shop on later when you want to.",
    },
    countries: { label: "Sell in several countries", words: "Sell in more countries than your own, each with its own prices, shipping and address." },
    languages: { label: "Several languages", words: "Show the store in more than one language; with an online shop, prices in other currencies too." },
    business: { label: "Sell to businesses", words: "Prices without VAT for businesses, company accounts, VAT numbers at checkout and products for businesses only." },
  },
  details: {
    title: "Your business",
    intro:
      "Shoppers see these details in the footer, the terms of sale and every order confirmation. The law requires them, so fill in the business that sells, not the platform.",
  },
  businessFields: {
    storeName: "Store name",
    storeNameHint: "Shown at the top of every page.",
    legalName: "Legal name of the business",
    organisationNumber: "Organisation number",
    optional: "(optional)",
    contactEmail: "Contact email for shoppers",
    address: "Registered business address",
    country: "Country the business is registered in",
  },
  countries: {
    title: "Where you sell",
    titleWebsite: "Your country",
    intro: "Each country gets its own storefront in its own language and currency. You can change this at any time.",
    introWebsite: "Your website is shown in your country's language. You can change this at any time.",
    priceNote: "A product shows in a country once it has a price there. The demo products have prices for Norway, Sweden and Denmark.",
    severalNote: "To sell in more than one country, switch on Several countries under Settings, Features.",
  },
  countriesForm: {
    several: "Countries you sell to",
    one: "The country you sell in",
  },
  bookings: {
    title: "Bookings",
    intro:
      "Shoppers book times with the staff, and stays and rentals in the rooms and items, you set up here. Each has its own opening hours or calendar.",
    staff: "Staff who take appointments ({count})",
    units: "Rooms and items to book ({count})",
    change: "Change",
    setUp: "Set up",
    timeZone: "Times are shown in the store's time zone ({zone}), which you change under",
    features: "Settings, Features",
  },
  payments: {
    title: "Payments",
    intro: "You can test your whole checkout right away. Real payments need your own Stripe account, which you set up when you are ready to open.",
    testOn:
      "Test payments are on, with nothing to set up: Kaizena Flow creates a test Stripe account for your store. Try your checkout with the card 4242 4242 4242 4242.",
    notYet: "Payments are not available on Kaizena Flow yet. You can continue; your store is ready for them.",
    realTitle: "Real payments (when you are ready)",
    settingsBefore: "Invoices and payment methods are in",
    settingsLink: "payment settings",
  },
  products: {
    title: "Products",
    intro: "Your store starts with demo products so you can see how it looks and works. Keep them while you try things out, or remove them now.",
    none: "Your store has no products.",
    draft: "Draft",
    published: "Published",
    notShown: "Not shown: {feature} is off",
    addOwn: "Add your own product",
    addOwnAfter: "now, or later from Products in the menu.",
    keep: "Keep them for now",
    remove: { one: "Remove the demo product", many: "Remove the {n} demo products" },
  },
  launch: {
    title: "Open your store",
    intro: "Check what is done. Anything you skipped can be finished later from the overview.",
    whatYouSell: "What you sell",
    details: "Business details",
    oneCountry: "At least one country",
    yourCountry: "Your country",
    bookings: "Staff, rooms or items to book",
    checkout: "Checkout switched on",
    demoReplaced: "Demo products replaced",
    products: "Products",
    canWait: " (can wait)",
    finish: "Finish",
    openStore: "Your store is open. Share its address with your first customers.",
    openWebsite: "Your website is open. Share its address with your visitors.",
    viewStore: "View your store",
    overview: "Go to the overview",
    openMyStore: "Open my store",
    openMyWebsite: "Open my website",
    previewStore: "Preview the storefront",
    previewWebsite: "Preview the website",
    notReadyStore: "Add your business details and a country to open the store.",
    notReadyWebsite: "Add your business details and a country to open the website.",
    themeCharge:
      "Opening charges your premium theme {theme}: {price} excl. VAT, once, by Kaizena Flow (by your plan's card, otherwise an invoice due in 14 days). Switch to a free theme on Design settings first if you would rather not.",
  },
  actions: {
    ownerOnly: "Only an owner can set up the store.",
    opened: "Your store is open.",
  },
};

export type SetupMessages = Widen<typeof setupEn>;
