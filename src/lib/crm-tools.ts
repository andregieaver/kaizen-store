import { z } from "zod";

import { ACTIVITY_KINDS, ACTIVITY_NOTE_MAX, ACTIVITY_TITLE_MAX } from "./activities";
import { TIMELINE_KINDS } from "./customer-timeline";

/**
 * The AI manager's CRM tools (ecosystem plan E2.5, D713): deals, leads, activities and a customer's timeline, through the Deals board's,
 * the leads inbox's and the customer page's own functions. What they take; the runners are `src/server/crm-tools.ts`. Nothing here reaches
 * a customer: a deal, a lead decision and an activity are the store's own records. What people typed (a lead's message, an email's subject
 * or words, a conversation, a note) is never given to the model; a person's name and address are, as on the customers' tools.
 */

const dealRef = z.string().trim().min(1).max(200).describe("The deal: its title as list_deals shows it (a part of it is enough when only one deal has it), or its id.");

export const DEAL_LIST_STATUSES = ["open", "won", "lost", "all"] as const;

export const listDealsInput = z.object({
  status: z.enum(DEAL_LIST_STATUSES).default("open").describe("open (the default), won, lost, or all."),
  pipeline: z.string().trim().min(1).max(80).optional().describe("Only this pipeline, by its name as list_deals gives it. Left out: every pipeline."),
  limit: z.number().int().min(1).max(50).default(25).describe("How many at most (1–50)."),
});
export type ListDealsInput = z.output<typeof listDealsInput>;

export const getDealInput = z.object({ deal: dealRef });
export type GetDealInput = z.output<typeof getDealInput>;

export const moveDealInput = z
  .object({
    deal: dealRef,
    stage: z.string().trim().min(1).max(80).optional().describe("The stage to move an open deal to, by its name as list_deals or get_deal gives it."),
    outcome: z.enum(["won", "lost"]).optional().describe("Close an open deal as won or lost instead of moving it."),
    reason: z.string().trim().min(1).max(200).optional().describe("Why a deal was lost, in the owner's words (at most 200 characters); only with outcome lost."),
  })
  .refine((v) => (v.stage ? 1 : 0) + (v.outcome ? 1 : 0) === 1, { message: "Give either a stage or an outcome, not both." });
export type MoveDealInput = z.output<typeof moveDealInput>;

export const listLeadsInput = z.object({ limit: z.number().int().min(1).max(50).default(20).describe("How many at most (1–50).") });
export type ListLeadsInput = z.output<typeof listLeadsInput>;

export const makeDealFromLeadInput = z.object({ email: z.email().max(254).describe("The lead's email address, as list_leads gives it.") });
export type MakeDealFromLeadInput = z.output<typeof makeDealFromLeadInput>;

export const crmTodayInput = z.object({
  who: z.enum(["me", "team"]).default("me").describe("me (the default): the person's own activities; team: everyone's."),
});
export type CrmTodayInput = z.output<typeof crmTodayInput>;

export const logActivityInput = z
  .object({
    kind: z.enum(ACTIVITY_KINDS).describe("call, meeting or task."),
    title: z.string().trim().min(1).max(ACTIVITY_TITLE_MAX).describe("What to do, in a few words."),
    due_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The day it is due, YYYY-MM-DD, in the store's time zone."),
    due_time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("The time it is due, HH:MM; left out: some time that day."),
    duration_minutes: z.number().int().min(1).max(720).optional().describe("A meeting's length in minutes."),
    deal: dealRef.optional().describe("The deal it is about (its title, a part of it, or its id)."),
    customer: z.email().max(254).optional().describe("The customer it is about, by their email address."),
    note: z.string().trim().max(ACTIVITY_NOTE_MAX).optional().describe("A note for whoever does it."),
  })
  .refine((v) => Boolean(v.deal || v.customer), { message: "Name the deal or the customer it is about." });
export type LogActivityInput = z.output<typeof logActivityInput>;

export const customerTimelineInput = z.object({
  customer: z.string().trim().min(3).max(254).describe("The customer: their email address, or their id as list_customers gives it."),
  kind: z.enum(TIMELINE_KINDS).optional().describe("Only one kind of event; left out: every kind the person may see."),
});
export type CustomerTimelineInput = z.output<typeof customerTimelineInput>;

/**
 * The timeline's events whose `label` is a store's own words (an order's or a quote's number, a deal's title, a product's, a booking's):
 * the rest carry what someone else wrote (an email's or a conversation's subject, a note, a review), and the model gets only their kind
 * and date.
 */
export const OWN_LABEL_KINDS: ReadonlySet<string> = new Set(["order", "quote", "deal", "return", "booking", "work_invoice"]);
