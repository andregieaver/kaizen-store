/**
 * The emails that guide a store's owner from trial to plan (email plan M4.5, D886, `docs/owner-journey.md`): six service emails about
 * their own store, written by hand in English and Norwegian. No offer or promotion in any of them. Pure.
 */

export const JOURNEY_STEPS = ["trial_started", "store_published", "first_order", "trial_ending", "plan_paid", "store_paused"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** Where each step's button goes, under the store's admin. */
export const JOURNEY_PATHS: Record<JourneyStep, string> = {
  trial_started: "",
  store_published: "",
  first_order: "/orders",
  trial_ending: "/billing",
  plan_paid: "/billing",
  store_paused: "/billing",
};

type StepWords = { subject: string; heading: string; text: string[]; button: string };
type Facts = { store: string; date: string | null };

export type JourneyWords = {
  steps: Record<JourneyStep, (f: Facts) => StepWords>;
  why: (store: string) => string;
  turnOff: string;
};

const en: JourneyWords = {
  steps: {
    trial_started: ({ store, date }) => ({
      subject: `Welcome to Kaizena Flow: ${store} is ready to set up`,
      heading: "Your store is ready to set up",
      text: [
        `${store} is yours to try${date ? ` until ${date}` : ""}. Three things make the biggest difference first: add a few products, choose how you get paid, and open the store to shoppers.`,
        "The checklist on your store's home page takes you through each step, one at a time.",
      ],
      button: "Open your store's checklist",
    }),
    store_published: ({ store, date }) => ({
      subject: `${store} is open`,
      heading: "Your store is open to shoppers",
      text: [
        `${store} is live. Share its address with the people you want to reach first: friends, customers you already have, your followers.`,
        date ? `Your trial runs until ${date}. Choose a plan before then to keep the store open.` : "",
      ].filter(Boolean),
      button: "See your store",
    }),
    first_order: ({ store }) => ({
      subject: `${store} has its first order`,
      heading: "Your first order is in",
      text: [`Congratulations: someone bought from ${store}. Open the order to see what to pack, then mark it sent so they get their tracking.`],
      button: "Open the order list",
    }),
    trial_ending: ({ store, date }) => ({
      subject: `Your trial of ${store} ends ${date ?? "soon"}`,
      heading: "Your trial ends soon",
      text: [
        `Your trial ends ${date ?? "in a few days"}. If no plan is chosen by then, ${store} becomes private: shoppers cannot see it, and nothing you made is lost.`,
        "A plan chosen before the trial ends costs nothing until that day.",
      ],
      button: "Choose a plan",
    }),
    plan_paid: ({ store }) => ({
      subject: `Thank you: ${store} is on a plan`,
      heading: "Your plan has started",
      text: [`Thank you. ${store} stays open, and your receipts, your plan and how you pay are all under Billing.`],
      button: "Open billing",
    }),
    store_paused: ({ store }) => ({
      subject: `${store} is now private`,
      heading: "Your store is private for now",
      text: [
        `Your trial has ended with no plan chosen, so ${store} is private: shoppers cannot see it. Everything is kept as it was.`,
        "Choose a plan and the store opens again at once.",
      ],
      button: "Choose a plan",
    }),
  },
  why: (store) => `You get this because you own ${store} on Kaizena Flow. It is about your store, never an offer.`,
  turnOff: "Turn these emails off under Billing",
};

const nb: JourneyWords = {
  steps: {
    trial_started: ({ store, date }) => ({
      subject: `Velkommen til Kaizena Flow: ${store} er klar til å settes opp`,
      heading: "Butikken din er klar til å settes opp",
      text: [
        `Du kan prøve ${store}${date ? ` til ${date}` : ""}. Tre ting betyr mest først: legg inn noen produkter, velg hvordan du får betalt, og åpne butikken for kundene.`,
        "Sjekklisten på butikkens forside tar deg gjennom hvert steg, ett om gangen.",
      ],
      button: "Åpne sjekklisten",
    }),
    store_published: ({ store, date }) => ({
      subject: `${store} er åpen`,
      heading: "Butikken din er åpen for kundene",
      text: [
        `${store} er ute. Del adressen med dem du vil nå først: venner, kunder du allerede har, de som følger deg.`,
        date ? `Prøveperioden varer til ${date}. Velg et abonnement før da for å holde butikken åpen.` : "",
      ].filter(Boolean),
      button: "Se butikken",
    }),
    first_order: ({ store }) => ({
      subject: `${store} har fått sin første bestilling`,
      heading: "Den første bestillingen er her",
      text: [`Gratulerer: noen har handlet hos ${store}. Åpne bestillingen for å se hva som skal pakkes, og merk den som sendt så kunden får sporingen.`],
      button: "Åpne bestillingene",
    }),
    trial_ending: ({ store, date }) => ({
      subject: `Prøveperioden for ${store} slutter ${date ?? "snart"}`,
      heading: "Prøveperioden slutter snart",
      text: [
        `Prøveperioden slutter ${date ?? "om noen dager"}. Er ikke et abonnement valgt innen da, blir ${store} privat: kundene ser den ikke, og ingenting du har laget går tapt.`,
        "Et abonnement som velges før prøveperioden slutter, koster ingenting før den dagen.",
      ],
      button: "Velg et abonnement",
    }),
    plan_paid: ({ store }) => ({
      subject: `Takk: ${store} har et abonnement`,
      heading: "Abonnementet har startet",
      text: [`Takk. ${store} holder åpent, og kvitteringer, abonnementet og hvordan du betaler finner du under Abonnement og faktura.`],
      button: "Åpne abonnement og faktura",
    }),
    store_paused: ({ store }) => ({
      subject: `${store} er nå privat`,
      heading: "Butikken din er privat inntil videre",
      text: [
        `Prøveperioden er over uten at et abonnement er valgt, så ${store} er privat: kundene ser den ikke. Alt er tatt vare på slik det var.`,
        "Velg et abonnement, så åpner butikken igjen med en gang.",
      ],
      button: "Velg et abonnement",
    }),
  },
  why: (store) => `Du får denne fordi du eier ${store} på Kaizena Flow. Den handler om butikken din, aldri et tilbud.`,
  turnOff: "Slå av disse e-postene under Abonnement og faktura",
};

/** The journey's words in the owner's admin language (`nb-NO` or `en`): Norwegian for Norwegian, English otherwise. */
export const journeyWords = (lang: string | null): JourneyWords => (lang?.startsWith("nb") ? nb : en);
