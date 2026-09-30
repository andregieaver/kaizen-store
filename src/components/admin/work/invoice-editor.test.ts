import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { timerFromServer } from "@/lib/work-timer-ui";
import type { RunningTimer } from "@/server/work-time";

// The actions are server code (they import the database); the editor calls them only when it saves or a button is pressed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions", () => ({}));
vi.mock("@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-view-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { DraftEditor } from "./invoice-draft-editor";
import {
  LINE_A,
  STORE,
  TODAY,
  client,
  clean,
  draftDetail,
  line,
  notReady,
  readyReadiness,
  secondLine,
} from "./invoice-test-support";
import { TimerContext } from "./timer-context";
import type { WorkTimer } from "./use-work-timer";

type Props = ComponentProps<typeof DraftEditor>;

const props = (over: Partial<Props> = {}): Props => ({
  storeSlug: STORE,
  locale: "en",
  detail: draftDetail(),
  vat: { sellerVatRegistered: true, standardRateBp: 2500 },
  fixedFeeAssignmentIds: [],
  timeByLine: {},
  newLineRateMinor: 120_000,
  nextNumber: "W-13",
  fxSuggestions: {},
  ...over,
});

const render = (over: Partial<Props> = {}, timer: WorkTimer | null = null) => {
  const editor = createElement(DraftEditor, props(over));
  return clean(renderToString(timer ? createElement(TimerContext.Provider, { value: timer }, editor) : editor));
};

describe("the draft invoice editor", () => {
  it("shows the details: who it is for, the language, VAT treatment, currency, days to pay and when it would be due", () => {
    const html = render();
    expect(html).toContain('href="/admin/account/work/s/kaffe/clients/6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001"');
    expect(html).toContain("Acme AB");
    expect(html).toContain("Website rebuild");
    expect(html).toContain("Norwegian");
    expect(html).toContain("Domestic VAT");
    expect(html).toContain('<option value="NOK" selected');
    expect(html).toContain('placeholder="14"');
    expect(html).toContain("Follows the client and your settings: 14 days.");
    // Issued today (2026-09-29) with 14 days to pay.
    expect(html).toContain("If issued today it is due 10/13/2026.");
    for (const label of [
      "Currency",
      "Days to pay",
      "Your reference",
      "Period from",
      "Period to",
      "Notes for the client",
    ])
      expect(html).toContain(label);
  });

  it("has every line's fields labelled, with the amounts as they will be issued", () => {
    const html = render();
    for (const label of [
      "Line 1 description",
      "Line 1 hours",
      "Line 1 unit",
      "Line 1 price without VAT",
      "Line 1 discount in percent",
      "Line 1 VAT",
      "Line 2 quantity",
      "Line 2 description",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="Design workshop"');
    expect(html).toContain('value="1.75"');
    expect(html).toContain('value="1200.00"');
    expect(html).toContain("NOK 2,100.00");
    expect(html).toContain("NOK 2,625.00");
    expect(html).toContain("25 % VAT");
    // Every input has its label: each id used in a label's for is on a control.
    for (const [, id] of html.matchAll(/for="([^"]+)"/g)) expect(html).toContain(`id="${id}"`);
  });

  it("lets a line be removed with an icon and reordered by its drag handle, without move buttons", () => {
    const html = render();
    expect(html).toContain('aria-label="Remove line 1"');
    expect(html).toContain('aria-label="Drag line 1 to reorder"');
    expect(html).not.toContain("Move line 1 up");
    expect(html).not.toContain("Move line 2 down");
    // The remove button shows an icon only: no text between its tags.
    expect(html).toMatch(/<button[^>]*aria-label="Remove line 1"[^>]*><svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg><\/button>/);
    // It is the last cell of the line's grid, after the amounts.
    expect(html.indexOf('aria-label="Remove line 1"')).toBeGreaterThan(html.indexOf("With VAT"));
    expect(html).toContain(">Add line<");
  });

  it("keeps the details closed until asked for, with a summary in their place", () => {
    const html = render();
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="invoice-details"/);
    expect(html).toMatch(/<div id="invoice-details" hidden=""/);
    expect(html).toContain(" days to pay");
  });

  it("stacks on a phone and becomes a table-like grid from the medium size", () => {
    const html = render();
    expect(html).toContain("md:grid-cols-[minmax(11rem,1fr)_9rem_6.5rem_4.5rem_10rem_6rem_6rem_2.25rem]");
    expect(html).toContain("md:sr-only");
    expect(html).toContain('aria-label="Invoice lines"');
  });

  it("shows the totals worked out from the lines, the VAT per rate and the total", () => {
    const html = render();
    expect(html).toContain("Amount without VAT");
    expect(html).toContain("NOK 2,600.00");
    expect(html).toContain("VAT 25 %");
    expect(html).toContain("NOK 650.00");
    expect(html).toContain("Total with VAT");
    expect(html).toContain("NOK 3,250.00");
    expect(html).not.toContain("running clock");
  });

  it("says the state of the autosave and leaves saving to itself", () => {
    const html = render();
    expect(html).toContain('role="status" data-testid="save-status"');
    expect(html).toContain("Changes are saved as you type.");
    expect(html).not.toContain("Save invoice");
  });

  it("lists what must be fixed before issuing, with where to fix each, and warnings apart", () => {
    const html = render();
    expect(html).toContain("2 things to fix before you can issue this invoice.");
    expect(html).toContain("Add the bank account invoices are paid to.");
    expect(html).toContain('href="/admin/account/work/s/kaffe/settings"');
    expect(html).toContain('href="/admin/account/work/s/kaffe/clients/6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001"');
    expect(html).toContain("Open Work settings");
    expect(html).toContain(">Fix<");
    expect(html).toContain(">Check<");
    expect(html).toContain('href="#invoice-lines"');
    const ready = render({ detail: draftDetail({ readiness: readyReadiness }) });
    expect(ready).toContain("Ready to issue.");
    expect(ready).not.toContain("to fix before");
  });

  it("offers issuing, previewing the document and deleting the draft, and keeps the dialogs shut", () => {
    const html = render();
    expect(html).toContain("Issue invoice …");
    expect(html).toContain("Delete draft");
    expect(html).toContain('href="/admin/account/work/s/kaffe/invoices/6f1c0f37-5f39-4d0e-9d55-7f0d0f6a3001/print"');
    expect(html).toContain("Add unbilled time");
    expect(html).not.toContain("Issue as W-13");
    expect(html).not.toContain("The number is taken when you issue");
  });

  it("asks for an exchange rate only when the invoice is in another currency than the seller's", () => {
    expect(render()).not.toContain("Exchange rate");
    const html = render({
      detail: draftDetail({ readiness: { ...notReady, needsFxRate: true, homeCurrency: "SEK" } }),
      fxSuggestions: { NOK: "1.05000000" },
    });
    expect(html).toContain("Exchange rate: 1 NOK in SEK");
    expect(html).toContain("Use 1.05000000");
  });

  it("says when VAT is not charged, and what the client's treatment does", () => {
    const unregistered = render({ vat: { sellerVatRegistered: false, standardRateBp: 2500 } });
    expect(unregistered).toContain("No VAT: your business is not registered for VAT");
    expect(unregistered).toContain("The invoice will say the seller is not registered for VAT.");
    expect(unregistered).toContain("No VAT on this line");
    const reverse = render({ detail: draftDetail({ client: client({ vatTreatment: "reverse_charge" }) }) });
    expect(reverse).toContain("Reverse charge");
    expect(reverse).toContain("The invoice will carry the reverse charge note");
    expect(reverse).toContain("No VAT on this line");
    expect(reverse).toContain("NOK 2,600.00");
  });

  it("shows a private customer's VAT as domestic", () => {
    expect(render({ detail: draftDetail({ client: client({ business: false }) }) })).toContain(
      "Domestic VAT (a private customer)",
    );
  });

  it("shows logged time on a line, with Release for each entry and for the line", () => {
    const html = render({
      detail: draftDetail({ lines: [line({ timeMinutes: 90, taskId: "t1" }), secondLine()] }),
      timeByLine: {
        [LINE_A]: [
          { id: "e1", workDate: "2026-09-10", minutes: 60, person: "Kari", task: "Design", note: "Kick-off" },
          { id: "e2", workDate: "2026-09-11", minutes: 30, person: "Ola", task: "Design", note: null },
        ],
      },
    });
    expect(html).toContain("1h 30m logged time on this line");
    expect(html).toContain("Logged time on line 1 (2 entries)");
    expect(html).toContain("09/10/2026, 1h, Kari");
    expect(html).toContain("Kick-off");
    expect(html).toContain("Release all time from line 1");
    expect(html).toContain('aria-label="Take the 1h on 09/10/2026 off line 1"');
    expect(html).toContain("Released time can be billed again");
  });

  it("ticks a running clock into the line it belongs to, and says so", () => {
    const start = Date.parse("2026-09-29T09:00:00Z");
    const server: RunningTimer = {
      startedAt: new Date(start).toISOString(),
      serverNow: new Date(start + 20 * 60_000).toISOString(),
      accountId: "u1",
      storeId: "s1",
      storeSlug: STORE,
      storeName: "Store",
      assignmentId: "6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1002",
      assignmentName: "Website rebuild",
      clientId: "c1",
      clientName: "Acme AB",
      taskId: "t1",
      taskTitle: "Design",
      estimate: null,
      elapsedSeconds: 1200,
    };
    const running = timerFromServer(server, start + 20 * 60_000);
    const api: WorkTimer = {
      showStore: false,
      timer: running,
      pendingEntry: null,
      now: start + 20 * 60_000,
      start: () => {},
      stop: () => {},
      discard: () => {},
      busy: false,
      status: "",
      error: null,
      dismissError: () => {},
      alert: null,
      dismissAlert: () => {},
    };
    const detail = draftDetail({
      lines: [
        line({
          taskId: "t1",
          timeMinutes: 60,
          quantityHundredths: 100,
          unitPriceMinor: 120_000,
          exclMinor: 120_000,
          vatMinor: 30_000,
          inclMinor: 150_000,
        }),
      ],
    });
    const html = render({ detail }, api);
    // 1 h logged and 20 min running is 1.33 h: 1.33 x 1 200 = 1 596.
    expect(html).toContain("NOK 1,596.00");
    expect(html).toContain("Includes time from your running clock");
    // Without the clock, the line is what is logged.
    expect(render({ detail })).toContain("NOK 1,200.00");
    // A quantity the person typed is not rewritten by a clock.
    const typed = render(
      {
        detail: draftDetail({
          lines: [
            line({
              taskId: "t1",
              timeMinutes: 60,
              quantityHundredths: 100,
              unitPriceMinor: 120_000,
              exclMinor: 120_000,
              quantityManual: true,
            }),
          ],
        }),
      },
      api,
    );
    expect(typed).not.toContain("running clock");
  });

  it("starts an empty draft with a way to add lines, and no unit price or total made up", () => {
    const html = render({ detail: draftDetail({ lines: [], readiness: notReady }) });
    expect(html).toContain("No lines yet.");
    expect(html).toContain("NOK 0.00");
    expect(html).toContain(">Add line<");
  });

  it("offers rounding up hours only when there are hourly lines", () => {
    expect(render()).toContain("Round hours up");
    expect(render({ detail: draftDetail({ lines: [secondLine()] }) })).not.toContain("Round hours up");
  });

  it("carries today from the store's own time zone, not the browser's", () => {
    expect(TODAY).toBe("2026-09-29");
    expect(render()).toContain("10/13/2026");
  });
});
