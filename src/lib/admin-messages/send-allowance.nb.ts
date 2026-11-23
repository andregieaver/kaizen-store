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
  /** Use beyond the allowances and its cap (D880), on Account, Billing. */
  extras: {
    title: "Bruk utover det som er inkludert",
    lead: "Faktureres etter bruk, som linjer på neste faktura.",
    aiLine: "Kundeservice: {used} samtaler besvart av AI denne perioden, {included} inkludert",
    peopleLine: "{name}: {used} personer, {included} inkludert",
    near: "nær det som er inkludert",
    beyond: "{n} utover × {price} = {amount}",
    total: "Så langt denne perioden: {amount} utover det som er inkludert.",
    capped: "Taket ditt på {cap} stopper det der, og AI-en gir nye samtaler til folk.",
    capTitle: "Månedlig tak",
    capHint: "Det meste du betaler i måneden utover det som er inkludert. Ved taket gir kundeservicens AI nye samtaler til folk. La feltet stå tomt for ingen grense.",
    capLabel: "Tak i {currency}",
    save: "Lagre taket",
    saved: "Lagret.",
    badCap: "Skriv et beløp på 0 eller mer, eller la feltet stå tomt for ingen grense.",
  },
  /** The platform admin's prices beyond the allowances (D880), on Platform, Plans, Extensions. */
  extraPrices: {
    title: "Utover det som er inkludert",
    hint: "Hva én enhet utover en utvidelses kvote koster, uten mva.: faktureres som linjer på hver kontos neste faktura. Tomt faktureres aldri.",
    aiUnit: "{name}, per samtale besvart av AI, {currency}",
    personUnit: "{name}, per person, {currency}",
    save: "Lagre prisene",
    saved: "Lagret.",
    bad: "Hver pris er et beløp på 0 eller mer, eller tom.",
  },
};
