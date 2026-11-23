import type { Widen } from "./common.en";

/**
 * Email automation's send allowance and contact limit (D876, D748 E10 part three), in English: what the account has used of its size, and
 * one press to move up. `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`).
 */
export const sendAllowanceEn = {
  title: "Email automation this month",
  usage: "{emails} of {emailsAllowed} emails this month, {contacts} of {contactsAllowed} contacts.",
  noLimit: "no limit",
  near: "You're close to what your size holds. Move up before a newsletter has to wait.",
  over: "You've reached what your size holds. New newsletters wait until you move up; flows and order emails keep sending.",
  moveUp: "Move up to {contacts} contacts",
  moveUpAny: "Move up a size",
  biggest: "This is the biggest size. Write to us and we'll find room.",
  askOwner: "Your account's owner can move up on Account, Extensions.",
  movedUp: "Moved up to {contacts} contacts. New newsletters can go again.",
  /** Use beyond the allowances and its cap (D880), on Account, Billing. */
  extras: {
    title: "Use beyond what's included",
    lead: "Billed as used, as lines on your next invoice.",
    aiLine: "Support desk: {used} AI-handled conversations this period, {included} included",
    peopleLine: "{name}: {used} people, {included} included",
    near: "close to what's included",
    beyond: "{n} beyond × {price} = {amount}",
    total: "So far this period: {amount} beyond what's included.",
    capped: "Your cap of {cap} stops it there, and the AI hands new conversations to people.",
    capTitle: "Monthly cap",
    capHint: "The most you pay a month beyond what's included. At the cap, the support desk's AI hands new conversations to people. Leave it empty for no cap.",
    capLabel: "Cap in {currency}",
    save: "Save cap",
    saved: "Saved.",
    badCap: "Type an amount of 0 or more, or leave it empty for no cap.",
  },
  /** The platform admin's prices beyond the allowances (D880), on Platform, Plans, Extensions. */
  extraPrices: {
    title: "Beyond what's included",
    hint: "What one unit beyond an extension's allowance costs, excluding VAT: billed as lines on each account's next invoice. Empty is never billed.",
    aiUnit: "{name}, per AI-handled conversation, {currency}",
    personUnit: "{name}, per person, {currency}",
    save: "Save prices",
    saved: "Saved.",
    bad: "Each price is an amount of 0 or more, or empty.",
  },
};

export type SendAllowanceMessages = Widen<typeof sendAllowanceEn>;
