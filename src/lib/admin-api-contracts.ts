import { z } from "zod";

import { byId, id, one, op, page, paging, since, when } from "./admin-api-shapes";

/**
 * The Admin API's contracts (D695, D810): a deal's contracts read, as the deal's Contracts card and the contract's page show them, under
 * `customers:read` (a contract names its signers: a person's data). The same fields as the `contract.*` webhooks, drafts too; never a
 * signer's email, the reason a signer gave for declining or the contract's words, which stay on the contract's page. Behind Deals (`sales`)
 * and its extension. Entries of `ADMIN_API`; their handlers are `src/server/admin-api-contracts.ts`. Pure.
 */

export const CONTRACT_STATUSES = ["draft", "sent", "signed", "declined", "expired", "cancelled"] as const;

export const apiContract = z.object({
  id,
  title: z.string(),
  status: z.enum(CONTRACT_STATUSES).describe("draft: not sent yet. sent: out for signing. signed: by everyone (the deal is won). declined, expired or cancelled: ended."),
  language: z.string().describe("The language it is written and signed in (nb, en)."),
  deal_id: id.nullable().describe("The deal it is for; null only for a signed contract whose deal was deleted."),
  template: z.string().nullable().describe("The name of the template it was made from."),
  signers: z
    .array(
      z.object({
        role: z.enum(["store", "customer", "other"]),
        name: z.string(),
        viewed_at: when.nullable().describe("When they first opened the signing page."),
        signed_at: when.nullable(),
        declined_at: when.nullable(),
      }),
    )
    .describe("In the order they sign. Never their email or the reason a signer gave for declining."),
  sent_at: when.nullable(),
  expires_at: when.nullable().describe("The last moment it can be signed, while it is out for signing."),
  completed_at: when.nullable().describe("When the last signer signed, or a signer declined."),
  signed_pdf: z.boolean().describe("Whether the sealed PDF of a signed contract is made (within minutes of the last signature)."),
  created_at: when,
  updated_at: when,
  admin_url: z.string().describe("The contract's page in the admin, where it is read, sent and its PDF downloaded."),
});

export const contractListQuery = z.object({
  ...paging,
  ...since,
  status: z.enum(CONTRACT_STATUSES).optional().describe("Only contracts in this status."),
  deal_id: id.optional().describe("Only this deal's contracts."),
});

export const CONTRACTS_API = [
  op({
    name: "contracts.list",
    method: "GET",
    path: "/contracts",
    scope: "customers:read",
    permission: "customers:read",
    feature: "sales",
    tag: "Contracts",
    summary: "List contracts",
    description: "The store's contracts for deals (D695), newest first, with their signers in order: whose turn it is, who signed and when.",
    query: contractListQuery,
    response: page(apiContract),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "contracts.get",
    method: "GET",
    path: "/contracts/{id}",
    scope: "customers:read",
    permission: "customers:read",
    feature: "sales",
    tag: "Contracts",
    summary: "Get a contract",
    description: "One contract with its signers. Its words and PDF are read on its page in the admin.",
    params: byId,
    response: one(apiContract),
    status: 200,
    errors: ["not_found"],
  }),
] as const;
