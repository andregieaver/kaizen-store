import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { makeAccount } = await import("./trust-fixtures");
const { autoApproveDue, logIncident, saveAutoApprove } = await import("./incidents");

type Row = Record<string, unknown>;

/**
 * Small improvements approved automatically (D895 IA-19): only under the owner's rule, only a nightly proposal said to be small and clear
 * of every sensitive area, only once it waited unanswered, at most the rule's number a week, each approved as the rule's owner.
 */
const run = Date.now().toString(36);
let owner = "";
let before: Row | undefined;

const propose = async (name: string, evidence: Record<string, unknown>, hoursOld: number) => {
  const logged = await logIncident({ kind: "enhancement", source: "nightly", fingerprint: `nightly:zz-auto-${run}-${name}`, title: `Auto ${name}`, evidence });
  await db().execute(sql`update commerce.platform_incidents set created_at = now() - make_interval(hours => ${hoursOld}) where id = ${logged!.id}::uuid`);
  return logged!.id;
};
const statusOf = async (id: string) => (await db().execute<Row>(sql`select status from commerce.platform_incidents where id = ${id}::uuid`))[0].status;

beforeAll(async () => {
  [before] = await db().execute<Row>(sql`select auto_approve_on, auto_approve_wait_hours, auto_approve_per_week from commerce.platform_settings`);
  owner = (await makeAccount("auto-approve-owner", { platformAdmin: true })).id;
  await db().execute(sql`update commerce.platform_incidents set status = 'dismissed' where status = 'proposed' and source = 'nightly'`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`nightly:zz-auto-${run}-%`}`);
  await db().execute(sql`update commerce.platform_settings set auto_approve_on = ${Boolean(before?.auto_approve_on)}, auto_approve_by = null`);
  await closeDb();
});

describe("approving small improvements automatically", () => {
  it("approves nothing while the rule is off", async () => {
    const id = await propose("off", { size: "small", sensitive: false }, 30);
    expect(await autoApproveDue()).toBe(0);
    expect(await statusOf(id)).toBe("proposed");
    await db().execute(sql`update commerce.platform_incidents set status = 'dismissed' where id = ${id}::uuid`);
  });

  it("approves only a small, clear proposal that waited, as the rule's owner, up to the week's number", async () => {
    expect(await saveAutoApprove(owner, { on: true, waitHours: 24, perWeek: 2 })).toBe(true);
    expect(await saveAutoApprove(owner, { on: true, waitHours: 5, perWeek: 2 })).toBe(false);
    const small = await propose("small", { size: "small", sensitive: false }, 30);
    const large = await propose("large", { size: "large", sensitive: false }, 30);
    const sensitive = await propose("sensitive", { size: "small", sensitive: true }, 30);
    const unsaid = await propose("unsaid", {}, 30);
    const young = await propose("young", { size: "small", sensitive: false }, 2);
    const second = await propose("second", { size: "small", sensitive: false }, 29);
    const third = await propose("third", { size: "small", sensitive: false }, 28);

    expect(await autoApproveDue()).toBe(2);
    expect(await statusOf(small)).toBe("approved");
    expect(await statusOf(second)).toBe("approved");
    for (const id of [large, sensitive, unsaid, young, third]) expect(await statusOf(id), String(id)).toBe("proposed");
    const [event] = await db().execute<Row>(
      sql`select account_id, note from commerce.platform_incident_events where incident_id = ${small}::uuid and to_status = 'approved'`,
    );
    expect(event.account_id).toBe(owner);
    expect(String(event.note)).toContain("Approved automatically under your rule");
    // The week's number is spent: the third waits for the owner.
    expect(await autoApproveDue()).toBe(0);
    expect(await statusOf(third)).toBe("proposed");
  });
});
