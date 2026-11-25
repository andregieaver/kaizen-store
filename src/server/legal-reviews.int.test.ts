import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));

const { latestViews, reviewText, saveView } = await import("./legal-reviews");

/**
 * Legal reviews (D892), against the database: a lawyer's view on a point is kept as a new record, the newest shown with who wrote it and how
 * many came before; a point or review that does not exist, an empty or too long view, and the platform's other roles are refused.
 */

const run = Date.now().toString(36);

async function account(email: string, platformAdmin: boolean, platformRole: string | null): Promise<Account> {
  const [row] = await db().execute<{ id: string }>(
    sql`insert into commerce.accounts (email, name, platform_admin, platform_role) values (${email}, 'Lena', ${platformAdmin}, ${platformRole}) returning id`,
  );
  return { id: row.id, email, name: "Lena", platformAdmin, platformRole } as Account;
}

describe("Legal reviews (D892)", () => {
  it("reads the draft from the repository", () => {
    expect(reviewText("outreach-rules")).toContain("Contacting businesses by country");
    expect(reviewText("admin-use")).toContain("Questions for the lawyer");
    expect(reviewText("nothing")).toBeNull();
  });

  it("keeps each view as a record, shows the newest per point, and refuses what it should", async () => {
    const lawyer = await account(`legal-${run}@example.com`, false, "legal");
    const owner = await account(`legal-owner-${run}@example.com`, true, null);
    const support = await account(`legal-support-${run}@example.com`, false, "support");
    await db().execute(sql`delete from commerce.platform_legal_views where review = 'outreach-rules' and item in ('NO', 'q2')`);

    expect(await saveView(lawyer, "outreach-rules", "NO", "  Reading confirmed.\r\nSee § 15.  ")).toEqual({ ok: true });
    expect(await saveView(owner, "outreach-rules", "NO", "Thanks, rows moved.")).toEqual({ ok: true });
    expect(await saveView(lawyer, "outreach-rules", "q2", "Leave sole traders out.")).toEqual({ ok: true });

    expect(await saveView(support, "outreach-rules", "NO", "No")).toEqual({ ok: false, problem: "missing" });
    expect(await saveView(lawyer, "outreach-rules", "XX", "No")).toEqual({ ok: false, problem: "missing" });
    expect(await saveView(lawyer, "nothing", "NO", "No")).toEqual({ ok: false, problem: "missing" });
    expect(await saveView(lawyer, "outreach-rules", "NO", "   ")).toEqual({ ok: false, problem: "empty" });
    expect(await saveView(lawyer, "outreach-rules", "NO", "x".repeat(4001))).toEqual({ ok: false, problem: "long" });

    const views = await latestViews("outreach-rules");
    const no = views.find((v) => v.item === "NO");
    expect(no).toMatchObject({ view: "Thanks, rows moved.", by: "Lena", earlier: 1 });
    expect(views.find((v) => v.item === "q2")).toMatchObject({ view: "Leave sole traders out.", earlier: 0 });

    const [first] = await db().execute<{ view: string }>(
      sql`select view from commerce.platform_legal_views where review = 'outreach-rules' and item = 'NO' and account_id = ${lawyer.id}::uuid`,
    );
    expect(first.view).toBe("Reading confirmed.\nSee § 15.");
    const [audited] = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from commerce.audit_log where account_id = ${lawyer.id}::uuid and action = 'platform.legal_view_saved'`,
    );
    expect(audited.n).toBe(2);
  });
});
