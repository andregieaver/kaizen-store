import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import type { DoneInfo, OrderInfo } from "@/lib/withdraw-form";

import { CannotList, Carried, ConfirmSummary, DoneSummary, Field, WithdrawLines, errorList, fieldMessage, noticeText, windowNote } from "./withdraw-parts";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");

const A = "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b10";
const B = "7a2f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b11";
const C = "8b3f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b12";

const order: OrderInfo = {
  number: "1042",
  storeName: "Demo",
  contactEmail: "butikk@example.com",
  window: { state: "statutory", basis: "delivered", statutoryEndDay: "2026-10-16", voluntaryEndDay: "2026-10-16" },
  right: "withdrawal",
  subscription: false,
  timeZone: "Europe/Oslo",
  lines: [
    { lineId: A, title: "Lampe", quantity: 3, right: "withdrawal", max: 2, refusal: null, exclusion: null, sealed: false },
    { lineId: B, title: "Kopp med navn", quantity: 1, right: "none", max: 0, refusal: "excluded_by_law", exclusion: "custom_made", sealed: false },
    { lineId: C, title: "Nedlasting", quantity: 1, right: "none", max: 0, refusal: "digital_content", exclusion: null, sealed: false },
  ],
};

const LANGS = ["nb", "sv", "da", "en"] as const;

