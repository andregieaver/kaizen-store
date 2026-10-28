import { describe, expect, it } from "vitest";

import { accessEmail, requestLang, requestLocale } from "./access-emails";

describe("a request's emails (D312 P6)", () => {
  it("are written in the language the request was made in", () => {
    const en = accessEmail("received", "en", { name: "Kari", storeName: "Karis Kaker" });
    expect(en.lang).toBe("en");
    expect(en.subject).toBe("We got your request for Karis Kaker");
    const nb = accessEmail("received", "nb", { name: "Kari", storeName: "Karis Kaker" });
    expect(nb.lang).toBe("nb");
    expect(nb.subject).toBe("Vi har fått forespørselen din om Karis Kaker");
    expect(nb.blocks[0]).toEqual({ type: "heading", text: "Takk, Kari" });
  });

  it("give the approved one a way to sign in, and the declined one none", () => {
    const approved = accessEmail("approved", "nb", { name: "Kari", storeName: "Karis Kaker", url: "https://kaizenaflow.com/admin/sign-in" });
    expect(approved.blocks).toContainEqual({ type: "button", text: "Logg inn", url: "https://kaizenaflow.com/admin/sign-in" });
    const declined = accessEmail("declined", "en", { name: "Kari", storeName: "Karis Kaker" });
    expect(declined.blocks.some((b) => b.type === "button")).toBe(false);
  });

  it("give a self-serve sign-up a button to confirm, and say that nothing is made without it (D359)", () => {
    const confirm = accessEmail("confirm", "en", { name: "Sam", storeName: "Sam's Shop", url: "https://kaizenaflow.com/sign-up/confirm/abc" });
    expect(confirm.subject).toBe("Confirm your email to start Sam's Shop");
    expect(confirm.blocks).toContainEqual({ type: "button", text: "Confirm and start my store", url: "https://kaizenaflow.com/sign-up/confirm/abc" });
    expect(JSON.stringify(confirm.blocks)).toContain("nothing is made unless the button is pressed");
    expect(accessEmail("confirm", "nb", { name: "Sam", storeName: "Sams butikk" }).subject).toBe("Bekreft e-postadressen din for å starte Sams butikk");
  });

  it("keep a request's language as its locale, and read none or an unknown one as English", () => {
    expect(requestLocale("nb")).toBe("nb-NO");
    expect(requestLocale("en")).toBe("en");
    expect(requestLang("nb-NO")).toBe("nb");
    expect(requestLang(null)).toBe("en");
    expect(requestLang("de-DE")).toBe("en");
  });
});
