import { z } from "zod";

import type { DnsChange } from "./dns-plan";
import { RECORD_TYPES, type DnsRecordInput } from "./dns-records";
import type { RecipeId } from "./dns-recipes";

/**
 * What the AI manager's DNS tools take (D315, `docs/domains.md` 7.1), checked with zod and turned into the planner's changes. Pure, so the
 * catalogue and the tests share it. Record values come from a recipe, a finding, or what the owner wrote in the conversation; the model never
 * writes one of its own (the tools' descriptions say so, and the plan checks each record's shape).
 */

export const toolRecord = z.object({
  type: z.enum(RECORD_TYPES).describe("The record's type."),
  name: z.string().trim().max(253).default("").describe("The name relative to the domain: empty or @ for the domain itself, www, _dmarc, mail."),
  value: z.string().trim().max(4000).default("").describe("The value, exactly as the owner's provider gave it (an address, a host name or a text)."),
  priority: z.number().int().min(0).max(65535).optional().describe("An MX record's priority."),
  ttl: z.number().int().min(60).max(86400).optional().describe("Time to live in seconds (default 3600)."),
});

export type ToolRecord = z.output<typeof toolRecord>;

export const asRecord = (r: ToolRecord): DnsRecordInput => ({
  type: r.type,
  name: r.name === "@" ? "" : r.name,
  value: r.value,
  ...(r.type === "MX" ? { mxPriority: r.priority ?? 10 } : {}),
  ...(r.ttl ? { ttl: r.ttl } : {}),
});

export const changesOf = (add: readonly ToolRecord[], remove: readonly ToolRecord[]): DnsChange[] => [
  ...remove.map((r): DnsChange => ({ op: "remove", record: asRecord(r) })),
  ...add.map((r): DnsChange => ({ op: "add", record: asRecord(r) })),
];

export const EMAIL_PROVIDERS = ["google_workspace", "microsoft_365", "other", "dmarc"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** The recipe and the owner's values a `set_up_email` call stands for. */
export function emailRecipe(input: {
  provider: EmailProvider;
  mx?: string;
  autodiscover?: string;
  verification?: string;
  dkim?: string;
  records?: string;
  replace_email?: boolean;
  policy?: string;
}): { recipe: RecipeId; values: Record<string, string> } {
  switch (input.provider) {
    case "google_workspace":
      return { recipe: "google_workspace", values: { verification: input.verification ?? "", dkim: input.dkim ?? "" } };
    case "microsoft_365":
      return { recipe: "microsoft_365", values: { mx: input.mx ?? "", autodiscover: input.autodiscover ?? "", verification: input.verification ?? "" } };
    case "dmarc":
      return { recipe: "dmarc", values: { policy: input.policy ?? "none" } };
    case "other":
      return { recipe: "provider_records", values: { records: input.records ?? "", replace_mx: input.replace_email ? "yes" : "no" } };
  }
}

/** The DNS tools whose calls wait for a yes unless the store set DNS changes to automatic and the change leaves email alone. */
export const DNS_RECORD_TOOLS = new Set(["change_dns", "set_up_email", "verify_domain_for", "undo_dns_change"]);
