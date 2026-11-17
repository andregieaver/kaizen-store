import type { Widen } from "./common.en";

/**
 * The words of form templates (D705 F4, `docs/forms.md` 12): New form's sections, the owner's own templates, Save as template beside a
 * form, and the platform's hiding. Apart from `forms` so the list and the responses do not hand them to the browser.
 */
export const formTemplatesEn = {
  formTemplates: "Form templates",
  kaizen: "Ready-made",
  own: "Your templates",
  stores: "From your other stores",
  marketplace: "From other stores",
  marketplaceHint: "Templates other store owners share. Using one copies it: nothing they change later reaches your form.",
  by: "By {name}",
  questions: { one: "{n} question", many: "{n} questions" },
  manage: "Share or delete your templates",
  managePlatform: "Show, hide or delete Kaizena Flow's templates",
  hideHint: "A hidden template is in no store's list. Forms already made from it stay.",
  delete: "Delete",
  deleteConfirm: "Delete {name}? Forms made from it stay as they are.",
  hidden: "Hidden",
  hide: "Hide",
  show: "Show",
  starter: "Starter",
  saveTitle: "Save as template",
  saveText: "Start new forms from this one. Its questions and words are saved; its addresses, welcome code and tags are not.",
  name: "Template name",
  description: "What it is for",
  category: "Kind of form",
  sharing: "Who can use it",
  ownersOnly: "Only the store's owners share a template beyond this store.",
  platformShared: "Kaizena Flow's templates are offered to every store.",
  saveButton: "Save as template",
  saved: "Saved. It is under New form.",
  linked: "Saved as the template {name}.",
  update: "Update the template",
  updateText: "Forms already made from it stay as they are.",
  updated: "The template is updated.",
  starterOf: "Made from Kaizena Flow's starter {name}.",
  adopt: "Update the starter from this form",
  categories: { contact: "Contact", sales: "Sales", bookings: "Bookings", newsletter: "Newsletter", feedback: "Feedback", events: "Events", other: "Other" },
  sharings: { private: "Only this store", stores: "My stores", marketplace: "Every store (marketplace)" },} as const;

export type FormTemplatesMessages = Widen<typeof formTemplatesEn>;
