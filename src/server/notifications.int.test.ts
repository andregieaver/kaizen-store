import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const notifications = await import("./notifications");
const { markSent } = await import("./order-admin");
const { sendOrderConfirmation, sendShipped, sendRefunded, sendCancelled } = await import("./shopper-emails");
const { fxStore, paidOrder, mailsOf, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * Customer notifications (wave 3, D238, `docs/wave-3-notifications.md` 2.1, 2.2, 4.1, 4.2 and 6.1), against a real database: the switch per event (a switched-off
 * email is never written to `email_messages`, a required one cannot be switched off), the owner's subject, heading and text per language with named
 * placeholders (checked before saving, nothing written on a refusal), the fixed text of the order's language as the fallback per slot and per language, the
 * preview with the sample order, the test email to oneself (ten an hour), and the order's own currency in a euro view.
 */

let store: Fx;
let other: Fx;

const ship = async (fx: Fx, orderId: string) => {
  const sent = await markSent(fx.storeId, orderId, { carrier: "bring", trackingNumber: `TN${Date.now()}${Math.random().toString(36).slice(2, 6)}`, trackingUrl: null }, fx.accountId);
  if (!sent.ok) throw new Error(sent.reason);
  return sent.shipment;
};

beforeAll(async () => {
  store = await fxStore("notify");
  other = await fxStore("notify-other");
});
afterAll(async () => {
  await closeDb();
});

describe("switches (2.1, 4.1)", () => {
  it("refuses to switch a required email off, and the database refuses it too", async () => {
    const result = await notifications.setNotification(store.storeId, "order.confirmation", false, store.accountId);
    expect(result).toMatchObject({ ok: false, problem: "required" });
    await expect(
      db().execute(sql`insert into commerce.notification_settings (store_id, notification, enabled) values (${store.storeId}::uuid, 'return.acknowledgement', false)`),
    ).rejects.toThrow();
    expect(await notifications.notificationOn(store.storeId, "order.confirmation")).toBe(true);
    expect(await notifications.setNotification(store.storeId, "order.unknown", false, store.accountId)).toMatchObject({ ok: false, problem: "unknown" });
  });

  it("starts with the carrier-event emails off and the rest on", async () => {
    expect(await notifications.notificationOn(store.storeId, "order.parcel_out_for_delivery")).toBe(false);
    expect(await notifications.notificationOn(store.storeId, "order.parcel_delivered")).toBe(false);
    expect(await notifications.notificationOn(store.storeId, "order.sent")).toBe(true);
    const states = await notifications.notificationStates(store.storeId);
    expect(states["order.refunded"]).toBe(true);
    expect(states["order.parcel_delivered"]).toBe(false);
  });

  it("sends no shipped email while it is switched off, whatever the caller asked, and sends it again once it is on", async () => {
    expect(await notifications.setNotification(store.storeId, "order.sent", false, store.accountId)).toEqual({ ok: true, enabled: false });
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const shipment = await ship(store, order.orderId);
    expect(await sendShipped(store.storeId, order.orderId, shipment)).toBeNull();
    expect(await mailsOf(order.orderId, "order.sent")).toHaveLength(0);
    // *Send again* is an action email (1.3): sent whatever the switch says.
    expect(await sendShipped(store.storeId, order.orderId, shipment, { resend: true })).toBe("logged");
    expect(await mailsOf(order.orderId, "order.sent")).toHaveLength(1);

    expect(await notifications.setNotification(store.storeId, "order.sent", true, store.accountId)).toEqual({ ok: true, enabled: true });
    const later = await paidOrder(store, [["DEMO-TOTE", 1]]);
    expect(await sendShipped(store.storeId, later.orderId, await ship(store, later.orderId))).toBe("logged");
    expect(await mailsOf(later.orderId, "order.sent")).toHaveLength(1);

    const [entry] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'notification.switched' order by id desc limit 1
    `);
    expect(entry.details).toEqual({ notification: "order.sent", enabled: true });
  });

  it("does not send a cancelled email switched off; another store's switch changes nothing here", async () => {
    await notifications.setNotification(other.storeId, "order.cancelled", false, other.accountId);
    expect(await notifications.notificationOn(store.storeId, "order.cancelled")).toBe(true);
    const order = await paidOrder(other, [["DEMO-TOTE", 1]]);
    expect(await sendCancelled(other.storeId, order.orderId, order.totalMinor)).toBeNull();
    expect(await mailsOf(order.orderId, "order.cancelled")).toHaveLength(0);
  });
});

describe("templates (2.1, 4.2)", () => {
  it("refuses a claim, an unknown placeholder, an address and a locked email, and writes nothing", async () => {
    const claim = await notifications.saveTemplate(store.storeId, "order.sent", "nb", { subject: "Beste pris i hele Norge! {order_number}" }, store.accountId);
    expect(claim).toMatchObject({ ok: false, problem: "invalid" });
    if (!claim.ok && claim.problem === "invalid") expect(claim.problems.map((p) => p.code)).toContain("claim");
    const unknown = await notifications.saveTemplate(store.storeId, "order.sent", "nb", { subject: "Ordre {order_number} til {customer_email}" }, store.accountId);
    expect(unknown).toMatchObject({ ok: false, problem: "invalid" });
    if (!unknown.ok && unknown.problem === "invalid") expect(unknown.problems.map((p) => p.code)).toContain("unknown_placeholder");
    const address = await notifications.saveTemplate(store.storeId, "order.sent", "nb", { body: "Les mer på www.example.com" }, store.accountId);
    expect(address).toMatchObject({ ok: false, problem: "invalid" });
    expect(await notifications.saveTemplate(store.storeId, "return.acknowledgement", "nb", { subject: "Hei" }, store.accountId)).toMatchObject({ ok: false, problem: "locked" });
    expect(await notifications.saveTemplate(store.storeId, "order.sent", "fi", { subject: "Hei {order_number}" }, store.accountId)).toMatchObject({ ok: false, problem: "language" });
    expect(await notifications.getTemplate(store.storeId, "order.sent", "nb")).toBeNull();
  });

  it("uses a Norwegian template for a Norwegian order and the Swedish fixed text for a Swedish one of the same store", async () => {
    const saved = await notifications.saveTemplate(
      store.storeId,
      "order.sent",
      "nb",
      { subject: "Pakken med {order_number} er på vei", heading: "Hei {customer_first_name}!", body: "{carrier} har pakken din ({tracking_number})." },
      store.accountId,
    );
    expect(saved).toEqual({ ok: true, slots: ["subject", "heading", "body"], deleted: false });
    const nb = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set shipping_address = jsonb_set(coalesce(shipping_address, '{}'::jsonb), '{name}', '"Kari Nordmann"') where id = ${nb.orderId}::uuid`);
    const shipment = await ship(store, nb.orderId);
    await sendShipped(store.storeId, nb.orderId, shipment);
    const [mail] = await mailsOf(nb.orderId, "order.sent");
    expect(mail.subject).toBe(`Pakken med ${nb.number} er på vei`);
    expect(String(mail.text)).toContain("Hei Kari!");
    expect(String(mail.text)).toContain(`${shipment.carrier} har pakken din (${shipment.trackingNumber}).`);
    // Everything the law and the money need is still the code's: the tracking line and the right of withdrawal follow the owner's words.
    expect(String(mail.text)).toMatch(/angre/i);

    const sv = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set locale = 'sv-SE' where id = ${sv.orderId}::uuid`);
    await sendShipped(store.storeId, sv.orderId, await ship(store, sv.orderId));
    const [svMail] = await mailsOf(sv.orderId, "order.sent");
    expect(svMail.subject).toBe(`Order ${sv.number} från Fx har skickats`);
  });

  it("falls back per slot: a template with only a subject keeps the fixed heading and intro", async () => {
    await notifications.saveTemplate(store.storeId, "order.refunded", "nb", { subject: "Pengene for {order_number} er på vei tilbake" }, store.accountId);
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await sendRefunded(store.storeId, order.orderId, crypto.randomUUID(), 1000);
    const [mail] = await mailsOf(order.orderId, "order.refunded");
    expect(mail.subject).toBe(`Pengene for ${order.number} er på vei tilbake`);
    expect(String(mail.text)).toContain("Vi har refundert deg");
  });

  it("keeps the order's own currency in a euro view, in the order's language", async () => {
    await notifications.saveTemplate(store.storeId, "order.confirmation", "nb", { subject: "Takk! Du betalte {order_total} for {order_number}" }, store.accountId);
    const order = await paidOrder(store, [["DEMO-TOTE", 2]], { market: NO_EUR });
    expect(order.currency).toBe("EUR");
    await sendOrderConfirmation(store.storeId, order.orderId);
    const [mail] = await mailsOf(order.orderId, "order.confirmation");
    expect(mail.subject).toBe(`Takk! Du betalte ${formatMoney(order.totalMinor, "EUR", "nb-NO")} for ${order.number}`);
    expect(String(mail.subject)).toContain("€");
  });

  it("lists which languages have the store's own text, and *Use standard text* deletes the language's template", async () => {
    const list = await notifications.listNotifications(store.storeId);
    const sent = list.find((n) => n.def.id === "order.sent")!;
    expect(sent.status).toBe("on");
    expect(sent.languages.find((l) => l.lang === "nb")).toMatchObject({ own: true, offered: true });
    expect(sent.languages.find((l) => l.lang === "sv")).toMatchObject({ own: false });
    expect(list.find((n) => n.def.id === "return.acknowledgement")!.status).toBe("fixed");
    expect(list.find((n) => n.def.id === "order.confirmation")!.status).toBe("always");

    expect(await notifications.resetTemplate(store.storeId, "order.refunded", "nb", store.accountId)).toEqual({ ok: true });
    expect(await notifications.getTemplate(store.storeId, "order.refunded", "nb")).toBeNull();
    // Saving three empty slots deletes it too.
    await notifications.saveTemplate(store.storeId, "order.cancelled", "nb", { subject: "Avbestilt {order_number}" }, store.accountId);
    expect(await notifications.saveTemplate(store.storeId, "order.cancelled", "nb", { subject: "  ", heading: "", body: null }, store.accountId)).toEqual({ ok: true, slots: [], deleted: true });
    const audits = await db().execute<Row>(sql`
      select action, details from commerce.audit_log where store_id = ${store.storeId}::uuid and action like 'notification.template_%' order by id
    `);
    expect(audits.map((a) => a.action)).toContain("notification.template_reset");
    // Never the words.
    for (const a of audits) expect(JSON.stringify(a.details)).not.toMatch(/på vei|Avbestilt/);
  });

  it("another store's templates are never read", async () => {
    const order = await paidOrder(other, [["DEMO-TOTE", 1]]);
    await sendShipped(other.storeId, order.orderId, await ship(other, order.orderId));
    const [mail] = await mailsOf(order.orderId, "order.sent");
    expect(mail.subject).toBe(`Ordre ${order.number} fra Fx er sendt`);
  });
});

describe("preview and test email (2.1 points 3 and 4)", () => {
  it("draws the draft with the sample order, lists its problems and draws a slot with a problem as the fixed text", async () => {
    const preview = await notifications.previewNotification(store.storeId, "order.confirmation", "nb", { subject: "Kvittering {order_number}", body: "Beste pris i hele Norge!" });
    expect(preview).not.toBeNull();
    expect(preview!.email.subject).toBe("Kvittering 1001");
    expect(preview!.problems.some((p) => p.slot === "body")).toBe(true);
    expect(preview!.email.text).toContain(preview!.standard.intro);
    expect(preview!.email.text).toContain("Sample product");
    expect(preview!.email.text).toContain(formatMoney(preview!.sample.totalMinor, "NOK", "nb-NO"));
  });

  it("sends the test to the person's own address, prefixed [Test], at most ten an hour", async () => {
    const account = { id: store.accountId, email: `owner-${store.slug}@example.com` };
    const at = new Date("2030-01-01T10:15:00Z");
    for (let i = 0; i < notifications.TESTS_PER_HOUR; i++) {
      const sent = await notifications.sendTestNotification(store.storeId, "order.sent", "nb", null, account, at);
      expect(sent).toMatchObject({ ok: true });
    }
    const refused = await notifications.sendTestNotification(store.storeId, "order.sent", "nb", null, account, at);
    expect(refused).toMatchObject({ ok: false, problem: "limit" });
    const mails = await db().execute<Row>(sql`
      select to_address, subject from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'notification.test'
    `);
    expect(mails).toHaveLength(notifications.TESTS_PER_HOUR);
    for (const m of mails) {
      expect(m.to_address).toBe(account.email);
      expect(String(m.subject).startsWith("[Test] ")).toBe(true);
    }
  });
});
