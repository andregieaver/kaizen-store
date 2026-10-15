import { describe, expect, it } from "vitest";

import { renderEmail, type EmailBlock } from "./email-layout";
import {
  BODY_LINES_MAX,
  FILLED_SUBJECT_MAX,
  PLACEHOLDERS,
  SLOT_LIMITS,
  cleanSlot,
  fillTemplate,
  filledSlots,
  templateProblems,
  withTemplate,
  type TemplateProblemCode,
} from "./email-template";
import { PLACEHOLDER_NAMES } from "./notifications";
import { sampleOrder, samplePlaceholders } from "./notification-sample";

const codes = (problems: { code: TemplateProblemCode }[]) => problems.map((p) => p.code);

describe("placeholders (4.2)", () => {
  it("describes every placeholder name", () => {
    expect(Object.keys(PLACEHOLDERS).sort()).toEqual([...PLACEHOLDER_NAMES].sort());
  });

  it("fills known values and leaves out unknown ones with the space before them", () => {
    expect(fillTemplate("Hi {customer_first_name}, order {order_number} from {store_name}", { customer_first_name: "Kari", order_number: "1001", store_name: "Bok" })).toBe(
      "Hi Kari, order 1001 from Bok",
    );
    expect(fillTemplate("Hi {customer_first_name}, thanks!", { customer_first_name: null })).toBe("Hi, thanks!");
    expect(fillTemplate("Hi {customer_first_name}", { customer_first_name: "  " })).toBe("Hi");
  });

  it("drops a line left with only punctuation, keeps blank paragraph breaks", () => {
    expect(fillTemplate("{customer_first_name},\n\nYour order is on its way.", { customer_first_name: null })).toBe("\nYour order is on its way.");
    expect(fillTemplate("One.\n\nTwo.", {})).toBe("One.\n\nTwo.");
  });

  it("reads no other syntax: double braces, tags and Liquid stay text", () => {
    expect(fillTemplate("{{order_number}}", { order_number: "7" })).toBe("{7}");
    expect(fillTemplate("{% if x %}<b>{order_number}</b>", { order_number: "7" })).toBe("{% if x %}<b>7</b>");
  });
});

