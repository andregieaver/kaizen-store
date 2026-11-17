import { describe, expect, it } from "vitest";

import { customersEn } from "./admin-messages/customers.en";
import { customersNb } from "./admin-messages/customers.nb";
import { emailListLine, textsLine } from "./customer-marketing";

const w = customersEn.customer.marketing;
const date = (iso: string) => iso.slice(0, 10);
const base = "/admin/kaffe";
const ID = "0b9d2c1e-5a4f-4c3b-9e8d-7f6a5b4c3d2e";

describe("the store's marketing on a customer's page (ecosystem plan E2.4, D713)", () => {
  it("says where they are on the email list, linked to their subscriber, and that they are not on it without a row", () => {
    expect(emailListLine({ id: ID, status: "subscribed", since: "2026-11-02T09:00:00.000Z" }, base, w, date)).toEqual({
      text: "Gets your emails, since 2026-11-02",
      href: `/admin/kaffe/subscribers/${ID}`,
    });
    expect(emailListLine({ id: ID, status: "pending", since: "2026-11-01T08:00:00.000Z" }, base, w, date).text).toBe("Asked for your emails 2026-11-01, has not confirmed yet");
    expect(emailListLine({ id: ID, status: "unsubscribed", since: "2026-11-04T07:00:00.000Z" }, base, w, date).text).toBe("Unsubscribed 2026-11-04");
    expect(emailListLine(null, base, w, date)).toEqual({ text: "Not on your list", href: null });
  });

  it("says their number's consent to texts, masked, linked to Text messages; nothing while the store never texted", () => {
    const number = { status: "subscribed" as const, phone: "+47 ••• 567", since: "2026-11-03T10:00:00.000Z" };
    expect(textsLine({ offered: true, number }, base, w, date)).toEqual({ text: "Gets your texts at +47 ••• 567, since 2026-11-03", href: "/admin/kaffe/text-messages" });
    expect(textsLine({ offered: true, number: { ...number, status: "pending" } }, base, w, date)?.text).toBe("Said yes to texts at +47 ••• 567 2026-11-03, once the order is paid");
    // A number kept from before the account was disconnected is still said.
    expect(textsLine({ offered: false, number: { ...number, status: "unsubscribed" } }, base, w, date)?.text).toBe("Stopped your texts 2026-11-03");
    expect(textsLine({ offered: true, number: null }, base, w, date)).toEqual({ text: "Not signed up", href: null });
    expect(textsLine({ offered: false, number: null }, base, w, date)).toBeNull();
  });

  it("has the same placeholders in Norwegian", () => {
    const nb = customersNb.customer.marketing;
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const status of ["subscribed", "pending", "unsubscribed"] as const) {
      expect(holes(nb.emailStatus[status]), status).toEqual(holes(w.emailStatus[status]));
      expect(holes(nb.textsStatus[status]), status).toEqual(holes(w.textsStatus[status]));
    }
  });
});
