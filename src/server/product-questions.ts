import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { checkMessage, looksAutomated, type Answer, type FormResponse } from "@/lib/forms";
import { formRequest } from "@/lib/forms-schema";
import { homeMarket } from "@/lib/markets";
import { pageBlockSchema, withChildren, type PageContent, type ProductBlock } from "@/lib/page-content";
import { marketUrl } from "@/lib/paths";
import { questionForm, questionKindOf, QUESTION_KEYS } from "@/lib/product-question";
import { optionLabel, t } from "@/lib/i18n";

import { sendEmail, type SendOutcome } from "./email";
import { FORM_DAILY, VISITOR_HOURLY } from "./forms";
import { log } from "./log";
import { lockedOut } from "./private-mode";
import { emailFooter, storeById } from "./shopper-emails";
import { resolveSellingShop } from "./shop";
import { formToInbox } from "./support-forms";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The product question (D431, `src/lib/product-question.ts`): a product layout's `question` part sends a shopper's question about the product
 * to the store's support inbox as a conversation of source `form` (D382: `formToInbox()`, people only, no model reads it), with the product's
 * title, address and the chosen variant as its first answer, so staff answer it by email from the inbox. A copy goes to the part's own addresses
 * when it has some; while the desk is off (or set to email), the question is emailed instead: to the part's addresses, else the store's
 * contact address, else its owners. Spam is held as a page's form holds it (D93): a hidden field, the time taken, `VISITOR_HOURLY` sends a
 * visitor may make to the store's forms in an hour and `FORM_DAILY` a part takes in a day.
 */

/** What the browser sends (`/api/product-question`): a page form's request, with the market view, the product and the chosen variant. */
export const productQuestionRequest = formRequest.extend({
  store: z.uuid(),
  market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2,3}){0,2}$/),
  product: z.uuid(),
  variant: z.uuid().nullable().default(null),
});
export type ProductQuestionRequest = z.infer<typeof productQuestionRequest>;

/**
 * A product layout's `question` part with this id, as published (D79: the store's layouts; a part in a Columns component's column too), or null.
 * Where it is emailed is read only here, never from the browser.
 */
export async function findProductPart(storeId: string, blockId: string): Promise<ProductBlock | null> {
  const pages = await typedRows(
    z.object({ published: z.unknown() }),
    sql`
      select published from commerce.pages
      where store_id = ${storeId}::uuid and type = 'product_layout' and published is not null
        and (jsonb_path_exists(published, '$.rows[*].columns[*].blocks[*] ? (@.id == $id)', jsonb_build_object('id', ${blockId}::text))
          or jsonb_path_exists(published, '$.rows[*].columns[*].blocks[*].columns[*].blocks[*] ? (@.id == $id)', jsonb_build_object('id', ${blockId}::text)))
      order by published_at desc nulls last
      limit 1
    `,
  );
  const page = pages[0]?.published as PageContent | undefined;
  const raw = page?.rows?.flatMap((row) => row.columns.flatMap((column) => withChildren(column.blocks))).find((block) => block.id === blockId);
  const parsed = raw ? pageBlockSchema.safeParse(raw) : null;
  const block = parsed?.success ? parsed.data : null;
  return block && block.type === "product" && block.part === "question" ? block : null;
}

const PRODUCT_ROW = z.object({ title: col.text, handle: col.text });