describe("templateProblems() (4.2)", () => {
  it("accepts a plain template and empty slots", () => {
    expect(templateProblems({ subject: "Order {order_number} is on its way", heading: null, body: "" }, "order.sent")).toEqual([]);
    expect(templateProblems({}, "order.sent")).toEqual([]);
  });

  it("refuses a placeholder the notification does not have", () => {
    const problems = templateProblems({ body: "Refund {refund_amount} and {coupon}" }, "order.sent");
    expect(problems.map((p) => [p.code, p.detail])).toEqual([
      ["unknown_placeholder", "{refund_amount}"],
      ["unknown_placeholder", "{coupon}"],
    ]);
    expect(templateProblems({ body: "Refund {refund_amount}" }, "order.refunded")).toEqual([]);
  });

  it("refuses stray braces, Liquid and double braces", () => {
    expect(codes(templateProblems({ body: "Price {" }, "order.sent"))).toEqual(["stray_brace"]);
    expect(codes(templateProblems({ body: "{% if x %}hi{% endif %}" }, "order.sent"))).toContain("stray_brace");
    expect(codes(templateProblems({ body: "{{order_number}}" }, "order.sent"))).toEqual(["stray_brace"]);
    expect(codes(templateProblems({ body: "{Order}" }, "order.sent"))).toEqual(["stray_brace"]);
  });

  it("refuses web addresses in every spelling", () => {
    for (const text of ["See https://example.com/x", "Visit www.example.no", "Go to shop.example.com today", "kaizen.store", "Mer på butikk.no."]) {
      expect([text, codes(templateProblems({ body: text }, "order.sent"))]).toEqual([text, ["address"]]);
    }
    // A full stop between words is no address, nor is an email-like word part, nor a number with a decimal.
    expect(templateProblems({ body: "Thanks. See you soon. It costs 2.50 in fees? No: it is 2.no." }, "order.sent").filter((p) => p.code === "address")).toEqual([
      expect.objectContaining({ detail: "2.no" }),
    ]);
    expect(templateProblems({ body: "Takk for handelen. Vi sees!" }, "order.sent")).toEqual([]);
  });

  it("refuses too long slots, a second line in the subject or heading and more than 20 lines of text", () => {
    expect(codes(templateProblems({ subject: "x".repeat(SLOT_LIMITS.subject + 1) }, "order.sent"))).toEqual(["too_long"]);
    expect(templateProblems({ subject: "x".repeat(SLOT_LIMITS.subject) }, "order.sent")).toEqual([]);
    expect(codes(templateProblems({ heading: "x".repeat(SLOT_LIMITS.heading + 1) }, "order.sent"))).toEqual(["too_long"]);
    expect(codes(templateProblems({ body: "x".repeat(SLOT_LIMITS.body + 1) }, "order.sent"))).toEqual(["too_long"]);
    expect(codes(templateProblems({ heading: "One\nTwo" }, "order.sent"))).toEqual(["too_many_lines"]);
    expect(templateProblems({ body: Array.from({ length: BODY_LINES_MAX }, () => "a").join("\n") }, "order.sent")).toEqual([]);
    expect(codes(templateProblems({ body: Array.from({ length: BODY_LINES_MAX + 1 }, () => "a").join("\n") }, "order.sent"))).toEqual(["too_many_lines"]);
    // Counted in characters, not UTF-16 units.
    expect(templateProblems({ subject: "😀".repeat(SLOT_LIMITS.subject) }, "order.sent")).toEqual([]);
  });

  it("refuses a subject or heading that would be empty without its placeholders", () => {
    expect(codes(templateProblems({ subject: "{customer_first_name}" }, "order.sent"))).toEqual(["empty_after_fill"]);
    expect(codes(templateProblems({ heading: "{order_number}!" }, "order.sent"))).toEqual(["empty_after_fill"]);
    expect(templateProblems({ subject: "Order {order_number}" }, "order.sent")).toEqual([]);
    // The text block may be only a placeholder line among others.
    expect(templateProblems({ body: "{customer_first_name}" }, "order.sent")).toEqual([]);
  });

  it("refuses claims, but not a money placeholder", () => {
    const problems = templateProblems({ body: "Only 3 left! Our lowest price ever, and sustainable too. Save 100 kr." }, "order.sent");
    expect(problems.every((p) => p.code === "claim")).toBe(true);
    expect(problems.map((p) => p.claim).sort()).toEqual(["bestPrice", "green", "price", "urgency"]);
    expect(templateProblems({ body: "You paid {order_total}." }, "order.confirmation")).toEqual([]);
  });

  it("refuses control and invisible characters", () => {
    expect(codes(templateProblems({ body: "a\u0007b" }, "order.sent"))).toEqual(["control"]);
    expect(codes(templateProblems({ body: "a\u200bb" }, "order.sent"))).toEqual(["control"]);
    expect(codes(templateProblems({ body: "a\u202eb" }, "order.sent"))).toEqual(["control"]);
    expect(templateProblems({ body: "Line one\r\nLine two" }, "order.sent")).toEqual([]);
  });

  it("refuses every slot of a locked or unknown notification", () => {
    expect(templateProblems({ subject: "Hi" }, "return.acknowledgement")).toHaveLength(1);
    expect(templateProblems({ subject: "Hi" }, "draft.pay_link")).toHaveLength(1);
    expect(templateProblems({}, "return.acknowledgement")).toEqual([]);
  });

  it("names the slot of each problem", () => {
    const problems = templateProblems({ subject: "{x}", heading: "ok", body: "www.a.no" }, "order.sent");
    expect(problems.map((p) => [p.slot, p.code])).toEqual([
      ["subject", "unknown_placeholder"],
      ["body", "address"],
    ]);
  });
});

