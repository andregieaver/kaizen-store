import type { EmailBlock } from "./email-layout";
import { STARTER_TEXTS, starterLanguageOf } from "./legal-starters";

/**
 * The withdrawal information an order confirmation carries in the email itself (D407 step 4): a link is not a durable medium (CJEU C-49/11),
 * and the confirmation must give the information of CRD Art. 6(1)(h) and the model form of Annex I(B) on one (Art. 8(7)(a)), and confirm
 * a consent given to lose the right (Art. 8(7)(b)). Pure. The sentences are the withdrawal-information starter's own (`legal-starters/`,
 * hand-written in four languages and checked against the law), so the page and the email say the same; the few lines of the email's own are
 * `CONSENT_LEAD`. Nothing here is legal advice: the words need human review before real use.
 */

export type WithdrawalEmailFacts = {
  /** The order's locale: Norwegian, Swedish, Danish, else English. */
  locale: string;
  /** Who the customer writes to: the business's legal name (else the store's), its postal address and email, as far as they are known. */
  seller: { name: string; address: string | null; email: string | null };
  /** Goods with the right (not excluded, sealed ones included). */
  goods: boolean;
  /** Who pays for sending goods back, as the order kept it; null when it did not. */
  whoPays: "shopper" | "store" | null;
  /** A booked service with the right (not `dated_service`). */
  services: boolean;
  /** The words the customer ticked at checkout, when they did: a download delivered at once, a service begun inside the 14 days. */
  consents: string[];
};

/** The sentence before the words a customer agreed to, in the order's language (hand-written; legal review). */
const CONSENT_LEAD: Record<"nb" | "sv" | "da" | "en", string> = {
  nb: "Dette samtykket ga du i kassen:",
  sv: "Detta samtycke gav du i kassan:",
  da: "Dette samtykke gav du i kassen:",
  en: "At checkout you agreed to this:",
};

/** `{name}`, `{address}`, `{email}` filled in, a part that is not known left out with the comma before it. */
function fill(template: string, seller: WithdrawalEmailFacts["seller"]): string {
  return template
    .replace(/,?\s*\{address\}/g, seller.address ? `, ${seller.address}` : "")
    .replace(/,?\s*\{email\}/g, seller.email ? `, ${seller.email}` : "")
    .replace(/\{name\}/g, seller.name)
    .replace(/^,\s*/, "");
}

/** The blocks, or none when nothing in the order has the right and nothing was consented to. */
export function withdrawalInformation(f: WithdrawalEmailFacts): EmailBlock[] {
  const lang = starterLanguageOf(f.locale) ?? "en";
  const m = STARTER_TEXTS[lang].m;
  const say = (key: string) => fill(m[key], f.seller);
  const blocks: EmailBlock[] = [];
  if (f.goods || f.services) {
    blocks.push(
      { type: "heading", text: m["h.withdrawal_info.right"] },
      { type: "paragraph", text: [say("withdrawal.right.1"), ...(f.goods ? [say("withdrawal.right.2")] : []), ...(f.services ? [say("withdrawal.right.services")] : [])].join(" ") },
      { type: "heading", text: m["h.withdrawal_info.how"] },
      { type: "paragraph", text: [say("withdrawal.how.1"), say("withdrawal.how.noonline"), say("withdrawal.how.2")].join(" ") },
      { type: "heading", text: m["h.withdrawal_info.effects"] },
      {
        type: "paragraph",
        text: [
          say("withdrawal.effects.1"),
          ...(f.goods ? [say("withdrawal.effects.2"), say("withdrawal.effects.3")] : []),
          ...(f.goods && f.whoPays ? [say(f.whoPays === "store" ? "withdrawal.effects.pays.store" : "withdrawal.effects.pays.shopper")] : []),
          ...(f.goods ? [say("withdrawal.effects.4")] : []),
          ...(f.services ? [say("withdrawal.effects.services")] : []),
        ].join(" "),
      },
    );
  }
  for (const consent of f.consents) blocks.push({ type: "paragraph", text: `${CONSENT_LEAD[lang]} «${consent}»` });
  if (f.goods || f.services) {
    blocks.push(
      { type: "heading", text: m["h.withdrawal_info.model_form"] },
      {
        type: "paragraph",
        text: [
          say("withdrawal.form.1"),
          "",
          say("withdrawal.form.to"),
          say("withdrawal.form.notice"),
          say("withdrawal.form.ordered"),
          say("withdrawal.form.consumer"),
          say("withdrawal.form.address"),
          say("withdrawal.form.signature"),
          say("withdrawal.form.date"),
          say("withdrawal.form.note"),
        ].join("\n"),
      },
    );
  }
  return blocks;
}
