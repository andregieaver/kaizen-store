import type { Widen } from "./common.en";

/**
 * Each paid extension's one line on its marker (D748 E5, `ExtensionOffPanel`), in English: what the owner gets. Only the server reads them
 * (`SERVER_AREAS`): `requireExtension()` hands the one line its page needs to the marker, so the lines are not in every admin screen's words.
 */
export const extensionPitchEn = {
  ab_testing: "Test two versions of a page and keep the one that sells more.",
  support_desk: "Answer every email and chat in one inbox, with AI answering first.",
  email_automation: "Send newsletters and emails that go out on their own at the right moment.",
  work: "Clients, time, invoices and the books, in one place.",
  deals: "Follow every deal from the first lead to the signed contract.",
  social: "Posts and pictures for every channel, written in your brand, and an adviser that says what to post next from your figures.",
  projects: "The team's projects and checklists: who does what, by when.",
};

export type ExtensionPitchMessages = Widen<typeof extensionPitchEn>;
