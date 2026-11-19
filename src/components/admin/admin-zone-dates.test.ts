import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { analyticsEn } from "@/lib/admin-messages/analytics.en";
import { supportEn } from "@/lib/admin-messages/support.en";
import type { UnansweredQuestion } from "@/lib/unanswered-questions";
import type { LiveFigures } from "@/server/analytics-live";
import type { FormSummary } from "@/server/forms-admin";
import type { PackingSlip } from "@/server/packing-slips";

import { LiveView } from "./analytics/live-view";
import { FormsList } from "./forms/forms-list";
import { PackingSlipView } from "./orders/packing-slip-view";
import { UnansweredQuestionsView } from "./unanswered-questions-view";

/**
 * The admin's dates that were drawn with no zone are the store's own (D812): an order placed, a question asked, a form's last response and a
 * live figure's update in the evening fall on the store's day and clock, wherever the server is (UTC on Vercel) or the browser. 23:30 in New
 * York on 3 October is 03:30 UTC on the 4th; 00:30 in Auckland on 4 October is 11:30 UTC on the 3rd. Run under any `TZ`: the answer is the same.
 */

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const NY_EVENING = "2026-10-04T03:30:00.000Z";
const AUCKLAND_NIGHT = "2026-10-03T11:30:00.000Z";

describe("a packing slip's order day", () => {
  const slip = (placedAt: string): PackingSlip => ({
    orderId: "11111111-1111-4111-8111-111111111111",
    number: "1001",
    placedAt,
    locale: "en-GB",
    lang: "en",
    shipTo: { name: "Kari Nordmann", line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
    lines: [{ quantity: 1, title: "Plate", sku: "PLT" }],
    gift: null,
  });
  const html = (placedAt: string, timeZone: string) =>
    text(renderToString(h(PackingSlipView, { slip: slip(placedAt), storeName: "Kaffe AS", seller: { legalName: "Kaffe AS", postalAddress: "Gata 2", contactEmail: "hei@kaffe.no" }, timeZone })));

  it("is the store's day, not UTC's", () => {
    expect(html(NY_EVENING, "America/New_York")).toContain("3 October 2026");
    expect(html(NY_EVENING, "UTC")).toContain("4 October 2026");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).toContain("4 October 2026");
    expect(html(AUCKLAND_NIGHT, "UTC")).toContain("3 October 2026");
  });
});

describe("the questions the assistant could not answer", () => {
  const action = async (): Promise<FormState> => ({ status: "ok", messages: [] });
  const question = (at: string): UnansweredQuestion => ({
    id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc",
    question: "Do you ship to Iceland?",
    lang: "en",
    asked: 1,
    handedOver: 0,
    status: "open",
    firstAt: at,
    lastAt: at,
    documentId: null,
    conversations: [],
  });
  const html = (at: string, timeZone: string) =>
    text(
      renderToString(
        h(UnansweredQuestionsView, {
          rows: [question(at)],
          show: "open",
          base: "/admin/shop/chat/questions",
          inbox: "/admin/shop/support",
          knowledge: "/admin/shop/chat",
          answers: new Map(),
          answer: () => action,
          dismiss: () => action,
          restore: () => action,
          lang: "en",
          words: supportEn,
          timeZone,
        }),
      ),
    );

  it("says the day each was asked on the store's clock", () => {
    expect(html(NY_EVENING, "America/New_York")).toContain("3 Oct 2026");
    expect(html(NY_EVENING, "America/New_York")).not.toContain("4 Oct 2026");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).toContain("4 Oct 2026");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).not.toContain("3 Oct 2026");
  });
});

describe("a form's last response", () => {
  const form = (lastAt: string): FormSummary => ({ id: "f1", name: "Contact", kind: "message", status: "active", recipients: 1, questions: 2, responses: 1, unread: 0, lastAt, updatedAt: lastAt });
  const html = (lastAt: string, timeZone: string) => text(renderToString(h(FormsList, { lang: "en", base: "/admin/shop/forms", forms: [form(lastAt)], uses: [], timeZone })));

  it("is on the store's day", () => {
    expect(html(NY_EVENING, "America/New_York")).toContain("Last response 3 Oct 2026");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).toContain("Last response 4 Oct 2026");
  });
});

describe("the live page's last update", () => {
  const live = (at: string): LiveFigures => ({
    at,
    today: "2026-10-03",
    currency: "EUR",
    counting: false,
    visitorsNow: null,
    byCountry: [],
    visitsToday: null,
    ordersToday: 0,
    revenueTodayMinor: 0,
    unconverted: 0,
    missingCurrencies: [],
    cartsInUse: 0,
    checkoutsInProgress: 0,
  });
  const html = (at: string, timeZone: string) => text(renderToString(h(LiveView, { base: "/admin/shop", locale: "en-GB", timeZone, live: live(at), words: analyticsEn })));

  it("is on the store's clock, to the second", () => {
    expect(html(NY_EVENING, "America/New_York")).toContain("Updated 23:30:00.");
    expect(html(AUCKLAND_NIGHT, "Pacific/Auckland")).toContain("Updated 00:30:00.");
  });
});
