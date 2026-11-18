import type { HouseAutopilotMessages } from "./house-autopilot.en";

/** Kaizena Flows eget nettsted i autopiloten (E5.3, D757), på norsk bokmål, skrevet for hånd. */
export const houseAutopilotNb: HouseAutopilotMessages = {
  signups: {
    title: "Flere registreringer hos Kaizena Flow",
    now: "Nå ender {percent} av besøkene på nettstedet med en registrering, de siste 30 dagene.",
    notCounted: {
      not_house: "Bare Kaizena Flows egen butikk teller registreringer.",
      not_counting: "Ikke telt ennå: Kaizena Flows butikk teller ikke besøk. Slå det på under butikkens Innstillinger → Analyse.",
      no_visits: "Ikke telt ennå: ingen besøk på nettstedet ble telt de siste 30 dagene.",
    },
    aim: "Sikt mot denne andelen besøk som registrerer seg (%)",
    help: "Autopiloten planlegger mot målet, og tester endringene sine på nettstedets sider på registreringer der nok folk besøker dem.",
    set: "Sett dette målet",
    setNow: "Målet er satt.",
    invalid: "Oppgi en andel av besøkene mellom 0,1 og 100 %.",
    goalTitle: "Flere registreringer hos Kaizena Flow",
  },
  siteTests: {
    title: "Test sideendringene mine først når det er nok trafikk",
    help: "Kaizena Flows nettsted vises fra Kaizena Flows egen butikk, og autopiloten der tester endringene sine på nettstedets sider på registreringer, aldri på bestillinger, og først når sidenes hastighet også er fulgt med på. Bryteren ligger i den butikkens autopilot.",
    open: "Åpne innstillingene der",
  },
};
