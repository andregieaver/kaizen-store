import type { ConsoleMessages } from "./console.en";

export const consoleNb: ConsoleMessages = {
  houseSite: {
    title: "Kaizena Flows nettsted i sin egen butikk",
    description:
      "Nettstedet flytter inn i Kaizena Flows egen butikk, der det får alt en butikks nettsted har. Kopier det dit for å se det ved siden av det levende nettstedet: det levende nettstedet endres ikke, og en ny kopi henter det siste.",
    never: "Nettstedet er ikke kopiert ennå.",
    last: {
      one: "Sist kopiert {when}: én side, meny eller del.",
      many: "Sist kopiert {when}: {n} sider, menyer og deler.",
    },
    look: "Se det i butikken",
    first: "Kopier nettstedet",
    again: "Kopier det igjen",
    copied:
      "Kopiert: {pages} sider, topptekster og bunntekster, med menyer, deler og utseende.",
    noStore: "Kaizena Flows egen butikk finnes ikke ennå.",
    failed: "Nettstedet kunne ikke kopieres. Ingenting ble endret; prøv igjen.",
  },
  planAnalytics: {
    title: "Abonnementsanalyse",
    description:
      "Hva butikkenes abonnementer gir hver måned, hvordan det har endret seg, og hvor mange av dem som ber om en butikk som ender med å betale.",
    period: "Periode",
    days: "{n} dager",
    live: "Ekte betalinger",
    mrr: "Hver måned",
    mrrSub:
      "Hva løpende abonnementer gir i måneden; et årsabonnement teller som en tolvtedel.",
    paying: "Butikker som betaler",
    late: "{n} på etterskudd med en betaling",
    trialing: "På gratis prøveperiode",
    cancelling: "På vei ut",
    cancellingSub: "Abonnementer som slutter ved periodens slutt.",
    funnelTitle: "Fra forespørsel til betaling, de siste {n} dagene",
    funnelDescription: "Periodens søknader, og hvor langt hver kom.",
    asked: "Ba om en butikk",
    approved: "Godkjent",
    opened: "Åpnet butikken",
    payingStep: "Betaler for et abonnement",
    movesTitle:
      "Hvordan de månedlige inntektene endret seg, de siste {n} dagene",
    movesSince: "Telt siden {date}.",
    movesNone: "Telles fra den første endringen av et abonnement.",
    noMoves: "Ingen abonnementer startet, endret seg eller sluttet i perioden.",
    kinds: {
      started: "Startet",
      upgraded: "Oppgradert",
      downgraded: "Nedgradert",
      cancelled: "Avsluttet",
      paused: "Satt på pause, ubetalt",
      resumed: "Gjenopptatt",
    },
    byPlanTitle: "Per abonnement",
    byPlanDescription:
      "Butikkene på hvert abonnement, betalende eller på prøve, og hva det gir i måneden.",
    noPlans: "Ingen butikker har et abonnement ennå.",
    stores: { one: "{n} butikk", many: "{n} butikker" },
    test: "Testbetalinger",
    testText:
      "Abonnementer betalt med Stripes testkort: ingen ekte penger, holdt utenfor tallene over.",
  },
  team: {
    title: "Team",
    description:
      "Hvem som driver Kaizena Flow. Hver logger inn med totrinnsinnlogging og er også eier av Kaizena Flows egen butikk.",
    members: "Plattformadministratorer",
    membersText:
      "Alle her kan gjøre alt på plattformen. Roller som gir mindre kommer.",
    you: "deg",
    twoStepOn: "Totrinnsinnlogging på",
    twoStepOff:
      "Totrinnsinnlogging ikke satt opp ennå: spørres ved neste innlogging",
    since: "Siden {date}",
    remove: "Fjern",
    addTitle: "Legg til en plattformadministrator",
    addText:
      "Kontoen deres om de har en, ellers en ny: de logger inn i Kaizena Flows administrasjon med denne e-postadressen og setter opp totrinnsinnlogging.",
    email: "E-post",
    name: "Navn (om de ikke har en konto ennå)",
    add: "Legg til",
    added: "{email} er plattformadministrator nå.",
    removed: "{email} er ikke lenger plattformadministrator.",
    signInAgain:
      "Logg inn på nytt først: å legge til en plattformadministrator krever en innlogging de siste minuttene.",
    problems: {
      invalid: "Skriv inn en gyldig e-postadresse.",
      disabled: "Den kontoen er deaktivert.",
      already: "Den personen er allerede plattformadministrator.",
      self: "Du kan ikke fjerne deg selv: be en annen plattformadministrator.",
      last: "Plattformen beholder minst én plattformadministrator.",
      not_found: "Den personen er ikke plattformadministrator.",
    },
  },
};
