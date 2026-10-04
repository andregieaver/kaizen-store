import { describe, expect, it } from "vitest";

import { renderEmail } from "./email-layout";
import { securityEmail, type SecurityEvent } from "./security-emails";

const facts = (event: SecurityEvent) => ({ event, person: "Kari", when: "2026-10-03 14:05 UTC", signInUrl: "https://kaizenstore.cloud/admin/sign-in", by: "admin@kaizen.example" });

describe("the emails about a person's own sign-in security", () => {
  it("each says what happened and when, and what to do if it was not the person", () => {
    for (const event of ["recovery_code_used", "two_step_removed", "two_step_reset"] as const) {
      const rendered = renderEmail(securityEmail(facts(event)));
      expect(rendered.text).toContain("2026-10-03 14:05 UTC");
      expect(rendered.text).toContain("Hello Kari");
      expect(rendered.text).toMatch(/If it was not you/);
      expect(rendered.text).toContain("https://kaizenstore.cloud/admin/sign-in");
    }
  });

  it("has a subject of its own for each event", () => {
    expect(securityEmail(facts("recovery_code_used")).subject).toBe("A recovery code was used on your account");
    expect(securityEmail(facts("two_step_removed")).subject).toBe("Two-step sign-in was switched off on your account");
    expect(securityEmail(facts("two_step_reset")).subject).toBe("Your two-step sign-in was reset");
  });

  it("says that using a recovery code takes the second step away and asks for it again, and names who reset it for a reset", () => {
    expect(renderEmail(securityEmail(facts("recovery_code_used"))).text).toMatch(/takes your two-step sign-in away/);
    expect(renderEmail(securityEmail(facts("two_step_reset"))).text).toContain("admin@kaizen.example");
    expect(renderEmail(securityEmail({ ...facts("two_step_reset"), by: null })).text).not.toContain("()");
  });

  it("carries no code, no secret and no link that signs anyone in", () => {
    for (const event of ["recovery_code_used", "two_step_removed", "two_step_reset"] as const) {
      const rendered = renderEmail(securityEmail(facts(event)));
      expect(rendered.html + rendered.text).not.toMatch(/[0-9A-Z]{5}-[0-9A-Z]{5}/);
      expect(rendered.html).not.toMatch(/token|code=|magic/i);
    }
  });

  it("is written in English with an English footer, as the admin is", () => {
    const content = securityEmail(facts("two_step_removed"));
    expect(content.lang).toBe("en");
    expect(content.footer.join(" ")).toContain("Kaizen");
  });
});
