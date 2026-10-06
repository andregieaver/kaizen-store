import { hasGiftText, type GiftFields } from "@/lib/gift";
import type { Messages } from "@/lib/i18n";

/**
 * The buyer's own gift message, shown back to them (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): on the order page, in My account and, as a read-only block, at the checkout.
 * It is only ever shown to the buyer: nothing is sent to the recipient and no other shopper-facing page reads it. The words are the buyer's own, so they are drawn as text and
 * nothing else (React escapes them; `whitespace-pre-line` keeps the lines they typed): no HTML, no Markdown and no link detection (`gift-no-html.scan.test.ts`).
 * A gift with no words says only that it is a gift. Nothing is drawn for an order that is not a gift.
 */
export function GiftNote({ gift, m, size = "base" }: { gift: GiftFields | null; m: Messages; size?: "base" | "small" }) {
  if (!gift || !gift.isGift) return null;
  const words = m.gift;
  const text = size === "small" ? "text-sm" : "";
  if (!hasGiftText(gift)) {
    return (
      <p className={`mt-3 border-t border-border pt-3 ${text}`} data-gift-note>
        {words.title}
      </p>
    );
  }
  return (
    <section aria-label={words.note.yourMessage} className={`mt-3 flex flex-col gap-1 border-t border-border pt-3 ${text}`} data-gift-note>
      <h2 className="font-medium">{words.note.yourMessage}</h2>
      {gift.to && (
        <p>
          <span className="text-muted">{words.to}:</span> {gift.to}
        </p>
      )}
      {gift.from && (
        <p>
          <span className="text-muted">{words.from}:</span> {gift.from}
        </p>
      )}
      {gift.message && <p className="whitespace-pre-line break-words">{gift.message}</p>}
    </section>
  );
}
