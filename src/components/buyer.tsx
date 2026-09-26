"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { BUYER_DAYS, buyerCookie, parseBuyer, storeBuyer, type Buyer, type StoreAudience } from "@/lib/b2b";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-buyer"] });
  return () => observer.disconnect();
}

const chosenBuyer = () => parseBuyer(document.documentElement.dataset.buyer);

/** The shopper's kind (B2B), as the page's first script or the switch marked it. */
export function useBuyer(audience: StoreAudience): Buyer {
  return storeBuyer(audience, useSyncExternalStore(subscribe, chosenBuyer, () => null));
}

/** Keeps the shopper's choice in its necessary cookie and shows the page for it. */
function chooseBuyer(storeId: string, buyer: Buyer) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${buyerCookie(storeId)}=${buyer}; path=/; max-age=${BUYER_DAYS * 86_400}; samesite=lax${secure}`;
  document.documentElement.dataset.buyer = buyer;
}

type Labels = { label: string; private: string; business: string };

/** The header's Private / Business switch, in stores selling to both. */
export function BuyerSwitch({ storeId, labels }: { storeId: string; labels: Labels }) {
  const buyer = useBuyer("both");
  const router = useRouter();
  const choose = (next: Buyer) => {
    chooseBuyer(storeId, next);
    // The cart and checkout are drawn on the server for the shopper's kind.
    router.refresh();
  };
  return (
    <div role="group" aria-label={labels.label} className="flex items-center gap-2 text-xs">
      <span className="hidden text-muted sm:inline">{labels.label}</span>
      <div className="flex rounded-button border border-current/20 p-0.5">
        {(["private", "business"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={buyer === value}
            onClick={() => choose(value)}
            className="min-h-8 rounded-button px-3 font-medium"
            data-buyer-choice={value}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The first-visit question, when the store asks it: until the shopper has chosen. */
export function BuyerQuestion({
  storeId,
  labels,
}: {
  storeId: string;
  labels: Labels & { question: string; questionText: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!chosenBuyer()) dialog.current?.showModal();
  }, []);
  const choose = (next: Buyer) => {
    chooseBuyer(storeId, next);
    dialog.current?.close();
    router.refresh();
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="buyer-question"
      // Closing without choosing (Escape) leaves the shopper private until they choose.
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <h2 id="buyer-question" className="text-lg font-heading">
        {labels.question}
      </h2>
      <p className="mt-2 text-sm text-muted">{labels.questionText}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => choose("private")} className="min-h-11 rounded-button border border-border font-medium">
          {labels.private}
        </button>
        <button type="button" onClick={() => choose("business")} className="min-h-11 button-primary font-medium">
          {labels.business}
        </button>
      </div>
    </dialog>
  );
}

/** A business-only product's page for a private shopper: says so, and offers to shop as a business. */
export function SwitchToBusiness({ storeId, label }: { storeId: string; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        chooseBuyer(storeId, "business");
        router.refresh();
      }}
      className="min-h-11 button-primary px-5 text-sm font-medium"
    >
      {label}
    </button>
  );
}
