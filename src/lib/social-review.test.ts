import { describe, expect, it } from "vitest";

import { STAFF_EMAILS_WORDS } from "./admin-words/staff-emails";
import { reviewWorthSending, socialReviewEmail, type ReviewFacts } from "./social-review";

const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;
const facts: ReviewFacts = {
  store: "Keramikkverkstedet",
  currency: "NOK",
  weekStart: "2026-11-30",
  posts: { written: 3, copied: 2 },
  tagged: { week: { visits: 140, orders: 3, revenueMinor: 179_700 }, before: { visits: 90, orders: 1, revenueMinor: 59_900 } },
  instagram: { posts: 4, bestReach: 5210 },
  advice: {
    date: "2026-11-27",
    verdicts: ["Your posts reach people, but few come to the shop from them.", "Reels reach far more than pictures.", "The new bowl has not been shown yet."],
    planned: [{ day: "2026-12-01", channel: "instagram", idea: "A reel of a bowl taking shape on the wheel." }],
  },
};

describe("the weekly social media review (D870 S1.5)", () => {
  it("says the week's figures against the week before, the adviser's verdicts and the coming week's plan, with one button", () => {
    const email = socialReviewEmail(facts, "https://kaizenaflow.com/admin/k/social", STAFF_EMAILS_WORDS.en, "en", money);
    expect(email.subject).toBe("Your week on social media in Keramikkverkstedet");
    const lines = email.blocks.filter((b) => b.type === "lines").flatMap((b) => (b.type === "lines" ? b.rows : []));
    expect(lines).toContainEqual({ label: "Posts written", value: "3" });
    expect(lines).toContainEqual({ label: "Visits from your tagged posts", value: "140 (week before: 90)" });
    expect(lines).toContainEqual({ label: "Sales from your tagged posts", value: "1797.00 kr (week before: 599.00 kr)" });
    expect(lines).toContainEqual({ label: "Most reached post", value: "5,210" });
    expect(lines.map((l) => l.label)).toContain("Reels reach far more than pictures.");
    expect(lines).toContainEqual({ label: "Tuesday 1 December · Instagram", value: "A reel of a bowl taking shape on the wheel." });
    expect(email.blocks.filter((b) => b.type === "button")).toHaveLength(1);
  });

  it("says the visits are not known where the store does not count them, and in Norwegian for a Norwegian admin", () => {
    const email = socialReviewEmail({ ...facts, tagged: null }, "https://x", STAFF_EMAILS_WORDS.nb, "nb", money);
    const lines = email.blocks.flatMap((b) => (b.type === "lines" ? b.rows : []));
    expect(lines).toContainEqual({ label: "Besøk fra de merkede innleggene dine", value: "Ikke kjent: butikken teller ikke besøk" });
    expect(email.subject).toBe("Uka di i sosiale medier i Keramikkverkstedet");
  });

  it("sends nothing for a week with nothing to say", () => {
    expect(reviewWorthSending({ ...facts, posts: { written: 0, copied: 0 }, tagged: null, instagram: null, advice: null })).toBe(false);
    expect(reviewWorthSending({ ...facts, posts: { written: 0, copied: 0 }, tagged: null, instagram: { posts: 1, bestReach: 10 }, advice: null })).toBe(true);
  });
});
