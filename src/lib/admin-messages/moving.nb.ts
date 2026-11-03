import type { MovingMessages } from "./moving.en";

/** Norwegian (bokmål), written by hand (D312 A7). */
export const movingNb: MovingMessages = {
  title: "Flytt inn",
  intro: "Flytt butikken din fra Shopify. Vi bare leser Shopify-butikken: ingenting endres der, og den selger som før til du flytter.",
  connect: {
    title: "Ta med Shopify-butikken din",
    label: "Adressen til butikken",
    placeholder: "minbutikk.no",
    help: "Alle adressene til butikken virker: den kundene bruker, eller minbutikk.myshopify.com. Shopify ber deg så tillate at Kaizena Flow leser butikken.",
    button: "Koble til Shopify",
    working: "Finner butikken …",
  },
  problems: {
    address: "Det er ikke en butikkadresse. Skriv adressen kundene bruker, for eksempel minbutikk.no.",
    not_shopify: "Vi fant ingen Shopify-butikk på den adressen. Prøv myshopify.com-adressen: den ser du i adressefeltet i Shopify-administrasjonen.",
    unreachable: "Den adressen svarte ikke. Sjekk den og prøv igjen.",
    off: "Tilkobling til Shopify er ikke slått på ennå.",
    forbidden: "Bare eieren av butikken kan koble til en annen butikk.",
  },
  outcome: {
    connected: "Shopify-butikken din er koblet til.",
    declined: "Ingenting ble koblet til: du sa nei på Shopifys side.",
    failed: "Tilkoblingen virket ikke. Trykk Koble til Shopify igjen.",
    off: "Tilkobling til Shopify er ikke slått på ennå.",
  },
  connected: {
    title: "Koblet til {name}",
    shop: "Shopify-butikken {shop}, koblet til {when}.",
    counts: "{products} produkter · {customers} kunder · {orders} ordrer",
    countsAtLeast: "Talt av Shopify; ordrer fra de siste 60 dagene til Shopify tillater å lese alle ordrer.",
    missing: { one: "Shopify tillot ikke {n} ting vi ba om å lese. Koble til igjen og tillat det.", many: "Shopify tillot ikke {n} ting vi ba om å lese. Koble til igjen og tillat dem." },
    next: "Sjekk de gamle lenkene",
    nextHelp: "Vi leser listen over sider som butikken gir Google, viser hvilke gamle lenker som allerede fører et sted her, og fikser resten sammen med deg.",
    nextWorking: "Leser sidene til butikken …",
    copySoon: "Å kopiere alt over med ett trykk kommer neste. Til da tar du med produkter, kunder og tidligere ordrer med Shopifys egne filer:",
    disconnect: "Koble fra",
    disconnectAsk: "Koble fra Shopify-butikken? Ingenting slettes her, og du kan koble til igjen.",
    reconnect: "Koble til igjen",
    cancel: "Avbryt",
  },
  files: {
    products: "Importer produkter",
    customers: "Importer kunder",
    orders: "Importer tidligere ordrer",
    links: "Sjekk de gamle lenkene",
  },
  off: {
    title: "Flytt butikken med Shopifys filer",
    text: "Direkte tilkobling til Shopify er ikke slått på ennå. Eksporter hver fil i Shopify-administrasjonen og importer den her, i denne rekkefølgen:",
  },
  oldShopProblem: "Vi kunne ikke lese sidene til butikken. Åpne Sjekk de gamle lenkene og prøv der.",
};
