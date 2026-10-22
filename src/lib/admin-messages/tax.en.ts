import type { Widen } from "./common.en";

/**
 * The words of a store's tax settings (D312 A8, D157): its VAT registration, IOSS and the VAT checks. `{name}`-style placeholders are filled
 * by `fillWords()`; a count is a `{ one, many }` pair read by `countWords()`, with `{n}` the number. The English of `readiness()`, `TAX_WARNINGS`,
 * `OSS_SCHEME_LABELS` and the refusals is the library's own (`src/lib/tax-profile.ts`, `src/server/tax-profile.ts`), held equal by
 * `tax.test.ts`, so the AI manager and the tests keep reading the same English. Every tax term in another language comes from the glossary.
 */
export const taxEn = {
  page: {
    title: "Tax",
    intro:
      "Prices in the store include VAT, and each sale is charged the VAT of the country it goes to. Here the store records its VAT registration and, where it has them, its OSS and IOSS registrations.",
    reverseCharge:
      "A business in another EU country that gives a valid VAT number can buy goods without VAT (reverse charge) once the store's own number has been checked. ",
    notAdvice: "This is not tax advice.",
  },
  form: {
    saved: "Saved.",
    vatTitle: "VAT registration",
    registered: "The store is registered for VAT",
    registeredHint: "Switch this on when the business has a VAT number. It is shown on the store's documents.",
    vatNumber: "VAT number",
    vatNumberNo: "(nine digits and MVA)",
    vatNumberStarts: "(starts with {prefix})",
    vatNumberAny: "(with the country code)",
    vatNumberHint:
      "Must be a number of {country}. Saving a different number clears its check: use Check now below to check it again. Reverse charge stays off until the number has been checked valid.",
    ownCountry: "the store's own country",
    dispatch: "Goods are sent from",
    dispatchShape: "(two letters, such as NO or CN)",
    dispatchHint: "Leave empty to use {country}. IOSS applies only to goods sent from outside the EU.",
    storeCountry: "the store's country",
    ossTitle: "One Stop Shop (OSS)",
    ossIntro:
      "Record the registration here. Kaizena Flow charges the VAT of the buyer's country on every consumer sale, as OSS requires. The returns are not made here.",
    scheme: "Scheme",
    memberState: "Member state of registration",
    choose: "Choose …",
    ossNumber: "Non-Union OSS number",
    ossNumberShape: "(EU and nine digits)",
    registeredOn: "Registered on",
    dateShape: "(year-month-day)",
    iossTitle: "Import One Stop Shop (IOSS)",
    iossIntro:
      "For stores sending goods from outside the EU to private buyers in the EU. A consignment of at most 150 EUR is charged destination VAT at checkout and marked with the IOSS number on the order. Most stores outside the EU must register through an EU intermediary. Stores established in Norway can register directly.",
    iossNumber: "IOSS number",
    iossNumberShape: "(IM and ten digits)",
    intermediary: "Intermediary",
    iossMarkets: "Markets IOSS applies to",
    iossMarketsHint: "EU countries only. Orders to other markets are not marked.",
    save: "Save the tax settings",
    ownerOnly: "Only an owner can change the tax settings.",
  },
  schemes: {
    none: { label: "Not registered for OSS", hint: "The store is not in the One Stop Shop." },
    union: {
      label: "Union scheme",
      hint: "An EU store registered in one member state, declaring VAT for distance sales to the other member states there.",
    },
    non_union: {
      label: "Non-Union scheme",
      hint: "A store outside the EU registered in a member state for services to private buyers in the EU (an EU number).",
    },
  },
  check: {
    title: "Check the VAT number",
    saveFirst: "Save a VAT number above first. Then it can be checked.",
    brreg: "the register of business enterprises (Brønnøysundregistrene)",
    vies: "VIES",
    notChecked: "has not been checked.",
    valid: "is registered",
    validWhen: "(checked in {source} on {when}).",
    invalid: "was not accepted",
    invalidWhen: "by {source} on {when}. Check the number.",
    unavailable: "could not be checked",
    unavailableWhen: "on {when}: {source} did not answer. The number is not taken as valid. Try again in a moment.",
    name: "Registered name",
    address: "Registered address",
    consultation: "Consultation number",
    checked: "Checked.",
    checkNow: "Check now",
  },
  readiness: {
    title: "What is on",
    on: "On",
    off: "Off",
    lineOn: "{name}: on. {text}",
    lineOff: "{name}: off. Needs {needs}.",
    joiner: ", ",
    names: { vat: "VAT registration", reverse_charge: "Reverse charge", oss: "OSS", ioss: "IOSS" },
    onText: {
      vat: "The store's VAT number is shown on its documents.",
      reverse_charge:
        "A business in another EU country that gives a valid VAT number is not charged VAT on goods and downloads. Goods sent from the buyer's own country are charged VAT.",
      oss: "The registration is recorded. Destination VAT is charged as before; the returns are not made here.",
      ioss: "Orders of at most 150 EUR from outside the EU to those markets are marked with the IOSS number. Above 150 EUR they are not handled.",
    },
    needs: {
      vatSwitch: "registration for VAT to be switched on",
      vatNumber: "a VAT number",
      euStore: "a store established in an EU member state (a store outside the EU never uses reverse charge)",
      registration: "registration for VAT",
      checkedNumber: "a VAT number that has been checked valid",
      euDispatch: "goods sent from an EU country (goods sent from outside the EU are an import, so reverse charge is then used for downloads only)",
      scheme: "a scheme chosen, if the store is registered for OSS",
      memberState: "the member state of registration",
      ossNumber: "the non-Union OSS number",
      iossNumber: "an IOSS number",
      iossMarkets: "the markets it applies to",
      outsideEu: "goods sent from outside the EU (IOSS is not used for goods sent from inside the EU)",
    },
  },
  warnings: {
    title: "Read this with your accountant",
    intro: "This is how Kaizena Flow handles VAT, and where it stops. It is not tax advice.",
    items: [
      "Destination VAT is charged on every consumer sale: the VAT of the buyer's country. The 10,000 EUR threshold and the origin-country rule are not applied. If the store is not registered for OSS or in that country, ask your accountant.",
      "Reverse charge is off until the store's own VAT number has been checked valid. It is used only for goods and downloads sold to a business in another EU member state that gives a valid VAT number for the country the goods go to. Goods must be sent from an EU country other than the buyer's: goods sent from outside the EU, or from the buyer's own country, are charged VAT (downloads are not sent, so they do not depend on it). A store outside the EU never uses it.",
      "A valid answer from VIES says that a number is registered. It does not say that the sale is exempt. You remain responsible.",
      "IOSS marks orders of at most 150 EUR (goods that are shipped, without VAT and without shipping, in euro at the store's rate; downloads are not part of it) sent from outside the EU to a private buyer in a market listed here. Above 150 EUR the order is not an IOSS sale and the buyer may pay import VAT at the border. That case is not handled here.",
      "Shipping is charged at the destination country's standard VAT rate unless the platform has verified another rule for the country.",
    ] as string[],
  },
  actions: {
    saved: "Saved.",
    valid: "The VAT number is registered.",
    invalid: "The register does not know this VAT number as valid. Check the number.",
    unreachable: "The register could not be reached just now. The number has not been checked: try again in a moment.",
  },
  /** What the server answers in English (`parseTaxProfile()`, `saveTaxProfile()`, `checkOwnVatNumber()`), said in the account's language. */
  problems: {
    noAccess: "You do not have access to this.",
    ownerOnly: "Only an owner can change the tax settings.",
    norwegianNumber: "A Norwegian VAT number is the nine-digit organisation number followed by MVA.",
    shape: "That does not look like a VAT number for the store's country.",
    characters: "A VAT number has only letters and digits.",
    prefixMissing: "Enter the VAT number, starting with the country code.",
    ownCountry: "The VAT number must be one of the store's own country (it starts with {prefix}).",
    dispatch: "Use a two-letter country code, such as NO or CN.",
    unionMember: "The Union scheme is registered in an EU member state. Choose it.",
    unionNumber: "The Union scheme has no number of its own: it is declared under the VAT number.",
    countryCode: "Use a two-letter country code.",
    ossNumber: "A non-Union OSS number is EU and nine digits.",
    date: "Use a date as year-month-day.",
    iossNumber: "An IOSS number is IM and ten digits.",
    intermediary: "At most 120 characters.",
    iossMarkets: "IOSS applies to EU countries only (not {codes}).",
    dbPrefix: "The VAT number must be one of the store's own country.",
    dbMarkets: "IOSS applies to EU countries only, each listed once.",
    dbMember: "The Union scheme is registered in an EU member state.",
    dbCheck: "The saved check does not belong to this number.",
    refused: "The tax settings were refused.",
    saveFirst: "Save the store's VAT number first.",
    changed: "The VAT number was changed while it was being checked. Check it again.",
  },
};

export type TaxMessages = Widen<typeof taxEn>;
