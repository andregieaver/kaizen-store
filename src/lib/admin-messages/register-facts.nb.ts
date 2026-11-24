import type { RegisterFactsMessages } from "./register-facts.en";

/** Bokmål for `register-facts.en.ts` (D891). */
export const registerFactsNb: RegisterFactsMessages = {
  title: "Fra Enhetsregisteret",
  business: "Virksomhet",
  legalName: "Juridisk navn",
  orgNumber: "Organisasjonsnummer",
  noBusiness: "Ingen virksomhetsopplysninger ennå.",
  notNorwegian: "Bedriftsopplysninger hentes fra Brønnøysundregistrene, for norske organisasjonsnumre.",
  notLookedUp: "Ikke slått opp ennå: Brønnøysundregistrene svarte ikke. Opplysningene kommer ved neste besøk eller den daglige sjekken.",
  notFound: "Brønnøysundregistrene har ingen enhet med dette nummeret. Sjekk organisasjonsnummeret.",
  soleTrader: "Et enkeltpersonforetak: oppføringen er en persons, så ingen opplysninger om det lagres her.",
  industry: "Bransje",
  employees: "Ansatte",
  founded: "Stiftet",
  place: "Sted",
  website: "Nettsted",
  revenue: "Driftsinntekter {year}",
  operatingResult: "Driftsresultat",
  profit: "Årsresultat",
  equity: "Egenkapital",
  negativeEquity: "Negativ egenkapital: den skylder mer enn den eier.",
  change: "{change} fra året før",
  noAccounts: "Ingen årsregnskap i Regnskapsregisteret.",
  flags: {
    bankrupt: "Konkurs siden {day}",
    winding_up: "Under avvikling siden {day}",
    dissolution: "Under tvangsoppløsning siden {day}",
    deleted: "Slettet fra registeret {day}",
  },
  shortFlags: { bankrupt: "Konkurs", winding_up: "Under avvikling", dissolution: "Under oppløsning", deleted: "Slettet" },
  termsAdvice: "Den kjøper på kreditt. Vurder å slå av kreditten før neste bestilling.",
  source: "Kilde: Brønnøysundregistrene, sjekket {date}.",
  line: {
    revenue: "driftsinntekter {amount} ({year})",
    founded: "stiftet {year}",
  },
};
