import { z } from "zod";

import { ACTIVITY_KINDS } from "./activities";
import { all, byId, id, one, op, page, paging, since, when } from "./admin-api-shapes";
import { LEAD_KINDS, LEAD_SOURCES } from "./leads";

/**
 * The Admin API's CRM, read (D902, D901 P29): the store's pipelines, deals, activities, companies and leads, as the deals board, a deal's page,
 * a company's page and the leads inbox show them, under `customers:read` (they name people). The fields are the `deal.*`, `activity.*` and
 * `lead.*` webhooks' with the names a sync needs beside the ids; never a lost deal's reason, an activity's note, a lead's message or what
 * anyone typed, which stay on their pages. Deals, activities and leads stand behind Deals (`sales`) and its extension; companies are the
 * store's own (D108). So an owner can keep another CRM in step through Zapier, Make or their own code before Kaizena Flow's own
 * connections come (`docs/pipedrive.md`). Entries of `ADMIN_API`; their handlers are `src/server/admin-api-crm.ts`. Pure.
 */

const DEAL_STATUSES = ["open", "won", "lost"] as const;
const CLOSED_VIA = ["person", "order", "work_invoice", "platform", "contract"] as const;

const named = z.object({ id, name: z.string() });

export const apiStage = z.object({
  id,
  name: z.string(),
  position: z.int().describe("Its place in the pipeline, from 0."),
  probability: z.int().nullable().describe("The chance, in per cent, that a deal in this stage is won; null when none is set."),
  quote_stage: z.boolean().describe("A deal moves here when its quote is sent."),
  contract_stage: z.boolean().describe("A deal moves here when its contract is sent for signing."),
});

export const apiPipeline = z.object({ id, name: z.string(), stages: z.array(apiStage).describe("In their order on the board.") });

export const apiDeal = z.object({
  id,
  title: z.string(),
  status: z.enum(DEAL_STATUSES),
  pipeline: named,
  stage: z.object({ id, name: z.string(), position: z.int() }),
  value: z
    .number()
    .nullable()
    .describe("What the deal is worth in `currency`, in its units (199.5, not minor units): its linked orders', quotes' and Work assignments' amounts before VAT, or the estimate while nothing is linked; null when there is neither."),
  currency: z.string().describe("The store's main currency, which `value` is in."),
  customer: named.nullable().describe("The person it is about (`GET /customers/{id}` for their email)."),
  company: named.nullable().describe("The company it is about."),
  owner: named.nullable().describe("The staff member who owns it."),
  expected_close_on: z.string().nullable().describe("A date, YYYY-MM-DD."),
  closed_at: when.nullable(),
  closed_via: z.enum(CLOSED_VIA).nullable().describe("What closed it: a person, a paid order, an issued Work invoice, Kaizena Flow's own records or a signed contract."),
  stage_entered_at: when,
  created_at: when,
  updated_at: when.describe("When the deal itself last changed. A linked order's or quote's amount changing moves `value` without moving this."),
  admin_url: z.string(),
});

export const dealListQuery = z.object({
  ...paging,
  ...since,
  status: z.enum(DEAL_STATUSES).optional(),
  pipeline_id: id.optional(),
  stage_id: id.optional(),
  owner_id: id.optional(),
  customer_id: id.optional(),
  company_id: id.optional(),
});

export const apiActivity = z.object({
  id,
  kind: z.enum(ACTIVITY_KINDS).describe("A call, a meeting or a task."),
  title: z.string(),
  due_at: when.describe("When it is due; the start of the store's day when no time was given (`timed` false)."),
  timed: z.boolean(),
  duration_minutes: z.int().nullable().describe("A meeting's length."),
  done_at: when.nullable(),
  assignee: named.nullable().describe("The staff member who does it."),
  customer_id: id.nullable(),
  company_id: id.nullable(),
  deal_id: id.nullable(),
  created_at: when,
  updated_at: when,
  admin_url: z.string(),
});

