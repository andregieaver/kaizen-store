import { z } from "zod";

import { all, byId, id, one, op, page, paging, when } from "./admin-api-shapes";

/**
 * The Admin API's forms (D705 F5, `docs/forms.md` 7): the store's forms read, made (from a template or whole) and changed with the
 * editor's own checks, under `forms:read` and `forms:write`; their responses read with the right to read customers, as the Responses tab
 * is, since a response is a person's data. Entries of `ADMIN_API`; their handlers are `src/server/admin-api-forms.ts`. Pure.
 */

export const apiFormSummary = z.object({
  id,
  name: z.string().describe("The owner's name for it; never shown on the site."),
  kind: z.enum(["message", "signup"]).describe("A message form, or a newsletter sign-up."),
  status: z.enum(["active", "archived"]).describe("archived: it shows nothing on the site and takes no responses."),
  questions: z.int().describe("How many questions it asks (a sign-up's own email and name not counted)."),
  responses: z.int(),
  unread: z.int().describe("Responses not yet opened in the admin."),
  last_response_at: when.nullable(),
  updated_at: when,
});

export const apiForm = apiFormSummary.extend({
  made_from: z.string().nullable().describe("`starter:{key}` or `template:{id}`: what it was made from. Never a link that changes it."),
  draft: z
    .record(z.string(), z.unknown())
    .describe("The form as the editor keeps it (kind, name, questions with their words per language, words, delivery, signup, keepMonths): what `PATCH` takes back whole."),
});

export const apiFormResponse = z.object({
  id,
  answers: z.array(z.object({ label: z.string(), value: z.string() })).describe("What the visitor answered, labelled in the owner's language, in the form's order."),
  contact_email: z.string().nullable().describe("The first email address answered, lower case."),
  path: z.string().describe("The page it was sent from."),
  locale: z.string(),
  state: z.enum(["new", "read", "archived"]),
  delivery: z.enum(["sent", "logged", "failed", "inbox"]).describe("How it reached the store: emailed (sent, or only logged without email settings), the email failed, or the support inbox."),
  created_at: when,
});

export const formCreateBody = z
  .object({
    template_id: id.optional().describe("A form template the store may use (its own, its owner's other stores', Kaizena Flow's or the marketplace's): the form is made from it in the store's languages, sending to the store's contact address."),
    draft: z.record(z.string(), z.unknown()).optional().describe("The form whole, as `GET` answers its `draft`; the editor's own checks run on it."),
  })
  .refine((b) => Boolean(b.template_id) !== Boolean(b.draft), "Send template_id or draft, not both.");

export const formUpdateBody = z.object({
  draft: z.record(z.string(), z.unknown()).describe("The form whole, as `GET` answers its `draft` (read it first); its kind never changes. The editor's own checks run on it."),
});

export const FORMS_API = [
  op({
    name: "forms.list",
    method: "GET",
    path: "/forms",
    scope: "forms:read",
    permission: "website:read",
    tag: "Forms",
    summary: "List forms",
    description: "The store's forms (D705), archived last, newest change first, with their responses counted.",
    response: all(apiFormSummary),
    status: 200,
    errors: [],
  }),
  op({
    name: "forms.get",
    method: "GET",
    path: "/forms/{id}",
    scope: "forms:read",
    permission: "website:read",
    tag: "Forms",
    summary: "Get a form",
    description: "One form with its draft: what it asks, its words in every language, who it emails and how long it keeps responses.",
    params: byId,
    response: one(apiForm),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "forms.responses",
    method: "GET",
    path: "/forms/{id}/responses",
    scope: "forms:read",
    permission: "customers:read",
    tag: "Forms",
    summary: "List a form's responses",
    description:
      "What visitors sent with the form, newest first, as the Responses tab shows them. A response is a person's data: it needs the right to read customers, and goes after the form's own months.",
    params: byId,
    query: z.object(paging),
    response: page(apiFormResponse),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "forms.create",
    method: "POST",
    path: "/forms",
    scope: "forms:write",
    permission: "website:write",
    tag: "Forms",
    summary: "Make a form",
    description: "Makes a form from a template, or whole from a draft. It shows on the site only once a page's Form component places it.",
    body: formCreateBody,
    response: one(apiForm),
    status: 201,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "forms.update",
    method: "PATCH",
    path: "/forms/{id}",
    scope: "forms:write",
    permission: "website:write",
    tag: "Forms",
    summary: "Change a form",
    description: "Saves the form's draft whole: a page that places it shows the change at once.",
    params: byId,
    body: formUpdateBody,
    response: one(apiForm),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
] as const;