describe("the withdrawal form's pieces (D153)", () => {
  it("ticks every line that can be withdrawn, with its number, and labels both for screen readers", () => {
    const m = t("en").returns;
    const out = html(h(WithdrawLines, { m, lines: order.lines, picked: null }));
    expect(out).toContain(`name="take:${A}"`);
    expect(out).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(out).toContain('aria-label="Withdraw from Lampe"');
    expect(out).toContain(`name="qty:${A}"`);
    expect(out).toContain('max="2"');
    expect(out).toContain('value="2"');
    expect(out).toContain("Number of Lampe");
    expect(out).toContain("of 2");
    // A line the law excludes is not offered as a choice.
    expect(out).not.toContain(B);
  });

  it("keeps the shopper's own choice when shown again: an unticked line stays unticked, a lower number stays", () => {
    const m = t("en").returns;
    const lines = [...order.lines, { lineId: "x", title: "Vase", quantity: 2, right: "withdrawal" as const, max: 2, refusal: null, exclusion: null, sealed: false }];
    const out = html(h(WithdrawLines, { m, lines, picked: { [A]: 1 } }));
    const vase = out.slice(out.indexOf('id="take-x"'), out.indexOf('id="take-x"') + 150);
    expect(vase).not.toContain('checked=""');
    const lamp = out.slice(out.indexOf(`id="qty-${A}"`), out.indexOf(`id="qty-${A}"`) + 400);
    expect(lamp).toContain('value="1"');
  });

  it("offers sealed goods as a withdrawal with the condition that the seal is unbroken, in every language", () => {
    for (const lang of LANGS) {
      const m = t(lang).returns;
      const sealed = { lineId: "s", title: "Hudkrem", quantity: 1, right: "withdrawal" as const, max: 1, refusal: null, exclusion: "sealed_hygiene", sealed: true };
      const out = html(h(WithdrawLines, { m, lines: [sealed], picked: null }));
      expect(out).toContain('name="take:s"');
      expect(out).toContain(m.sealedLine);
      // A line that is not sealed carries no such note.
      expect(html(h(WithdrawLines, { m, lines: [order.lines[0]], picked: null }))).not.toContain(m.sealedLine);
      // The exclusion's label says the right lasts until the seal is broken.
      expect(m.exclusions.sealed_hygiene).toMatch(/\(.+\)/);
      expect(m.exclusions.sealed_media).toMatch(/\(.+\)/);
    }
  });

  it("says there is nothing to send back, and nothing to wait for, when the withdrawal came before the goods were sent", () => {
    const m = t("en").returns;
    const done: DoneInfo = {
      requestId: A,
      orderNumber: "1042",
      confirmedAt: "2026-10-02T20:30:00.000Z",
      sendBackBy: "2026-10-16",
      refundBy: "2026-10-16T20:30:00.000Z",
      timeZone: "Europe/Oslo",
      reference: "1042-R1",
      sent: true,
      email: "owner@example.com",
      nothingSent: true,
      text: null,
      returns: [],
    };
    const out = html(h(DoneSummary, { m, done, locale: "en-GB", base: "/s/demo/no" }));
    expect(out).toContain(m.done.nothingSent);
    expect(out).not.toContain("Send the goods back no later than");
    expect(out).not.toContain(m.done.refundWait);
    expect(out).toContain("The store refunds you no later than 16 October 2026.");
    // For goods that were sent, the hold and the send-back day are still said.
    const sent = html(h(DoneSummary, { m, done: { ...done, nothingSent: false }, locale: "en-GB", base: "/s/demo/no" }));
    expect(sent).toContain("Send the goods back no later than");
    expect(sent).toContain(m.done.refundWait);
    expect(sent).not.toContain(m.done.nothingSent);
  });

  it("says why a line cannot be withdrawn, in the shopper's words, and names the exclusion", () => {
    for (const lang of LANGS) {
      const m = t(lang).returns;
      const out = html(h(CannotList, { m, lines: order.lines }));
      expect(out).toContain("Kopp med navn");
      expect(out).toContain(m.refusal.excluded_by_law);
      expect(out).toContain(m.exclusions.custom_made);
      expect(out).toContain(m.refusal.digital_content);
      expect(out).toContain(m.cannotHeading);
    }
    expect(renderToString(h(CannotList, { m: t("en").returns, lines: [order.lines[0]] }))).toBe("");
  });

  it("lists exactly what was declared in step 2 and says nothing is withdrawn before the button", () => {
    const m = t("en").returns;
    const out = html(h(ConfirmSummary, { m, request: { orderNumber: "1042", lines: [{ lineId: A, title: "Lampe", quantity: 2 }] } }));
    expect(out).toContain("Lampe");
    expect(out).toContain("× 2");
    expect(out).toContain("Nothing is withdrawn until you press Confirm withdrawal.");
  });

  it("shows the acknowledgement and its reference on the confirmation, and a link to the status page", () => {
    const done: DoneInfo = {
      requestId: A,
      orderNumber: "1042",
      confirmedAt: "2026-10-02T20:30:00.000Z",
      sendBackBy: "2026-10-16",
      refundBy: "2026-10-16T20:30:00.000Z",
      timeZone: "Europe/Oslo",
      reference: "1042-R1",
      sent: true,
      email: "kari@example.com",
      nothingSent: false,
      text: "Dear Kari,\nWe have received your withdrawal.",
      returns: [{ number: "1042-R1", token: "a".repeat(64) }],
    };
    const out = html(h(DoneSummary, { m: t("en").returns, done, locale: "en-GB", base: "/s/demo/no" }));
    expect(out).toContain("1042-R1");
    expect(out).toContain("We have sent an acknowledgement to kari@example.com.");
    expect(out).toContain("Dear Kari,");
    expect(out).toContain("UTC+02:00");
    expect(out).toContain("Send the goods back no later than 16 October 2026.");
    expect(out).toContain(`href="/s/demo/no/returns/${"a".repeat(64)}"`);
    // When the email could not go out the withdrawal still stands, and the page says so.
    const notSent = html(h(DoneSummary, { m: t("en").returns, done: { ...done, sent: false }, locale: "en-GB", base: "/s/demo/no" }));
    expect(notSent).toContain("The withdrawal stands and the store has it.");
    expect(notSent).not.toContain("We have sent an acknowledgement");
  });

  it("carries who is asking and how the order was proven in hidden fields, so no cookie or storage is needed", () => {
    const out = html(h(Carried, { values: { name: 'Kari "K" Nordmann', email: "kari@example.com", orderNumber: "1042" }, orderKey: "cs_123" }));
    expect(out).toContain('name="orderKey"');
    expect(out).toContain('value="cs_123"');
    expect(out).toContain('value="Kari "K" Nordmann"'.replace(/"K"/, "&quot;K&quot;").replace(/&quot;/g, '"'));
    expect(renderToString(h(Carried, { values: { name: "a", email: "b@c.de", orderNumber: "1" }, orderKey: null }))).not.toContain("orderKey");
  });

  it("ties a field's hint and error to its input and marks it invalid", () => {
    const out = html(
      h(Field, { name: "email", label: "Email", hint: "The address you bought with.", error: "Write a valid email address.", children: (props) => h("input", { ...props, name: "email" }) }),
    );
    expect(out).toContain('for="field-email"');
    expect(out).toContain('aria-describedby="field-email-hint field-email-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="field-email-error"');
    const plain = html(h(Field, { name: "x", label: "X", children: (props) => h("input", props) }));
    expect(plain).not.toContain("aria-describedby");
    expect(plain).not.toContain("aria-invalid");
  });
});

