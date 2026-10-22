import type { Widen } from "./common.en";

/**
 * The words of the Legal pages card on Kaizena Flow's Pages list (D312 P5): writing Kaizena Flow's own terms, privacy notice and data
 * processing agreement in English and Norwegian. `{list}` is a list of the business details that are missing.
 */
export const platformLegalEn = {
  title: "Legal pages",
  description:
    "Kaizena Flow's terms of service, privacy notice and data processing agreement, written in English and Norwegian and published at once. They are filled in from the business details under Header and footer.",
  kinds: { terms: "Terms of service", privacy: "Privacy notice", dpa: "Data processing agreement" },
  states: { none: "Not written", empty: "Published without words", written: "Published" },
  missing: "These business details are not filled in, so the pages show a placeholder for them: {list}. Fill them in under Header and footer, then write the pages again.",
  facts: { legalName: "company name", organisationNumber: "organisation number", postalAddress: "address", contactEmail: "contact email" },
  businessLink: "Business details",
  overwrite: "Write again over this page",
  write: "Write the legal pages",
  outcomes: { made: "made and published", written: "written and published", kept: "kept as it is", failed: "could not be written" },
  done: "Legal pages: {list}.",
};

export type PlatformLegalMessages = Widen<typeof platformLegalEn>;
