import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailContent } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";
import type { DataJob } from "./data-job-store";

type Row = Record<string, unknown>;

/**
 * The one email of an export job that is ready (D165, `docs/wave-2-data.md` 2.3, 5.2, `data_job.ready`, class `staff`): to the member who asked, in
 * English as the admin is, saying that the file is ready and where. It carries NO file, no row count of people and no link that works without signing
 * in: the link is the admin page of the export, which asks for the sign-in, and the file is a short-lived signed address made when the member presses
 * Download (and logged). Once per job (its idempotency key), never throwing: a failed email changes nothing about the job.
 */

const PAGES: Record<string, { path: string; what: string }> = {
  product_export: { path: "products/export", what: "product export" },
  order_export: { path: "orders/export", what: "order export" },
  customer_export: { path: "customers/export", what: "customer export" },
  redirect_export: { path: "redirects/export", what: "redirect file" },
  inventory_export: { path: "inventory/export", what: "stock file" },
};

export type ReadyFacts = { storeName: string; what: string; url: string };

/** The email's words, from facts: pure, so a test reads exactly what a member is told. */
export function readyEmail(facts: ReadyFacts): EmailContent {
  return {
    subject: `Your ${facts.what} is ready`,
    preview: "Open the page to download it. The file is kept for 7 days.",
    lang: "en",
    footer: [facts.storeName, "Kaizen · kaizenstore.cloud"],
    blocks: [
      { type: "heading", text: `Your ${facts.what} is ready` },
      { type: "paragraph", text: `The file you asked for in ${facts.storeName} is ready. Sign in to the admin to download it. The file is kept for 7 days and then deleted.` },
      { type: "paragraph", text: "Kaizen does not send the file by email, because it can hold personal data. The page asks you to sign in before it gives you the file." },
      { type: "button", text: "Open the page", url: facts.url },
    ],
  };
}

export type SendFn = typeof sendEmail;

/** Tells the member who asked that a job's file is ready: once. The outcome, or null when there is nobody to tell. */
export async function notifyReady(job: Pick<DataJob, "id" | "storeId" | "kind" | "requestedBy">, send: SendFn = sendEmail): Promise<string | null> {
  try {
    const page = PAGES[job.kind];
    if (!page) return null;
    const [row] = await db().execute<Row>(sql`
      select a.email, s.name, s.slug from commerce.accounts a, commerce.stores s
      where a.id = ${job.requestedBy}::uuid and a.disabled_at is null and s.id = ${job.storeId}::uuid
    `);
    if (!row || !row.email) return null;
    const email = renderEmail(readyEmail({ storeName: String(row.name), what: page.what, url: `${siteUrl()}/admin/${String(row.slug)}/${page.path}?job=${job.id}` }));
    return await send({
      storeId: job.storeId,
      kind: "data_job.ready",
      to: String(row.email),
      email,
      fromName: "Kaizen",
      idempotencyKey: `data_job.ready:${job.id}`,
    });
  } catch (error) {
    console.error("[data-jobs] the ready email could not be sent", job.id, error);
    return null;
  }
}
