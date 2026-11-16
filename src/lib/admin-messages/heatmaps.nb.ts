import type { HeatmapsMessages } from "./heatmaps.en";

/** Eierens ord om varmekart, på bokmål (D656), skrevet for hånd. */
export const heatmapsNb: HeatmapsMessages = {
  title: "Varmekart",
  description: "Se hvor besøkende klikker, hvor langt ned de blar og hva som holder på oppmerksomheten, side for side og for hver versjon av en A/B-test.",
  on: "På",
  off: "Av",
  stateOn: "Måler de besøkende som tillater statistikk.",
  stateOff: "Ingenting måles.",
  whatTitle: "Hva som måles",
  what: [
    "Klikk, på den delen av siden de treffer, og hvilke som ikke gjorde noe (døde klikk) eller kom i raske serier (sinte klikk)",
    "Hvor langt ned på hver side besøkende blar",
    "Hvor lenge hver del av en side er på skjermen mens en besøkende er der",
  ],
  notTitle: "Hva som ikke måles",
  not: [
    "Ingen besøkende identifiseres eller følges: bare hver dags summer lagres",
    "Ingenting fra handlekurven, kassen, kontosidene, skjemaer, chatten eller søkeresultater",
    "Ingen som bruker Global Privacy Control eller Do Not Track, eller som ikke har tillatt statistikk",
  ],
  askAgainTitle: "Besøkende blir spurt på nytt",
  askAgain: "Når varmekart starter, blir de besøkende spurt om informasjonskapsler til statistikk på nytt, og banneret sier at varmekart er en del av dem.",
  keep: "Dagens summer lagres i 13 måneder, og klikk per punkt i 90 dager.",
  turnOn: "Slå på varmekart",
  turnOff: "Slå av varmekart",
  nowOn: "Varmekart er på. Besøkende blir spurt om statistikk på nytt.",
  nowOff: "Varmekart er av. Ingenting mer måles; det som er målt, lagres til tiden er ute.",
  choose: "Velg på eller av.",
};
