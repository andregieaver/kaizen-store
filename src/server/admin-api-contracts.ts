import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { CONTRACTS_API } from "@/lib/admin-api-contracts";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { readExtensionFacts, standingOf } from "@/lib/extensions";
import { siteUrl } from "@/lib/site";

import { cursorAt, fail, ok, pageOf, paging, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { col, typedRows } from "./typed-rows";

/**
 * The Admin API's contracts (D695, D810): read only, a page at a time newest first, or one by its id. Read straight from the contracts and
 * their signers with the store named in every condition; never a signer's email, a decline's reason or the words. Deals and contracts is a
 * paid extension (D748): without it these answer `feature_off`, as the deals pages show the extension's marker.
 */

export const CONTRACTS_NAMES = CONTRACTS_API.map((o) => o.name);
type ContractsName = (typeof CONTRACTS_API)[number]["name"];
export type ContractsRoute = Extract<ApiRoute, { name: ContractsName }>;

type ApiContract = AdminAnswer<"contracts.get">["data"];

const row = z.object({
  id: col.uuid,
  title: col.text,
  status: z.enum(["draft", "sent", "signed", "declined", "expired", "cancelled"]),
  language: col.text,
  deal_id: col.uuid.nullable(),
  template: col.textOrNull,
  sent_at: col.timestampOrNull,
  expires_at: col.timestampOrNull,
  completed_at: col.timestampOrNull,
  signed_pdf: col.bool,
  created_at: col.timestamp,
  updated_at: col.timestamp,
  cursor_at: col.text,
  signers: z.array(
    z.object({
      role: z.enum(["store", "customer", "other"]),
      name: col.text,
      viewed_at: col.timestampOrNull,
      signed_at: col.timestampOrNull,
      declined_at: col.timestampOrNull,
    }),
  ),
});

const out = (slug: string) => (r: z.output<typeof row>): ApiContract => ({
  id: r.id,
  title: r.title,
  status: r.status,
  language: r.language,
  deal_id: r.deal_id,
  template: r.template,
  signers: r.signers,
  sent_at: r.sent_at,
  expires_at: r.expires_at,
  completed_at: r.completed_at,
  signed_pdf: r.signed_pdf,
  created_at: r.created_at,
  updated_at: r.updated_at,
  admin_url: r.deal_id ? `${siteUrl()}/admin/${slug}/deals/${r.deal_id}/contracts/${r.id}` : `${siteUrl()}/admin/${slug}/deals`,
});

const read = (storeId: string, where: ReturnType<typeof sql>, limit: number) =>
  typedRows(
    row,
    sql`
      select k.id, k.title, k.status, k.language, k.deal_id, t.name as template, k.sent_at, k.expires_at, k.completed_at,
        k.signed_pdf_path is not null as signed_pdf, k.created_at, k.updated_at, ${cursorAt(sql`k.created_at`)} as cursor_at,
        coalesce((select json_agg(json_build_object('role', g.role, 'name', g.name, 'viewed_at', g.viewed_at, 'signed_at', g.signed_at,
            'declined_at', g.declined_at) order by g.position)
          from commerce.contract_signers g where g.store_id = k.store_id and g.contract_id = k.id), '[]'::json) as signers
      from commerce.contracts k
      left join commerce.contract_templates t on t.store_id = k.store_id and t.id = k.template_id
      where k.store_id = ${storeId}::uuid and ${where}
      order by k.created_at desc, k.id desc
      limit ${limit}
    `,
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function answerContracts(caller: ApiCaller, route: ContractsRoute, request: Request): Promise<ApiAnswer> {
  const store = caller.member.store;
  if (standingOf(readExtensionFacts(store.extensionFacts), "deals", new Date()).state === "absent") {
    return fail("feature_off", "Deals and contracts is an extension this account does not have.");
  }
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "contracts.list": {
      const page = paging(params, sql`k.created_at`, sql`k.id`);
      const status = params.get("status");
      const deal = params.get("deal_id");
      if (deal && !UUID.test(deal)) return fail("invalid", "deal_id is a deal's id.");
      const where = sql`${page.where} and ${sinceWhere(params, sql`k.updated_at`)}
        ${status ? sql`and k.status = ${status}` : sql``} ${deal ? sql`and k.deal_id = ${deal}::uuid` : sql``}`;
      const rows = await read(store.id, where, page.limit + 1);
      return ok(route.name, pageOf(page, rows, out(store.slug)));
    }
    case "contracts.get": {
      const [found] = await read(store.id, sql`k.id = ${route.id}::uuid`, 1);
      if (!found) return fail("not_found", "No such contract in this store.");
      return ok(route.name, { data: out(store.slug)(found) });
    }
  }
}