describe("what the form says, in every language", () => {
  it("answers a statement that matches no order with the same words every time, and says where to turn", () => {
    for (const lang of LANGS) {
      const m = t(lang).returns;
      const a = noticeText(m, "unmatched", { storeName: "Demo", email: "butikk@example.com" });
      expect(a).toEqual(noticeText(m, "unmatched", { storeName: "Demo", email: "butikk@example.com" }));
      expect(a.text).toBe(m.unmatched);
      // It is information, not an alarm.
      expect(a.urgent).toBe(false);
      expect(a.help).toContain("butikk@example.com");
      expect(a.help).toContain(m.unmatchedHelp);
    }
    expect(noticeText(t("en").returns, "unmatched", { storeName: "Demo", email: null }).help).toContain("Contact Demo");
  });

  it("reads real problems at once", () => {
    const m = t("en").returns;
    for (const notice of ["limited", "nothing", "lapsed", "not_available", "quantity", "failed"] as const) {
      expect(noticeText(m, notice, { storeName: "Demo", email: null }).urgent).toBe(true);
    }
  });

  it("has a sentence for every code the checks fail with", () => {
    for (const lang of LANGS) {
      const m = t(lang).returns;
      for (const code of ["required", "email", "too_long", "lines", "quantity", "reason", "unknown"]) {
        expect(fieldMessage(m, code), `${lang} ${code}`).toBe((m.fieldErrors as Record<string, string>)[code]);
        expect(fieldMessage(m, code)).toBeTruthy();
      }
      // A code nobody wrote a sentence for is a general failure, never the raw code.
      expect(fieldMessage(m, "made_up")).toBe(m.failed);
      expect(fieldMessage(m, undefined)).toBeNull();
    }
    expect(errorList(t("en").returns, { email: "email", lines: "lines" })).toEqual([
      { key: "email", text: "Email address: Write a valid email address." },
      { key: "lines", text: "What you withdraw from: Choose at least one item." },
    ]);
  });

  it("says where the order stands in time", () => {
    const m = t("en").returns;
    const o = (window: OrderInfo["window"]) => ({ storeName: "Demo", window });
    expect(windowNote(m, o({ state: "statutory", basis: "delivered", statutoryEndDay: "2026-10-16", voluntaryEndDay: "2026-10-16" }), "en-GB")).toBe("You can withdraw until 16 October 2026.");
    expect(windowNote(m, o({ state: "before_delivery", basis: "delivered", statutoryEndDay: null, voluntaryEndDay: null }), "en-GB")).toBe("The goods have not been sent yet. You can withdraw now.");
    expect(windowNote(m, o({ state: "voluntary", basis: "delivered", statutoryEndDay: "2026-10-16", voluntaryEndDay: "2026-11-15" }), "en-GB")).toBe(
      "The period the law gives you is over. Demo takes returns until 15 November 2026.",
    );
    expect(windowNote(m, o({ state: "closed", basis: "delivered", statutoryEndDay: "2026-09-01", voluntaryEndDay: "2026-09-01" }), "en-GB")).toContain("By our records the 14 days for withdrawing have passed");
    // Sent and not recorded as received: the 14 days have not started, and no end day is promised.
    expect(windowNote(m, o({ state: "statutory", basis: "sent", statutoryEndDay: null, voluntaryEndDay: null }), "en-GB")).toBe(
      "The goods have been sent. Your 14 days count from the day you receive them, and you can withdraw now.",
    );
    expect(windowNote(t("nb").returns, o({ state: "statutory", basis: "delivered", statutoryEndDay: "2026-10-16", voluntaryEndDay: "2026-10-16" }), "nb-NO")).toBe("Du kan angre til og med 16. oktober 2026.");
  });

  it("is hand-written in Norwegian, Swedish and Danish, not English left in place", () => {
    const en = t("en").returns;
    const keys = ["title", "startButton", "confirmButton", "footerLink", "orderLink", "unmatched", "nothing", "windowClosed", "noRefund"] as const;
    for (const lang of ["nb", "sv", "da"] as const) {
      const m = t(lang).returns;
      for (const key of keys) expect(m[key], `${lang}.${key}`).not.toBe(en[key]);
      for (const key of Object.keys(en.reasons) as (keyof typeof en.reasons)[]) expect(m.reasons[key], `${lang}.reasons.${key}`).not.toBe(en.reasons[key]);
      for (const key of Object.keys(en.refusal) as (keyof typeof en.refusal)[]) expect(m.refusal[key], `${lang}.refusal.${key}`).not.toBe(en.refusal[key]);
    }
    // The button is the function's own name in each language.
    expect(t("en").returns.startButton).toBe("Withdraw from contract here");
    expect(t("en").returns.confirmButton).toBe("Confirm withdrawal");
  });
});
