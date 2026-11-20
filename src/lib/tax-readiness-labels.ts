/**
 * What the VAT features need, in English (D157, bloat review step 2.50): beside `tax-profile.ts`, whose `readiness()` the AI manager's tax
 * tools read with no language, so the `tax` catalogue takes its `readiness` group from here and those tools bring no catalogue. Imports
 * nothing.
 */

export const TAX_READINESS_EN = {
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
};
