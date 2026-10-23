import { capacityEn } from "./admin-messages/capacity.en";
import type { EmailContent } from "./email-layout";
import { formatLimit, formatUsage } from "./usage-format";
import type { UsageLine } from "./usage-view";

/**
 * The email a store's owners get when it nears or reaches a limit of its plan (D314, `docs/capacity.md` step 2.5). Pure. Kaizena Flow
 * writes to owners in English, as the store-closure emails do. It names the store, the limits, the figures and one link; never a customer.
 * A soft limit (visits, bandwidth) says plainly that the shop stays open.
 */

export type UsageEmailFacts = {
  storeName: string;
  level: "near" | "reached";
  lines: readonly UsageLine[];
  /** The store's Billing page in the admin. */
  url: string;
};

const FOOTER = ["Kaizena Flow · kaizenaflow.com"];

export function usageEmail(facts: UsageEmailFacts): EmailContent {
  const { storeName: name, level, lines } = facts;
  const listed = lines.map((l) => `${capacityEn.metrics[l.metric]}: ${formatUsage(l.metric, l.used)} of ${l.limit === null ? "no limit" : formatLimit(l.key, l.limit)}`);
  const soft = lines.every((l) => l.enforce === "soft");
  const subject = level === "reached" ? `${name} has used what its plan includes` : `${name} is close to its plan's limits`;
  return {
    subject,
    preview: listed.join(" · "),
    lang: "en",
    footer: [name, ...FOOTER],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `This month so far: ${listed.join("; ")}.` },
      {
        type: "paragraph",
        text: soft
          ? "Your shop stays open: visits and bandwidth only warn. A plan with more is there when you want it."
          : level === "reached"
            ? "Adding more is paused until you free some room or choose a plan with more. Everything you have keeps working, and orders, emails to customers and invoices are never held back."
            : "Nothing is held back yet. When the limit is reached, adding more waits until you free some room or choose a plan with more.",
      },
      { type: "button", text: "See usage and plans", url: facts.url },
    ],
  };
}
