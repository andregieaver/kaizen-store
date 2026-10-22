import type { PlatformMessages } from "./platform-en";

/**
 * Kaizena Flows eget nettsted på norsk bokmål (D312 P2), skrevet for hånd. Juridiske og økonomiske ord er ordlistens
 * (`src/lib/i18n-glossary.ts`): merverdiavgift og «ekskl. mva.», nettbutikk, informasjonskapsler.
 */
export const platformNb: PlatformMessages = {
  site: {
    description:
      "Nettbutikker for Norge og EU: priser, merverdiavgift, produktsikkerhet og forbrukerregler på plass fra starten, og sider som lastes på under et halvt sekund.",
    orgNumber: (number) => `Org.nr. ${number}`,
  },
  nav: { home: "Hjem", signUp: "Start nettbutikken din", signIn: "Logg inn", blog: "Blogg" },
  home: {
    lead: "Nettbutikker for Norge og EU: priser, merverdiavgift, produktsikkerhet og forbrukerregler på plass fra starten, og sider som lastes på under et halvt sekund.",
    beta: "Kaizena Flow er i en lukket beta.",
    start: "Start nettbutikken din",
    demo: "Se demobutikken",
    signIn: "Logg inn",
  },
  signUp: {
    title: "Start nettbutikken din",
    description: "Kaizena Flow er i en lukket beta. Be om en nettbutikk, så setter vi den opp for deg.",
    intro: "Kaizena Flow er i en lukket beta. Fortell oss hvem du er, så setter vi opp nettbutikken din, klar til å prøves med demoprodukter.",
    name: "Navnet ditt",
    email: "E-post",
    storeName: "Navn på nettbutikken",
    storeNameHint: "Du kan endre det senere.",
    themeLegend: "Tema (valgfritt)",
    themeHint:
      "Nettbutikken starter med temaets utseende og demobutikkens produkter og sider, som du fjerner med ett trykk når dine egne er på plass. Forhåndsvisningen åpnes i et nytt vindu; se alle temaene på Temaer-siden.",
    sell: "Hva skal du selge?",
    optional: "(valgfritt)",
    website: "Nettsted",
    submit: "Be om en nettbutikk",
    haveAccount: "Har du allerede en konto?",
    signIn: "Logg inn",
    received: "Takk! Vi har fått forespørselen din. Når nettbutikken er klar, får du en e-post med en lenke for å logge inn.",
    failed: "Forespørselen kunne ikke lagres. Prøv igjen.",
    errors: {
      name: "Skriv inn navnet ditt.",
      email: "Skriv inn en gyldig e-postadresse.",
      storeName: "Skriv inn et navn på nettbutikken.",
      message: "Meldingen kan ikke være lengre enn 1000 tegn.",
    },
    kaizenLife: {
      // A plain text with `{email}`: the words go to a client component, which cannot take a function.
      noAccount:
        "Ingen Kaizena Flow-konto bruker {email} ennå. Be om en nettbutikk nedenfor. Har du allerede en nettbutikk med en annen e-postadresse, logger du inn med den og kobler til Kaizen Life under Kontoen din.",
      thatEmail: "den e-postadressen",
    },
  },
  themeCards: {
    preview: "Forhåndsvis",
    opensInNewWindow: "(åpnes i et nytt vindu)",
    orPreset: "Eller en av stilene",
    moreAbout: "Mer om det",
    premium: "Premium:",
    premiumNote: (price) => `${price} ekskl. mva., én gang. Ingenting å betale nå: det belastes når nettbutikken åpner med temaet.`,
    startsWithDemo: (name) => `Starter med demobutikken ${name}`,
    startsWithStandard: "Starter med standard demoprodukter",
  },
  blog: {
    title: "Blogg",
    description: "Nyheter og veiledninger fra Kaizena Flow: om å selge på nett i hele EU, og om hvordan plattformen fungerer.",
    categories: "Kategorier",
    noArticles: "Ingen artikler ennå.",
    noArticlesHere: "Ingen artikler her ennå.",
    noPagesHere: "Ingen sider her ennå.",
  },
  cookies: {
    title: "Informasjonskapsler",
    description: "Informasjonskapslene Kaizena Flows nettsted bruker, hvem som setter dem, hvorfor og hvor lenge.",
  },
  notFound: { title: "Denne siden finnes ikke.", home: "Forsiden til Kaizena Flow" },
  unsubscribe: {
    title: "Påminnelser om abonnement",
    done: "Du er meldt av. Kaizena Flow sender deg ikke flere påminnelser om abonnementer.",
    unknown: "Vi fant ikke denne lenken. Den kan være for gammel.",
    ask: "Vil du slutte å få påminnelser fra Kaizena Flow om abonnementer du har begynt å betale for? Du kan slå dem på igjen på siden Fakturering.",
    button: "Meld av",
  },
};
