import { describe, expect, it } from "vitest";

import { SIGN_IN_WORDS } from "./admin-words/sign-in";
import { signInTo, teamInviteEmail } from "./team-invite-email";

describe("the team invitation (D907)", () => {
  const invite = { lang: "en" as const, inviter: "André", place: "Kaizena Flow", role: "Legal", url: signInTo("https://kaizenaflow.com", "/admin/legal"), platform: true };

  it("says who added them, to what and as what, and opens where they work after signing in", () => {
    const email = teamInviteEmail(invite);
    expect(email.subject).toBe("You have been added to Kaizena Flow's team");
    expect(email.blocks[1]).toEqual({ type: "paragraph", text: "André added you to Kaizena Flow's team, as legal." });
    expect(email.blocks.find((b) => b.type === "button")).toMatchObject({ url: "https://kaizenaflow.com/admin/sign-in?next=%2Fadmin%2Flegal" });
  });

  it("names the sign-in page's own button, in the inviter's language, and two steps only for Kaizena Flow's team, and a store by its name", () => {
    const en = JSON.stringify(teamInviteEmail(invite).blocks);
    expect(en).toContain(SIGN_IN_WORDS.en.signIn.emailLink);
    expect(en).toContain("two-step");
    const nb = teamInviteEmail({ ...invite, lang: "nb", place: "Kaffebaren", role: "Admin", platform: false });
    expect(nb.subject).toBe("Du er lagt til i Kaffebaren");
    expect(JSON.stringify(nb.blocks)).toContain(SIGN_IN_WORDS.nb.signIn.emailLink);
    expect(JSON.stringify(nb.blocks)).not.toContain("to trinn");
    expect(nb.blocks[1]).toMatchObject({ text: "André la deg til i Kaffebaren på Kaizena Flow, som admin." });
  });

  it("reads without an inviter's name", () => {
    expect(teamInviteEmail({ ...invite, inviter: null }).blocks[1]).toMatchObject({ text: "You were added to Kaizena Flow's team, as legal." });
  });
});
