/**
 * The words of a company's facts from Brønnøysundregistrene (D891): the card on a store's business customer, on a store's business in the
 * platform's admin, and the line on a visiting company. Server-only (`SERVER_AREAS`): every part is drawn on the server.
 */
export const registerFactsEn = {
  title: "From the business register",
  business: "Business",
  legalName: "Legal name",
  orgNumber: "Organisation number",
  noBusiness: "No business details yet.",
  notNorwegian: "Company facts are read from Brønnøysundregistrene, for Norwegian organisation numbers.",
  notLookedUp: "Not looked up yet: Brønnøysundregistrene did not answer. The facts come with the next visit or the daily check.",
  notFound: "Brønnøysundregistrene has no unit with this number. Check the organisation number.",
  soleTrader: "A sole trader: its entry is a person's, so no facts of it are kept here.",
  industry: "Industry",
  employees: "Employees",
  founded: "Founded",
  place: "Place",
  website: "Website",
  revenue: "Revenue {year}",
  operatingResult: "Operating result",
  profit: "Profit after tax",
  equity: "Equity",
  negativeEquity: "Negative equity: it owes more than it owns.",
  change: "{change} on the year before",
  noAccounts: "No annual accounts in Regnskapsregisteret.",
  flags: {
    bankrupt: "Bankrupt since {day}",
    winding_up: "Being wound up since {day}",
    dissolution: "Being forcibly dissolved since {day}",
    deleted: "Deleted from the register on {day}",
  },
  shortFlags: { bankrupt: "Bankrupt", winding_up: "Being wound up", dissolution: "Being dissolved", deleted: "Deleted" },
  termsAdvice: "It buys on payment terms. Consider turning them off before its next order.",
  source: "Source: Brønnøysundregistrene, checked {date}.",
  line: {
    revenue: "revenue {amount} ({year})",
    founded: "founded {year}",
  },
};

export type RegisterFactsMessages = typeof registerFactsEn;
