import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { NOTIFICATIONS } from "@/lib/notifications";
import { STAFF_ALERT_EVENTS } from "@/lib/staff-alerts";
import type { NotificationListItem } from "@/server/notifications";
import type { StaffAlertsView } from "@/server/staff-alerts";

import { NotificationEditor, type EditorLanguage } from "./notification-editor";
import { NotificationList } from "./notification-list";
import { StaffAlertsFailedNote } from "./staff-alerts-failed";
import { StaffAlertsForm } from "./staff-alerts-form";

const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const BAD = /\bNaN\b|undefined|\[object/;

/** Every notification as the server lists it: required ones always on, the two carrier emails off by default, an nb text on *Order sent*. */
function items(): NotificationListItem[] {
  return NOTIFICATIONS.map((def) => {
    const enabled = def.required || def.defaultOn;
    return {
      def,
      enabled,
      status: !def.editable ? "fixed" : def.required ? "always" : enabled ? "on" : "off",
      languages: [
        { lang: "nb", offered: true, own: def.id === "order.sent", slots: def.id === "order.sent" ? ["subject"] : [], invalid: false },
        { lang: "en", offered: true, own: false, slots: [], invalid: false },
      ],
    } satisfies NotificationListItem;
  });
}

const action = async () => ({ status: "ok" as const, messages: [] });

describe("the Notifications list (D238, 2.1 point 1)", () => {
  it("lists every email in its group, with a switch only where one may be switched", () => {
    const html = plain(renderToString(h(NotificationList, { items: items(), base: "/admin/kaffe/settings/notifications", switchAction: () => action, handovers: true })));
    expect(html).not.toMatch(BAD);
    for (const group of ["Orders", "Pickup and local delivery", "Returns"]) expect(html).toContain(group);
    for (const def of NOTIFICATIONS) expect(html).toContain(def.label);
    // The required ones have no switch, the others one each.
    const switches = html.match(/Switch (off|on)<span class="sr-only">/g) ?? [];
    expect(switches).toHaveLength(NOTIFICATIONS.filter((n) => !n.required).length);
    expect(html).toContain("Always on");
    expect(html).toContain("Fixed");
    expect(html).not.toContain("Switch off<span class=\"sr-only\"> Order confirmation");
    // The carrier emails start off.
    expect(html).toContain("Switch on<span class=\"sr-only\"> Out for delivery (carrier)");
    // Languages: the store's own text, or the standard one.
    expect(html).toContain("Norwegian Bokmål: your text");
    expect(html).toContain("English: standard text");
    expect(html).toContain('href="/admin/kaffe/settings/notifications/order-sent"');
  });

  it("only reads for someone who may not change settings, and says when pickup and local delivery are not offered", () => {
    const html = plain(renderToString(h(NotificationList, { items: items(), base: "/admin/kaffe/settings/notifications", switchAction: null, handovers: false })));
    expect(html).not.toMatch(/Switch (off|on)/);
    expect(html).toContain("The store offers no pickup or local delivery yet");
  });
});

const languages: EditorLanguage[] = [
  { lang: "nb", label: "Norwegian Bokmål", offered: true, saved: { subject: "Pakken din fra {store_name} er på vei", heading: null, body: null }, standard: { subject: "Ordre 1001 er sendt", heading: "Pakken er på vei", intro: "Ordre 1001 er sendt." } },
  { lang: "en", label: "English", offered: true, saved: null, standard: { subject: "Order 1001 has been sent", heading: "On its way", intro: "Order 1001 has been sent." } },
];
const editorActions = {
  preview: async () => ({ ok: true as const, subject: "s", html: "<p>h</p>", problems: [] }),
  save: async () => ({ ok: true as const, message: "Saved.", deleted: false }),
  reset: async () => ({ ok: true, message: "ok" }),
  test: async () => ({ ok: true, message: "ok" }),
};

describe("the notification editor (D238, 2.1 points 2 to 6)", () => {
  it("shows the saved words, the standard text as each field's placeholder, the placeholders and the preview", () => {
    const html = plain(renderToString(h(NotificationEditor, { id: "order.sent", languages, initialLang: "nb", initialPreview: { subject: "Pakken din fra Kaffe er på vei", html: "<p>preview</p>" }, actions: editorActions })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain('value="Pakken din fra {store_name} er på vei"');
    expect(html).toContain('placeholder="Pakken er på vei"');
    expect(html).toContain('placeholder="Ordre 1001 er sendt."');
    for (const name of ["{store_name}", "{order_number}", "{customer_first_name}", "{carrier}", "{tracking_number}"]) expect(html).toContain(name);
    expect(html).not.toContain("{refund_amount}");
    expect(html).toContain("Do not add offers or advertising");
    expect(html).toContain("always added by Kaizena Flow");
    expect(html).toContain("Use standard text");
    expect(html).toContain("Send a test to me");
    expect(html).toContain('sandbox=""');
    expect(html).toContain("Subject:</span> Pakken din fra Kaffe er på vei");
  });

  it("shows a problem in the saved words and refuses to save while it is there", () => {
    const bad: EditorLanguage[] = [{ ...languages[1], saved: { subject: "Only today: {unknown}", heading: null, body: null } }];
    const html = plain(renderToString(h(NotificationEditor, { id: "order.sent", languages: bad, initialLang: "en", initialPreview: null, actions: editorActions })));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Saving is not possible while a field has a problem.");
  });

  it("never offers to edit the withdrawal acknowledgement", () => {
    const html = plain(renderToString(h(NotificationEditor, { id: "return.acknowledgement", languages, initialLang: "nb", initialPreview: null, actions: { ...editorActions, save: null, reset: null } })));
    expect(html).toContain("cannot be changed");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Save<");
  });

  it("is read-only without settings:write", () => {
    const html = plain(renderToString(h(NotificationEditor, { id: "order.sent", languages, initialLang: "en", initialPreview: null, actions: { preview: editorActions.preview, save: null, reset: null, test: null } })));
    expect(html).toContain("You can see this email but not change it.");
    expect(html).not.toContain("Send a test to me");
    expect(html).toMatch(/<input[^>]*readOnly=""|<input[^>]*readonly=""/);
  });
});

const view = (over: Partial<StaffAlertsView> = {}): StaffAlertsView => ({
  configured: false,
  members: [
    { accountId: "a1", name: "Ola Owner", email: "ola@example.com", owner: true, may: Object.fromEntries(STAFF_ALERT_EVENTS.map((e) => [e, true])) as StaffAlertsView["members"][number]["may"], events: ["new_order", "return_requested", "low_stock"] },
    { accountId: "a2", name: null, email: "kari@example.com", owner: false, may: Object.fromEntries(STAFF_ALERT_EVENTS.map((e) => [e, e === "low_stock"])) as StaffAlertsView["members"][number]["may"], events: [] },
  ],
  contact: { email: "post@kaffe.no", events: ["refund_overdue"] },
  summary: "off",
  summaryWeekday: 1,
  summaryHour: 8,
  ...over,
});

describe("the staff alerts form (D238, 2.4)", () => {
  it("offers a box only where the role may read the email, says the defaults hold, and takes no typed address", () => {
    const html = plain(renderToString(h(StaffAlertsForm, { view: view(), save: async () => ({ ok: true, message: "" }), test: async () => ({ ok: true, message: "" }) })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain("These are the defaults");
    expect(html).toContain("Needs Orders access");
    expect(html).toContain("Needs Analytics access");
    expect(html).toContain('aria-label="Low stock emails to kari@example.com"');
    expect(html).not.toContain('aria-label="New order emails to kari@example.com"');
    expect(html).toMatch(/aria-label="New order emails to Ola Owner"[^>]*checked=""|checked=""[^>]*aria-label="New order emails to Ola Owner"/);
    expect(html).toContain("post@kaffe.no");
    expect(html).not.toMatch(/type="email"/);
    expect(html).toContain("never carry the customer's name, email address, phone number or");
  });

  it("disables the contact address's boxes when the store has none", () => {
    const html = plain(renderToString(h(StaffAlertsForm, { view: view({ contact: null, configured: true }), save: async () => ({ ok: true, message: "" }), test: async () => ({ ok: true, message: "" }) })));
    expect(html).not.toContain("These are the defaults");
    expect(html).toContain("None set: add one under Company");
    expect(html.match(/disabled=""[^>]*aria-label="[^"]*the store's contact address"|aria-label="[^"]*the store's contact address"[^>]*disabled=""/g)).toHaveLength(STAFF_ALERT_EVENTS.length);
  });

  it("warns on Home only when alerts gave up", () => {
    expect(renderToString(h(StaffAlertsFailedNote, { failed: 0, href: "/x" }))).toBe("");
    expect(plain(renderToString(h(StaffAlertsFailedNote, { failed: 2, href: "/x" })))).toContain("Staff alerts could not be sent: 2 orders or returns");
  });
});
