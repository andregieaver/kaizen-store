import { describe, expect, it } from "vitest";

import { staffEmailsEn } from "./admin-messages/staff-emails.en";
import { staffEmailsNb } from "./admin-messages/staff-emails.nb";
import type { EmailContent } from "./email-layout";
import { guardrailEmail, orderRate } from "./experiment-emails";
import { securityEmail } from "./security-emails";
import { statusEmail } from "./store-closure-emails";

const text = (e: EmailContent) =>
  [e.subject, ...e.blocks.map((b) => ("text" in b ? b.text : ""))].join("\n");

describe("owner and staff emails in the account's language (D312 A10)", () => {
  const security = {
    event: "two_step_reset" as const,
    person: "Kari",
    when: "2026-10-03 14:05 UTC",
    by: "admin@example.com",
    signInUrl: "https://x/admin/sign-in",
  };
  const guardrail = {
    storeName: "Butikk",
    testName: "Vår",
    target: "/om-oss",
    version: { key: "b", name: "Ny", visitors: 1200, buyers: 12 },
    original: { visitors: 1250, buyers: 40 },
    days: 1,
    url: "https://x/r",
  };
  const closure = {
    storeName: "Butikk",
    change: "closed" as const,
    by: "owner" as const,
    reason: null,
    url: "https://x/a",
    reopenUntil: new Date("2026-11-20T00:00:00Z"),
  };

  it("the English is what the words given by default make", () => {
    expect(securityEmail(security, staffEmailsEn, "en")).toEqual(
      securityEmail(security),
    );
    expect(securityEmail(security).subject).toBe(
      "Your two-step sign-in was reset",
    );
    expect(text(securityEmail(security))).toContain(
      "A platform admin (admin@example.com) reset the two-step sign-in",
    );
    expect(guardrailEmail(guardrail).subject).toBe(
      'Your A/B test "Vår" was stopped: fewer orders in version B',
    );
    expect(text(guardrailEmail(guardrail))).toContain(
      "had run for 1 day when version B (Ny)",
    );
    expect(text(guardrailEmail(guardrail))).toContain(
      "12 of 1,200 visitors who saw version B ordered (1 %)",
    );
    expect(text(statusEmail(closure))).toContain(
      "You can reopen the store yourself until 20 November 2026",
    );
    expect(statusEmail(closure).lang).toBe("en");
  });

  it("writes Norwegian with Norwegian numbers and dates", () => {
    const s = securityEmail(security, staffEmailsNb, "nb");
    expect(s.lang).toBe("nb");
    expect(s.subject).toBe("Innloggingen din i to trinn ble tilbakestilt");
    expect(text(s)).toContain(
      "En plattformadministrator (admin@example.com) tilbakestilte",
    );
    const g = guardrailEmail(guardrail, staffEmailsNb, "nb");
    expect(g.subject).toBe(
      "A/B-testen «Vår» ble stoppet: færre bestillinger i versjon B",
    );
    expect(text(g)).toMatch(/12 av 1\s200 besøkende/);
    expect(orderRate(41, 1250, "nb-NO")).toBe("3,3 %");
    expect(text(statusEmail(closure, staffEmailsNb, "nb"))).toContain(
      "til og med 20. november 2026",
    );
  });
});
