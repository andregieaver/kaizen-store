"use client";

import { useId } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Select, TextInput } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { ExtensionsBlock } from "@/lib/page-content";
import type { BlockPatch } from "@/lib/page-rows";

import { Check } from "./check-field";

/**
 * The Extensions block in the page builder (D748 E8): its settings (currency, whole amounts, the bundles, the button) and its stand-in on the
 * canvas, which reads no catalogue. The extensions, bundles and prices are edited under Plans → Extensions; a change there shows on the page.
 */

export function ExtensionsFields({
  block,
  currencies,
  labelMax,
  onChange,
}: {
  block: ExtensionsBlock;
  currencies: readonly string[];
  /** The longest button text (`BUTTON_LABEL_MAX`, handed in: the content rules are not this script's). */
  labelMax: number;
  onChange: (patch: BlockPatch<ExtensionsBlock>) => void;
}) {
  const id = useId();
  const w = useAdminText("builder").extensions;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{w.hint}</p>
      <label htmlFor={`${id}-currency`} className="flex flex-col gap-1 text-sm font-medium">
        {w.currency}
        <Select
          id={`${id}-currency`}
          value={block.currency && currencies.includes(block.currency) ? block.currency : ""}
          onChange={(event) => onChange({ currency: event.target.value || undefined })}
        >
          <option value="">{w.currencyMost}</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </Select>
      </label>
      <Check label={w.wholeAmounts} hint={w.wholeAmountsHint} checked={block.decimals === "hide_whole"} onChange={(whole) => onChange({ decimals: whole ? "hide_whole" : undefined })} />
      <Check label={w.bundles} hint={w.bundlesHint} checked={block.bundles !== false} onChange={(shown) => onChange({ bundles: shown ? undefined : false })} />
      <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-sm font-medium">
        {w.buttonText}
        <TextInput
          id={`${id}-label`}
          value={block.buttonLabel}
          maxLength={labelMax}
          placeholder={w.buttonPlaceholder}
          onChange={(event) => onChange({ buttonLabel: event.target.value })}
        />
      </label>
      <label htmlFor={`${id}-href`} className="flex flex-col gap-1 text-sm font-medium">
        {w.buttonAddress}
        <TextInput id={`${id}-href`} value={block.buttonHref} placeholder={"/sign-up"} onChange={(event) => onChange({ buttonHref: event.target.value })} />
        <span className="text-xs font-normal text-muted">{w.buttonAddressHint}</span>
      </label>
    </div>
  );
}

/** The block on the canvas: what it will draw, in words. */
export function ExtensionsStandIn({ block }: { block: ExtensionsBlock }) {
  const w = useAdminText("builder").extensions;
  const parts = [
    block.currency ? fillWords(w.pricesIn, { currency: block.currency }) : w.mainCurrency,
    ...(block.decimals === "hide_whole" ? [w.wholePrices] : []),
    block.bundles === false ? w.withoutBundles : w.withBundles,
  ];
  return (
    <div className="rounded-md border border-dashed border-edge bg-sunken p-4 text-sm">
      <p className="font-medium">{w.title}</p>
      <p className="text-xs text-muted">{fillWords(w.cards, { parts: parts.join(", ") })}</p>
    </div>
  );
}

/** The block's tile in the builder's list: a card with a plus, for something added to a plan. */
export function ExtensionsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-inverse text-inverse-ink">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
        <path d="M17 3v8M13 7h8" />
      </svg>
    </span>
  );
}
