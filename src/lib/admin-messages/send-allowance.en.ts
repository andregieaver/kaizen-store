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
};

export type SendAllowanceMessages = Widen<typeof sendAllowanceEn>;
