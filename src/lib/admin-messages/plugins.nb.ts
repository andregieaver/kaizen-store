import type { PluginsMessages } from "./plugins.en";

/** Norwegian (bokmål), written by hand (D898 F1). */
export const pluginsNb: PluginsMessages = {
  title: "Koble til Figma",
  lead: "Kaizena Flow-tillegget i Figma ber om å sende design til en av butikkene dine, som sideutkast og bilder i biblioteket.",
  check: "Figma skal vise denne koden:",
  store: "Butikk",
  connect: "Koble til Figma",
  decline: "Ikke koble til",
  warn: "Koble til bare hvis du nettopp trykket Logg inn i Kaizena Flow-tillegget. Tillegget kan da lagre sideutkast og legge bilder i butikkens bibliotek; det publiserer ingenting selv.",
  where: "Det står under Utvikler, API-nøkler som Figma plugin, der du kan trekke det tilbake.",
  connected: "Figma er koblet til {store}. Gå tilbake til Figma: tillegget er klart.",
  declined: "Figma ble ikke koblet til. Du kan lukke denne fanen.",
  noStores: "Bare eieren av en butikk kan koble til Figma, og du eier ingen butikk.",
  problems: {
    owner: "Bare butikkens eier kan koble til Figma.",
    limit: "Butikken har så mange API-nøkler som den kan ha. Trekk tilbake en under Utvikler, API-nøkler, og prøv igjen.",
    off: "Tilkobling av Figma er ikke satt opp på Kaizena Flow ennå.",
    gone: "Denne innloggingen er utløpt eller allerede besvart. Trykk Logg inn i tillegget igjen.",
  },
};
