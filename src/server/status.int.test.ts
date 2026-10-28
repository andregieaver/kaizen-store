import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const status = await import("./status");

/**
 * The status page (D360) against a real database: checks kept per component measured (none for a component not measured), admins emailed
 * once at the second failure in a row, incidents posted and updated in order and emailed to confirmed subscribers only, a subscription
 * confirmed by its link and left by its own, and the feed carrying each update.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let admin: { id: string; email: string; name: string; platformAdmin: boolean };

const probes = (answers: Partial<Record<string, { ok: boolean; reason: string | null } | null>>): Parameters<typeof status.runStatusChecks>[0] =>
  Object.fromEntries(["website", "sign_in", "payments", "email", "jobs"].map((c) => [c, async () => (c in answers ? answers[c] : null)])) as never;

const emailsTo = async (to: string, kind: string) =>
  (await db().execute<Row>(sql`select text from commerce.email_messages where to_address = ${to} and kind = ${kind} order by created_at`)).map((r) => String(r.text));

beforeAll(async () => {
  await db().execute(sql`delete from commerce.status_checks`);
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`status-admin-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.status_checks`);
  await closeDb();
});

describe("the status page (D360)", () => {
  it("keeps a check per component measured and none for one not measured", async () => {
    const done = await status.runStatusChecks(probes({ website: { ok: true, reason: null }, jobs: { ok: true, reason: null } }));
    expect(done).toEqual({ measured: 2, failed: 0, alerts: 0 });
    const view = await status.readStatusOverview();
    const by = new Map(view.components.map((c) => [c.id, c]));
    expect(by.get("website")).toMatchObject({ state: "ok", uptime: 10000 });
    expect(by.get("payments")).toMatchObject({ state: "unknown", uptime: null });
    expect(by.get("website")!.bars).toHaveLength(90);
    expect(by.get("website")!.bars.at(-1)).toMatchObject({ ok: 1, total: 1, state: "ok" });
    expect(view.overall).toBe("ok");
  });

  it("emails platform admins once when a part fails twice in a row, and again only after it passed", async () => {
    const down = probes({ website: { ok: false, reason: "timeout" } });
    expect((await status.runStatusChecks(down)).alerts).toBe(0);
    expect((await status.runStatusChecks(down)).alerts).toBe(1);
    expect((await status.runStatusChecks(down)).alerts).toBe(0);
    expect(await emailsTo(admin.email, "platform.status_alert")).toHaveLength(1);
    expect((await status.readStatusOverview()).overall).toBe("degraded");
    await status.runStatusChecks(probes({ website: { ok: true, reason: null } }));
    await status.runStatusChecks(down);
    expect((await status.runStatusChecks(down)).alerts).toBe(1);
    expect(await emailsTo(admin.email, "platform.status_alert")).toHaveLength(2);
  });

  it("confirms a subscription by its link, emails incidents to confirmed subscribers only, and lets them leave", async () => {
    const confirmed = `listener-${run}@example.com`;
    const waiting = `waiting-${run}@example.com`;
    expect(await status.subscribeToStatus("not an address", "en")).toEqual({ ok: false });
    expect(await status.subscribeToStatus(confirmed, "nb")).toEqual({ ok: true });
    expect(await status.subscribeToStatus(waiting, "en")).toEqual({ ok: true });
    const [link] = await emailsTo(confirmed, "platform.status_confirm");
    const token = /\/status\/confirm\/([A-Za-z0-9_-]{43})/.exec(link)?.[1];
    expect(token).toBeTruthy();
    expect(link).toContain("/no/status/confirm/");
    expect(await status.confirmationWorks(token!)).toBe(true);
    expect(await status.confirmStatusSubscription(token!)).toBe(true);
    expect(await status.confirmStatusSubscription(token!)).toBe(false);

    const posted = await status.postIncident(admin as never, { title: "Slow checkout", titleNb: "Treg kasse", impact: "minor", components: ["payments", "nonsense"], body: "Payments take long." });
    if (!posted.ok) throw new Error(posted.problem);
    expect(posted.emailed).toBe(1);
    expect(await emailsTo(waiting, "platform.status_incident")).toHaveLength(0);
    const [sent] = await emailsTo(confirmed, "platform.status_incident");
    expect(sent).toContain("Treg kasse");
    expect(await status.postIncident(admin as never, { title: "", impact: "minor", components: ["website"], body: "x" })).toEqual({ ok: false, problem: "title" });
    expect(await status.postIncident(admin as never, { title: "x", impact: "minor", components: [], body: "x" })).toEqual({ ok: false, problem: "components" });

    expect(await status.updateIncident(admin as never, posted.id, { status: "resolved", body: "Fixed." })).toMatchObject({ ok: true, emailed: 1 });
    const [incident] = (await status.listIncidents()).filter((i) => i.id === posted.id);
    expect(incident).toMatchObject({ status: "resolved", components: ["payments"] });
    expect(incident.resolvedAt).not.toBeNull();
    expect(incident.updates.map((u) => u.status)).toEqual(["resolved", "investigating"]);

    const feed = await status.statusFeed("en");
    expect(feed).toContain("Resolved: Slow checkout");
    expect(feed).toContain("Investigating: Slow checkout");
    expect(await status.statusFeed("nb")).toContain("Løst: Treg kasse");

    const [{ unsubscribe_token }] = await db().execute<Row>(sql`select unsubscribe_token from commerce.status_subscribers where email = ${confirmed}`);
    expect(await status.unsubscribeWorks(String(unsubscribe_token))).toBe(true);
    expect(await status.unsubscribeFromStatus(String(unsubscribe_token))).toBe(true);
    expect(await status.unsubscribeWorks(String(unsubscribe_token))).toBe(false);
  });
});
