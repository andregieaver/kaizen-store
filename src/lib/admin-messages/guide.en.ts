/**
 * Guide's words (D909, `src/lib/guide.ts`), in English: the welcome's steps, each section's line, a beacon's card, the panel and the
 * hints inside empty pages. `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`): each
 * level's layout hands them to `GuideProvider` as a prop.
 */
export const guideEn = {
  name: "Guide",
  /** The rail's and the phone menu's button: its name and how far the person is. */
  button: { label: "Guide", progress: "{found} of {total} found" },
  /** The welcome on a level's Home: a step for each place, in order. */
  welcome: {
    eyebrow: "Welcome · {n} of {total}",
    rail: {
      label: "The rail",
      what: "Every section, at the left",
      title: "This is the rail: every part of your store",
      body: "Each tile is a section. Start each day at Home; Settings waits at the foot.",
      can: ["Orders, Products and Customers for the daily work", "Marketing, Website and Analytics when you are ready to grow", "Basic shows the pages most stores use; Advanced shows all of them"],
    },
    todo: {
      label: "Your next step",
      what: "Home: what to do next",
      title: "Your next step, always on Home",
      body: "Home says what matters most right now, and changes as you go. Nothing to tick off by hand.",
      can: ["Add a product: a name, a photo and a price are enough", "Choose how you get paid, then how you ship", "When something waits for you, it is said here first"],
    },
    ai: {
      label: "AI manager",
      what: "Ask for anything in plain words",
      title: "Ask the AI manager instead of searching",
      body: "Say what you want done in plain words. It does it, or shows you where it is.",
      can: ["“Add a 15% summer discount on mugs”", "“Write descriptions for my new products”", "You see every change before it is made"],
    },
  },
  /** The platform's welcome says the same of Kaizena Flow's own admin. */
  welcomePlatform: {
    railTitle: "This is the rail: every part of the platform",
    railBody: "Each tile is a section of Kaizena Flow's own admin. Start at Home; Settings waits at the foot.",
    railCan: ["Stores, Customers and Requests for the daily work", "Website and Plans for Kaizena Flow's own site and prices", "Basic shows the pages most of the team uses; Advanced shows all of them"],
  },
  /** Each section's line in the panel and on its beacon's card, by the section's key; a section without one shows the menu's intro. */
  places: {
    orders: "Pack, label and send each order; returns arrive here too.",
    products: "What you sell, with prices, stock and pictures.",
    customers: "Who bought, and what they asked for.",
    marketing: "Discounts, emails and ads to bring people in, and back.",
    analytics: "What sells, and where visitors come from.",
    website: "Your store as shoppers see it: pages, look and menus.",
    bookings: "Appointments, stays and rentals in one calendar.",
    support: "Conversations with your customers, in one inbox.",
    projects: "The team's projects and checklists.",
    settings: "How the store is set up: payments, shipping, tax and team.",
    stores: "Every store on Kaizena Flow, and how each is doing.",
    themes: "The themes owners choose from.",
    plans: "Kaizena Flow's plans and what they cost.",
    requests: "People asking for a store, waiting for a yes.",
  } as Partial<Record<string, string>>,
  /** A beacon's dot and its card. */
  beacon: {
    label: "Guide has a tip about {place}",
    eyebrow: "New here · {place}",
    title: "This is {place}",
    also: "Also in {place}",
    gotIt: "Got it",
    notNow: "Not now",
  },
  /** The spotlight's card. */
  spotlight: { next: "Next", done: "Done", later: "Later", close: "Close the welcome", here: "Here you can" },
  /** The short note after the welcome. */
  toast: {
    doneTitle: "That is all for today",
    doneBody: "Guide points out the next place when you get there. Everything else is under Guide, at the foot of the rail.",
    laterTitle: "Saved for later",
    laterBody: "The rest of the welcome waits under Guide. It does not open by itself again.",
    open: "Open Guide",
    close: "Close",
  },
  /** The panel. */
  panel: {
    title: "Guide",
    close: "Close Guide",
    found: "You have found {found} of {total} places",
    day: "Day {n}",
    allFound: "You have found every place. Guide stays here for when you want it.",
    nextUp: "Next up",
    showMe: "Show me",
    again: "Again",
    places: "Places in your admin",
    foundMark: "Found",
    howOften: "How often may Guide speak up?",
    levels: { quiet: "Quiet", balanced: "Balanced", handson: "Hands-on" },
    levelText: {
      quiet: "Only hints inside empty pages. No dots and no spotlights: everything else waits here, in this list.",
      balanced: "Hints in empty pages, a dot on the main sections, and at most one spotlight a day. Never while you type.",
      handson: "A dot on every section you reach and a spotlight whenever there is one. Still never while you type or have unsaved work.",
    },
    automatic: "Chosen for you: Balanced for the first two weeks, then Quiet.",
    customise: "Customise",
    back: "Back to places",
    customiseTitle: "Customise Guide",
    kinds: {
      spotlight: { name: "Spotlights", what: "Dim the page to show one place" },
      beacon: { name: "Dots", what: "A small dot beside something new" },
      hint: { name: "Hints in empty pages", what: "What will appear there, and what to do then" },
    },
    replay: "Replay the welcome",
    restart: "Start Guide over",
    restartConfirm: "Start over? Every place is marked as not found, and the welcome comes back.",
  },
  /** The hints inside empty pages, by place: a line and up to three steps. */
  hints: {
    lead: "Guide",
    orders: {
      line: "This is what you will do with each order.",
      steps: [
        { title: "Pack it", text: "Open the order and print the packing slip with what goes in the box." },
        { title: "Print the label", text: "The carrier you chose under shipping makes the label in one press." },
        { title: "Mark it sent", text: "The customer gets the tracking link. Returns arrive under Returns." },
      ],
    },
    products: {
      line: "Start with one product: a name, a photo and a price are enough to save it.",
      steps: [
        { title: "Add the basics", text: "Name, photo and price. Stock, sizes and other countries can come later." },
        { title: "Or bring them in", text: "Import a spreadsheet, or ask the AI manager to draft them from your photos." },
        { title: "See it in the store", text: "Website shows the product as shoppers will." },
      ],
    },
    customers: {
      line: "Customers appear here by themselves when they buy or make an account.",
      steps: [
        { title: "Each one's history", text: "Open a customer to see their orders, addresses and what they agreed to." },
        { title: "Bring your list", text: "Import the customers you had in your old shop." },
      ],
    },
  },
};

export type GuideMessages = typeof guideEn;