export const activityListQuery = z.object({
  ...paging,
  ...since,
  done: z.enum(["true", "false"]).optional().describe("Only those done (true) or still to do (false)."),
  deal_id: id.optional(),
  customer_id: id.optional(),
  company_id: id.optional(),
  assignee_id: id.optional(),
});

export const apiCompany = z.object({
  id,
  name: z.string(),
  organisation_number: z.string().nullable(),
  active: z.boolean(),
  people: z.int().describe("How many of the store's customers buy for it."),
  created_at: when,
  updated_at: when,
  admin_url: z.string(),
});

export const apiLead = z.object({
  email: z.string().describe("Their address, which is who they are until they are a customer."),
  name: z.string().nullable(),
  latest: when.describe("When they last asked for something."),
  requests: z
    .array(
      z.object({
        kind: z.enum(LEAD_KINDS).describe("What they asked for: a quote, a question (a form or the email form), a chat, or to join the email list."),
        source: z.enum(LEAD_SOURCES).describe("Where it is kept: a draft order, a form's response, a support conversation or a subscriber."),
        id: id.describe("That record's id."),
        at: when,
      }),
    )
    .describe("What they asked for since the last decision about them, newest first. Never their words, which are read on the leads page."),
});

const DEALS = { scope: "customers:read", permission: "customers:read", feature: "sales" } as const;

export const CRM_API = [
  op({
    name: "pipelines.list",
    method: "GET",
    path: "/pipelines",
    ...DEALS,
    tag: "Deals",
    summary: "List pipelines",
    description: "The store's pipelines with their stages in order (D464), as the deals board shows them.",
    response: all(apiPipeline),
    status: 200,
    errors: [],
  }),
  op({
    name: "deals.list",
    method: "GET",
    path: "/deals",
    ...DEALS,
    tag: "Deals",
    summary: "List deals",
    description: "The store's deals, newest first, each with its worth, stage, person, company and owner; narrowed by status, pipeline, stage, owner, person or company.",
    query: dealListQuery,
    response: page(apiDeal),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "deals.get",
    method: "GET",
    path: "/deals/{id}",
    ...DEALS,
    tag: "Deals",
    summary: "Get a deal",
    description: "One deal. Its history, links and contracts are on its page in the admin (contracts: `GET /contracts?deal_id=`).",
    params: byId,
    response: one(apiDeal),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "activities.list",
    method: "GET",
    path: "/activities",
    ...DEALS,
    tag: "Activities",
    summary: "List activities",
    description: "The store's calls, meetings and tasks (D468), newest first, narrowed by done, deal, person, company or who does them. Never an activity's note.",
    query: activityListQuery,
    response: page(apiActivity),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "activities.get",
    method: "GET",
    path: "/activities/{id}",
    ...DEALS,
    tag: "Activities",
    summary: "Get an activity",
    description: "One call, meeting or task.",
    params: byId,
    response: one(apiActivity),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "leads.list",
    method: "GET",
    path: "/leads",
    ...DEALS,
    tag: "Leads",
    summary: "List leads",
    description:
      "The leads inbox (D475): people who asked for a quote, a question, a chat or the email list in the last 90 days and are neither customers who paid nor in an open deal, one a person, newest first, at most 100.",
    response: all(apiLead),
    status: 200,
    errors: [],
  }),
  op({
    name: "companies.list",
    method: "GET",
    path: "/companies",
    scope: "customers:read",
    permission: "customers:read",
    tag: "Companies",
    summary: "List companies",
    description: "The store's companies (D108), newest first, with how many of its customers buy for each.",
    query: z.object({ ...paging, ...since }),
    response: page(apiCompany),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "companies.get",
    method: "GET",
    path: "/companies/{id}",
    scope: "customers:read",
    permission: "customers:read",
    tag: "Companies",
    summary: "Get a company",
    description: "One company. Its buyers are the customers whose `company_id` it is.",
    params: byId,
    response: one(apiCompany),
    status: 200,
    errors: ["not_found"],
  }),
] as const;