/** A shopper's question about a product: checked, counted, and put in the inbox (or emailed). Never throws past its own failure, which says so. */
export async function askProductQuestion(request: ProductQuestionRequest, visitor: string): Promise<{ status: number; body: FormResponse }> {
  const v = t(request.lang);
  const slug = await typedRow(z.object({ slug: col.text }), sql`select slug from commerce.stores where id = ${request.store}::uuid`);
  const shop = slug ? await resolveSellingShop(slug.slug, request.market) : null;
  if (!shop || (await lockedOut(shop.store))) return { status: 404, body: { ok: false, error: v.form.failed } };
  const { store, market } = shop;
  const block = await findProductPart(store.id, request.block);
  if (!block || questionKindOf(block) !== "question") return { status: 404, body: { ok: false, error: v.form.failed } };
  const owner = homeMarket(store) ?? market;
  const o = t(owner.lang);
  const form = questionForm(block, { company: o.quotes.company, message: o.quotes.question.message, button: o.quotes.question.button, sent: o.quotes.question.sent });
  const checked = checkMessage(form, request.values, false, v, o);
  if (!checked.ok) return { status: 422, body: { ok: false, errors: checked.errors } };
  // A robot is told it worked, and nothing is sent.
  if (looksAutomated(request)) return { status: 200, body: { ok: true, outcome: "sent" } };

  const product = await typedRow(
    PRODUCT_ROW,
    sql`
      select coalesce(tl.title, tf.title, p.handle) as title, p.handle
      from commerce.products p
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${owner.locale}
      left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      where p.store_id = ${store.id}::uuid and p.id = ${request.product}::uuid and p.status = 'active'
    `,
  );
  if (!product) return { status: 404, body: { ok: false, error: v.form.failed } };
  const variant = request.variant
    ? await typedRow(
        z.object({ options: z.record(z.string(), z.string()).nullable() }),
        sql`select options from commerce.product_variants where store_id = ${store.id}::uuid and product_id = ${request.product}::uuid and id = ${request.variant}::uuid and active`,
      )
    : null;
  const variantText = variant?.options && Object.keys(variant.options).length > 0 ? optionLabel(o, variant.options) : "";

  const counts = await typedRow(
    z.object({ visitor: col.int, part: col.int }),
    sql`
      select count(*) filter (where visitor = ${visitor} and created_at > now() - interval '1 hour')::int as visitor,
        count(*) filter (where block_id = ${block.id} and created_at > now() - interval '1 day')::int as part
      from commerce.form_submissions
      where store_id = ${store.id}::uuid and created_at > now() - interval '1 day' and (visitor = ${visitor} or block_id = ${block.id})
    `,
  );
  if ((counts?.visitor ?? 0) >= VISITOR_HOURLY || (counts?.part ?? 0) >= FORM_DAILY) return { status: 429, body: { ok: false, error: v.form.busy } };
  const submission = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, path, locale)
      values (${store.id}::uuid, ${block.id}, 'message', ${visitor}, 'pending', ${request.path}, ${request.lang})
      returning id
    `,
  );
  if (!submission) return { status: 502, body: { ok: false, error: v.form.failed } };

  // The product first, as staff read it: its title, the variant chosen and its address in the shopper's view.
  const link = marketUrl(store.slug, market.slug, `/p/${product.handle}`);
  const answers: Answer[] = [{ label: o.quotes.question.product, value: [variantText ? `${product.title} (${variantText})` : product.title, link].join("\n") }, ...checked.answers];
  const subject = o.quotes.question.subject.replace("{product}", product.title);
  const typedName = request.values[QUESTION_KEYS.name];
  const inbox = await formToInbox(
    store.id,
    { blockId: block.id, subject, path: request.path, lang: request.lang },
    answers,
    { email: checked.replyTo, name: typeof typedName === "string" ? typedName : null },
  );
  const recipients = block.recipients ?? [];
  let status: "sent" | "logged" | "failed" = "sent";
  if (!inbox.kept || inbox.emailToo || recipients.length > 0) {
    // A copy to the part's addresses; while the desk is off, the question itself, to them or else the store's own addresses.
    const to = recipients.length > 0 ? recipients : inbox.kept ? [] : await storeAddresses(store.id);
    if (to.length > 0) status = await relayQuestion(store.id, to, subject, answers, checked.replyTo, `pq:${submission.id}`, link);
    else if (!inbox.kept) status = "failed";
  }
  await db().execute(sql`update commerce.form_submissions set status = ${status} where id = ${submission.id}::uuid`);
  if (status === "failed") log("error", "product_question.not_delivered", { storeId: store.id });
  return status === "failed" ? { status: 502, body: { ok: false, error: v.form.failed } } : { status: 200, body: { ok: true, outcome: "sent" } };
}

/** The store's contact address, else its owners' own addresses: where a question goes when there is no inbox and the part names none. */
async function storeAddresses(storeId: string): Promise<string[]> {
  const contact = await typedRow(z.object({ email: col.textOrNull }), sql`select nullif(trim(contact_email), '') as email from commerce.stores where id = ${storeId}::uuid`);
  if (contact?.email) return [contact.email];
  const owners = await typedRows(
    z.object({ email: col.text }),
    sql`
      select distinct a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
      where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null and a.disabled_at is null and a.email <> ''
      order by a.email limit 5
    `,
  );
  return owners.map((r) => r.email);
}

/** One email to each address, in the store's own language, with the shopper's address to reply to (`form.message`, as a page's form, D93). */
async function relayQuestion(
  storeId: string,
  to: readonly string[],
  subject: string,
  answers: readonly Answer[],
  replyTo: string | null,
  key: string,
  link: string,
): Promise<"sent" | "logged" | "failed"> {
  const store = await storeById(storeId);
  if (!store) return "failed";
  const lang = store.markets[0]?.lang ?? "en";
  const o = t(lang);
  const blocks: EmailBlock[] = [
    { type: "heading", text: o.form.messageHeading },
    ...(replyTo ? [{ type: "paragraph" as const, text: o.form.replyHint }] : []),
    { type: "divider" },
    ...answers.map((a): EmailBlock => ({ type: "paragraph", text: `${a.label}:\n${a.value}` })),
    { type: "divider" },
    { type: "paragraph", text: `${o.form.page}: ${link}` },
  ];
  const email = renderEmail({ subject, preview: o.form.messageHeading, blocks, footer: emailFooter(store, emailText(lang)), lang });
  const outcomes: SendOutcome[] = [];
  for (const address of to) {
    outcomes.push(await sendEmail({ storeId, kind: "form.message", to: address, email, fromName: store.name, replyTo, idempotencyKey: `${key}:${address}` }));
  }
  return outcomes.includes("failed") ? "failed" : outcomes.every((x) => x === "sent" || x === "duplicate") ? "sent" : "logged";
}
