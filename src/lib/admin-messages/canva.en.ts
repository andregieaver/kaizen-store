import type { Widen } from "./common.en";

/**
 * The words of a person's own Canva (D898, `docs/design-tools.md` C1 and C2): the media library's Canva card, *Import from Canva*, *Edit
 * in Canva* there and on every picture field, the connect card on Integrations and Account, and what went wrong. Its own area, so pages that draw the media library without
 * Canva (the page builder's picker) do not carry them. `{name}`-style placeholders are filled by `fillWords()`; a count is a `{ one, many }`
 * pair read by `countWords()`.
 */
export const canvaEn = {
  title: "Canva",
  connectLead: "Connect your own Canva to edit pictures there and bring designs into the library.",
  connect: "Connect Canva",
  import: "Import from Canva",
  connectedAs: "Connected as {name}",
  connected: "Your Canva is connected",
  reconnect: "Canva no longer takes the connection. Connect again.",
  where: "Canva keeps your designs in its own data centres, in the US unless your Canva team has its EU data residency. Only the pictures you send go there.",
  pickTitle: "Import from Canva",
  search: "Search your designs",
  searchButton: "Search",
  loading: "Reading your designs…",
  none: "No designs found.",
  more: "Show more",
  pages: { one: "1 page", many: "{n} pages" },
  untitled: "Untitled design",
  importing: "Bringing it in…",
  firstPage: "The first page of a design comes in as a picture.",
  close: "Close",
  edit: "Edit in Canva",
  editLead: "Opens this picture in your Canva. Press Return in Canva to bring the edited copy back; this picture stays as it is.",
  opening: "Opening Canva…",
  again: "Bring back from Canva again",
  againLead: "Brings the latest version of your Canva design in as a new picture.",
  returning: "Bringing your design back from Canva…",
  returned: "Your design is back in the library.",
  open: "Open it",
  disconnect: "Disconnect",
  // A picture field's *Edit in Canva* (C2): Canva opens in a tab of its own and the field waits for it.
  field: {
    waiting: "Finish in the Canva tab and press Return there. The edited picture then takes this one's place.",
    stop: "Stop waiting",
    bringing: "Bringing it back from Canva…",
    done: "The edited picture from Canva is in.",
    blocked: "The browser did not open a new tab. Allow pop-ups for Kaizena Flow and try again.",
    connectLead: "Connects your own Canva in a new tab; come back here when it is done.",
    drawn: "Use the original picture",
  },
  // The tab Canva's Return lands in (C2), which hands the picture to the field and closes.
  back: {
    title: "Back from Canva",
    edit: "You can close this tab. Your picture is in the tab you started from.",
    connected: "Your Canva is connected. You can close this tab and press Edit in Canva again.",
  },
  outcome: { connected: "Your Canva is connected.", declined: "Canva was not connected.", failed: "Canva could not be connected. Try again." },
  problems: {
    off: "Canva is not set up on Kaizena Flow yet.",
    not_connected: "Connect your Canva first.",
    reconnect: "Canva no longer takes the connection. Connect again.",
    gone: "That design or picture is no longer there.",
    unreadable: "The file could not be read.",
    unreachable: "Canva did not answer. Try again in a moment.",
    slow: "Canva is taking a long time. Try again in a moment.",
    license: "The design uses paid Canva elements. Remove them or buy them in Canva, then try again.",
    busy: "Canva asks us to wait. Try again in a minute.",
    storage: "There is no room for more files.",
    canva: "Canva said: {detail}",
    failed: "Something went wrong. Try again.",
  },
};

export type CanvaMessages = Widen<typeof canvaEn>;
