/**
 * The owner's words for the data protection officer (D763): on Your account for all the account's stores, and on a store's Company page
 * for a store that names its own. Server-only (`SERVER_AREAS`).
 */
export const privacyOfficerEn = {
  title: "Data protection officer",
  accountLead: "Named on every store's privacy statement and its recordings assessment, unless a store names its own.",
  platformLead: "Kaizena Flow's own, named on its privacy notice when the legal pages are written again.",
  storeLead: "Named on this store's privacy statement and its recordings assessment.",
  none: "Nobody yet",
  sameAsAccountWho: "Same as your account: {who}",
  sameAsAccountNone: "Same as your account (nobody named yet)",
  team: "Someone on the team",
  someoneElse: "Someone else, such as a firm",
  name: "Name",
  email: "Email",
  phone: "Phone (optional)",
  firm: "Firm (optional)",
  save: "Save",
  saved: "Saved.",
  current: "Now: {who}",
  currentNone: "Now: nobody named",
  nobody: "Nobody named",
  notOwner: "Only the account's owner can name its data protection officer.",
  hint: "The law asks for the officer's contact details on your privacy statement, and for them to be reported to the data protection authority.",
};

export type PrivacyOfficerMessages = typeof privacyOfficerEn;
