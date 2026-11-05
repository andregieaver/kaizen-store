import type { SandboxMessages } from "./sandbox.en";

/** Sandkassen for sidebyggeren (D457), på norsk bokmål, skrevet for hånd. */
export const sandboxNb: SandboxMessages = {
  start: {
    title: "Prøv sidebyggeren",
    lead: "Bygg sider i den ekte sidebyggeren, i en egen butikk. Ingen registrering og ingenting å installere.",
    private: "Bare du kan se butikken. Den blir liggende i 7 dager etter siste besøk, og deretter slettes den.",
    button: "Begynn å bygge",
    back: "Tilbake til butikken din",
    off: "Sandkassen er stengt akkurat nå. Prøv igjen senere.",
    busy: "Mange sandkasser ble startet fra nettverket ditt nettopp. Prøv igjen om en time.",
    full: "Sandkassen er full for i dag. Prøv igjen i morgen.",
    failed: "Butikken din kunne ikke lages. Prøv igjen.",
  },
  bar: {
    label: "Sandkasse",
    home: "Butikken din",
    privateNote: "Bare du kan se denne butikken.",
    daysLeft: { one: "{n} dag igjen", many: "{n} dager igjen" },
    lastDay: "Siste dag",
    startOver: "Begynn på nytt",
    startOverConfirm: "Begynne på nytt med en ny butikk? Denne stenges, og det du har laget her, forsvinner.",
  },
  home: {
    title: "Butikken din",
    lead: "Endre hva du vil: ordene, bildene, utseendet. Trykk Publiser for å se en side slik butikken din ville vist den.",
    editFront: "Rediger forsiden",
    pages: "Sider",
    headers: "Topptekster",
    footers: "Bunntekster",
    newPage: "Ny side",
    newHeader: "Ny topptekst",
    newFooter: "Ny bunntekst",
    edit: "Rediger",
    preview: "Forhåndsvis",
    front: "Forside",
    draft: "Utkast",
    none: "Ingen ennå.",
    untitled: "Uten tittel",
  },
  ended: {
    title: "Denne sandkassen er avsluttet",
    lead: "En sandkasse varer i 7 dager etter siste besøk og åpnes bare i nettleseren som startet den. Start en ny for å prøve igjen.",
    startAgain: "Start en ny",
  },
  templatePreview: {
    notice: "Forhåndsvisning: ingenting lagres eller kopieres",
    by: "Av {publisher}",
  },
  refused: {
    gone: "Denne sandkassen er avsluttet. Start en ny for å fortsette.",
    notHere: "Det er ikke en del av sandkassen.",
  },
};