describe("withTemplate(): the template over the fixed text, slot by slot", () => {
  const built = { subject: "Order 1001 from Bok is on its way", heading: "Your parcel is on its way!", intro: "Order 1001 has been sent." };
  const values = { store_name: "Bok", order_number: "1001", customer_first_name: "Kari", carrier: "Posten / Bring", tracking_number: "370" };

  it("keeps the fixed text without a template", () => {
    expect(withTemplate(built, null, "order.sent", values)).toEqual({ ...built, preview: built.intro, fromTemplate: { subject: false, heading: false, body: false } });
  });

  it("replaces only the slots the template has", () => {
    const out = withTemplate(built, { subject: "{store_name}: order {order_number} sent", body: "Hi {customer_first_name},\n\n{carrier} has it: {tracking_number}." }, "order.sent", values);
    expect(out.subject).toBe("Bok: order 1001 sent");
    expect(out.heading).toBe(built.heading);
    expect(out.intro).toBe("Hi Kari,\n\nPosten / Bring has it: 370.");
    expect(out.preview).toBe("Hi Kari, Posten / Bring has it: 370.");
    expect(out.fromTemplate).toEqual({ subject: true, heading: false, body: true });
  });

  it("falls back per slot when a slot has a problem now (a placeholder removed later)", () => {
    const out = withTemplate(built, { subject: "Sent {coupon}", heading: "On its way, {customer_first_name}" }, "order.sent", values);
    expect(out.subject).toBe(built.subject);
    expect(out.heading).toBe("On its way, Kari");
  });

  it("falls back when a filled slot comes out empty, and cuts a long subject", () => {
    expect(withTemplate(built, { body: "{customer_first_name}" }, "order.sent", { customer_first_name: null }).intro).toBe(built.intro);
    const long = withTemplate(built, { subject: `${"a".repeat(130)} {store_name}` }, "order.sent", { store_name: "b".repeat(100) });
    expect([...long.subject].length).toBe(FILLED_SUBJECT_MAX);
    expect(long.subject.endsWith("…")).toBe(true);
  });

  it("is drawn by renderEmail() as escaped text with every fixed block still there", () => {
    const out = withTemplate(built, { heading: "<b>Hei</b> {customer_first_name}", body: "Tusen takk & velkommen <script>x</script>" }, "order.sent", values);
    const fixed: EmailBlock[] = [
      { type: "lines", rows: [{ label: "2 × Sample product", value: "298,00 kr" }] },
      { type: "button", text: "Track the parcel", url: "https://tracking.bring.com/x" },
      { type: "paragraph", text: "Your 14 days to change your mind count from the day you receive the last parcel." },
    ];
    const email = renderEmail({
      subject: out.subject,
      preview: out.preview,
      blocks: [{ type: "heading", text: out.heading }, { type: "paragraph", text: out.intro }, ...fixed],
      footer: ["Bok AS"],
      lang: "nb",
    });
    expect(email.html).not.toContain("<b>Hei</b>");
    expect(email.html).toContain("&lt;b&gt;Hei&lt;/b&gt; Kari");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Tusen takk &amp; velkommen");
    for (const text of ["2 × Sample product", "Track the parcel", "https://tracking.bring.com/x", "Your 14 days to change your mind"]) expect(email.html).toContain(text);
    expect(email.text).toContain("<b>Hei</b> Kari");
  });

  it("fills the sample order in a currency other than the store's own (a euro view)", () => {
    const sample = sampleOrder({ storeName: "Bok", currency: "EUR", locale: "nb-NO", lang: "nb", now: new Date("2026-10-15T10:00:00Z") });
    const values = samplePlaceholders(sample, "Bok");
    const out = withTemplate({ subject: "x", heading: "y", intro: "z" }, { subject: "Ordre {order_number}: {order_total}" }, "order.confirmation", values);
    expect(sample.totalMinor).toBe(2 * 14900 + 29900 + 4900);
    expect(out.subject).toBe(`Ordre 1001: ${new Intl.NumberFormat("nb-NO", { style: "currency", currency: "EUR" }).format(sample.totalMinor / 100)}`);
    expect(out.subject).toContain("€");
  });
});

describe("helpers", () => {
  it("cleans a slot and lists the filled ones", () => {
    expect(cleanSlot("  a\r\nb  ")).toBe("a\nb");
    expect(cleanSlot("   ")).toBeNull();
    expect(cleanSlot(undefined)).toBeNull();
    expect(filledSlots({ subject: "a", heading: " ", body: null })).toEqual(["subject"]);
    expect(filledSlots(null)).toEqual([]);
  });
});
