import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { applyEmailEvent } = await import("./email-events");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);

afterAll(async () => {
  await closeDb();
});

async function sentEmail(reference: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.email_messages (kind, to_address, subject, html, text, status, provider_reference, sent_at)
    values ('test', 'kari@example.com', 'Hei', '<p>Hei</p>', 'Hei', 'sent', ${reference}, now())
    returning id
  `);
  return String(row.id);
}

async function status(id: string) {
  const [row] = await db().execute<Row>(sql`select status, error from commerce.email_messages where id = ${id}::uuid`);
  return row;
}

describe("Resend's delivery events (D32)", () => {
  it("mark an email delivered, and a later bounce or complaint is never hidden by a delivery", async () => {
    const id = await sentEmail(`re-${run}-1`);
    expect(await applyEmailEvent({ type: "email.delivered", data: { email_id: `re-${run}-1` } })).toBe(true);
    expect(await status(id)).toMatchObject({ status: "delivered" });

    await applyEmailEvent({ type: "email.complained", data: { email_id: `re-${run}-1` } });
    await applyEmailEvent({ type: "email.delivered", data: { email_id: `re-${run}-1` } });
    expect(await status(id)).toMatchObject({ status: "complained" });
  });

  it("record why an email bounced, and ignore events for emails Kaizen did not send", async () => {
    const id = await sentEmail(`re-${run}-2`);
    await applyEmailEvent({
      type: "email.bounced",
      data: { email_id: `re-${run}-2`, bounce: { type: "Permanent", message: "The mailbox does not exist." } },
    });
    expect(await status(id)).toEqual({ status: "bounced", error: "Permanent: The mailbox does not exist." });
    expect(await applyEmailEvent({ type: "email.delivered", data: { email_id: "re-unknown" } })).toBe(false);
    expect(await applyEmailEvent({ type: "email.opened", data: { email_id: `re-${run}-2` } })).toBe(true);
  });
});
