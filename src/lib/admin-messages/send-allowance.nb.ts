import type { SendAllowanceMessages } from "./send-allowance.en";

/** E-postautomatiseringens sendekvote og kontaktgrense (D876), på norsk bokmål, skrevet for hånd. */
export const sendAllowanceNb: SendAllowanceMessages = {
  title: "E-postautomatisering denne måneden",
  usage: "{emails} av {emailsAllowed} e-poster denne måneden, {contacts} av {contactsAllowed} kontakter.",
  noLimit: "ingen grense",
  near: "Du nærmer deg det størrelsen din rommer. Gå opp før et nyhetsbrev må vente.",
  over: "Du har nådd det størrelsen din rommer. Nye nyhetsbrev venter til du går opp; flyter og ordre-e-poster sendes som før.",
  moveUp: "Gå opp til {contacts} kontakter",
  moveUpAny: "Gå opp en størrelse",
  biggest: "Dette er den største størrelsen. Skriv til oss, så finner vi plass.",
  askOwner: "Kontoens eier kan gå opp under Konto, Utvidelser.",
  movedUp: "Gått opp til {contacts} kontakter. Nye nyhetsbrev kan sendes igjen.",
};
