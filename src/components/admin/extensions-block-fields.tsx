"use client";

import { useId } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Select, TextInput } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { ExtensionChoice } from "@/lib/extension-offer";
import type { ExtensionsBlock } from "@/lib/page-content";
import type { BlockPatch } from "@/lib/page-rows";

import { Choices } from "./block-fields";
import { Check } from "./check-field";

/**
 * The Extensions block in the page builder (D748 E8): its settings (currency, which price shows or a switch, whole amounts, the one to
 * recommend, the comparison table, which extensions and bundles show, the button, as the Plans block has)
 * and its stand-in on the canvas, which reads no catalogue. The extensions, bundles and prices are edited under Plans → Extensions; a change
 * there shows on the page. Each extension and bundle is on unless switched off here (`hide`), so one added to the catalogue later shows too.
 */

export function ExtensionsFields({
  block,
  currencies,
  choices,
  labelMax,
  onChange,
}: {
  block: ExtensionsBlock;
  currencies: readonly string[];
  /** The catalogue's extensions and bundles, each one a switch (`hide`). */
  choices: readonly ExtensionChoice[];
  /** The longest button text (`BUTTON_LABEL_MAX`, handed in: the content rules are not this script's). */
  labelMax: number;
  onChange: (patch: BlockPatch<ExtensionsBlock>) => void;
}) {
  const id = useId();
  const w = useAdminText("builder").extensions;
  const hide = block.hide ?? [];
  const show = (choice: ExtensionChoice, on: boolean) => {
    const next = on ? hide.filter((hidden) => hidden !== choice.id) : [...hide.filter((hidden) => hidden !== choice.id), choice.id];
    onChange({ hide: next.length > 0 ? next : undefined });
  };
  const extensions = choices.filter((choice) => choice.kind === "extension");
  const bundles = choices.filter((choice) => choice.kind === "bundle");
  // What can be recommended: what the block shows (a bundle only while the bundles show).
  const recommendable = choices.filter((choice) => !hide.includes(choice.id) && (choice.kind === "extension" || block.bundles !== false));
  const pw = useAdminText("builder").plans;
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
      <label htmlFor={`${id}-interval`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.prices}
        <Select
          id={`${id}-interval`}
          value={block.switcher ? "switch" : (block.interval ?? "")}
          onChange={(event) => {
            // A switch keeps a yearly choice as where it starts; the others show one interval, or both (as the Plans block, D481).
            const kind = event.target.value;
            onChange(kind === "switch" ? { switcher: true, interval: block.interval === "year" ? "year" : undefined } : { switcher: undefined, interval: (kind || undefined) as ExtensionsBlock["interval"] });
          }}
        >
          <option value="">{pw.monthlyYearly}</option>
          <option value="month">{pw.monthly}</option>
          <option value="year">{pw.yearly}</option>
          <option value="switch">{pw.switcher}</option>
        </Select>
      </label>
      {block.switcher && (
        <Choices
          legend={pw.shownFirst}
          options={[
            { value: "month", label: pw.firstMonthly },
            { value: "year", label: pw.firstYearly },
          ]}
          value={block.interval === "year" ? "year" : "month"}
          onChange={(start) => onChange({ interval: start === "year" ? "year" : undefined })}
        />
      )}
      <Check label={w.wholeAmounts} hint={w.wholeAmountsHint} checked={block.decimals === "hide_whole"} onChange={(whole) => onChange({ decimals: whole ? "hide_whole" : undefined })} />
      <label htmlFor={`${id}-highlight`} className="flex flex-col gap-1 text-sm font-medium">
        {w.recommend}
        <Select
          id={`${id}-highlight`}
          value={recommendable.some((choice) => choice.id === block.highlightId) ? block.highlightId : ""}
          onChange={(event) => onChange({ highlightId: event.target.value || undefined })}
        >
          <option value="">{pw.noneChoice}</option>
          {recommendable.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </Select>
      </label>
      <Check label={pw.comparison} hint={w.comparisonHint} checked={block.comparison === true} onChange={(comparison) => onChange({ comparison: comparison ? true : undefined })} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.show}</legend>
        <p className="text-xs text-muted">{w.showHint}</p>
        {extensions.length === 0 && <p className="text-sm text-muted">{w.noChoices}</p>}
        {extensions.map((choice) => (
          <Check key={choice.id} label={choice.name} checked={!hide.includes(choice.id)} onChange={(on) => show(choice, on)} />
        ))}
      </fieldset>
      <Check label={w.bundles} hint={w.bundlesHint} checked={block.bundles !== false} onChange={(shown) => onChange({ bundles: shown ? undefined : false })} />
      {block.bundles !== false && bundles.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{w.showBundles}</legend>
          {bundles.map((choice) => (
            <Check key={choice.id} label={choice.name} checked={!hide.includes(choice.id)} onChange={(on) => show(choice, on)} />
          ))}
        </fieldset>
      )}
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
  const pw = useAdminText("builder").plans;
  const parts = [
    block.currency ? fillWords(w.pricesIn, { currency: block.currency }) : w.mainCurrency,
    block.switcher ? pw.switchPrices : block.interval === "month" ? pw.monthlyPrices : block.interval === "year" ? pw.yearlyPrices : pw.bothPrices,
    ...(block.decimals === "hide_whole" ? [w.wholePrices] : []),
    ...(block.highlightId ? [w.oneRecommended] : []),
    ...(block.comparison ? [pw.withComparison] : []),
    block.bundles === false ? w.withoutBundles : w.withBundles,
    ...(block.hide && block.hide.length > 0 ? [fillWords(w.hiddenCount, { count: block.hide.length })] : []),
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
