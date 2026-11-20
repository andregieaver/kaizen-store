import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { isExtensionId } from "@/lib/extensions";

import type { Account } from "./auth";
import { startExtensionTrial } from "./extensions";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * A sign-up for extensions (D748 step E7 part two, `docs/extensions.md` 7): a request that ticked no store is approved into its account's
 * workspace (`commerce.approve_workspace_request()`), and every request starts the trials of the extensions it ticked, as their owner would.
 */

/** Approves a request without a store into a workspace (an admin's approval, or the person's own confirmation: `admin` null). */
export async function approveWorkspaceRequest(admin: Account | null, requestId: string): Promise<{ ok: true; storeId: string; email: string } | { ok: false; problems: string[] }> {
  try {
    const row = await typedRow(
      z.object({ store_id: col.uuid, email: col.text }),
      sql`
        select commerce.approve_workspace_request(${requestId}::uuid, ${admin?.id ?? null}::uuid) as store_id,
               (select email from commerce.access_requests where id = ${requestId}::uuid) as email
      `,
    );
    if (!row) return { ok: false, problems: ["The request was not approved."] };
    await startChosenTrials(requestId);
    return { ok: true, storeId: row.store_id, email: row.email };
  } catch (error) {
    log("warn", "workspace_signup.refused", { requestId }, error);
    return { ok: false, problems: [error instanceof Error && /disabled/.test(error.message) ? "That person's account is disabled." : "The request could not be approved."] };
  }
}

/**
 * Starts the trials of the extensions an approved request ticked, in its store's or workspace's account, as its owner starts them
 * (`startExtensionTrial()`: 14 days, once per account and extension; before extensions are sold every account has them all, so none
 * starts). Answers how many started.
 */
export async function startChosenTrials(requestId: string): Promise<number> {
  const row = await typedRow(
    z.object({ account_id: col.uuid, email: col.text, organisation_id: col.uuid.nullable(), extensions: z.array(z.string()) }),
    sql`
      select a.id as account_id, a.email, s.organisation_id, r.extensions
        from commerce.access_requests r
        join commerce.accounts a on lower(a.email) = lower(r.email)
        left join commerce.stores s on s.id = r.store_id
       where r.id = ${requestId}::uuid and r.status = 'approved'
    `,
  );
  if (!row?.organisation_id) return 0;
  const owner: Account = { id: row.account_id, email: row.email, name: null, platformAdmin: false };
  let started = 0;
  for (const extension of row.extensions.filter(isExtensionId)) {
    const result = await startExtensionTrial(owner, row.organisation_id, extension);
    if (result.ok) started += 1;
  }
  return started;
}
