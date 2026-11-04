"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { secondary } from "@/components/admin/data/ui";

/** *Done, I've closed it* (D445 step 7c): the owner says Shopify is closed, and the card of the 14 days after goes. */
export function ShopifyClosedButton({ label, saving, close }: { label: string; saving: string; close: () => Promise<{ ok: boolean }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={secondary}
      onClick={() =>
        start(async () => {
          await close();
          router.refresh();
        })
      }
    >
      {pending ? saving : label}
    </button>
  );
}
