"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { Card } from "@/components/admin/ui/card";
import { fillWords } from "@/lib/admin-fill";
import { formatMoney, minorUnitDigits, PRICE_DECIMALS, type PriceDecimals } from "@/lib/money";
import { NO_WORDS, PRICE_WORD_MAX, withWords, type PriceWords } from "@/lib/price-words";
import { QUANTITY_PICKERS, type QuantityPicker } from "@/lib/quantity-stepper";
import type { PriceDisplay } from "@/server/price-display";

const input = "min-h-10 w-full rounded-md border border-edge bg-card px-3 text-sm disabled:opacity-60";
const hint = "text-sm text-muted";

/** What the page knows of the store's languages and countries, named in the admin's language. */
export type PriceDisplayPlaces = {
  /** The store's languages in use, the main first, each with its name. */
  languages: { locale: string; name: string }[];
  /** The active countries, with their names, in the order of `PriceDisplay.markets`. */
  countries: Record<string, string>;
  /** The main country's currency and language, for the examples. */
  currency: string;
  locale: string;
};

/**
 * Prices and quantity (D429, D430). Homer sees three choices with what shoppers will see: decimals (with two examples), the words before
 * and after a product's price in the main language (with the price as shoppers read it), and how product pages offer a quantity. Lisa's
 * depth is the one Advanced fold (docs/admin-style.md 2.1): each country's own decimals and each other language's own words. The fold only
 * hides (every field in it is sent), and a refusal that names one of its fields opens it. Everything is checked again by the server, and the
 * form posts without a script too.
 */
export function PriceDisplayForm({
  display,
  places,
  canEdit,
  action,
}: {
  display: PriceDisplay;
  places: PriceDisplayPlaces;
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("settings").prices;
  const common = useAdminText("settings").common;
  const [main, ...others] = places.languages;
  const [decimals, setDecimals] = useState<PriceDecimals>(display.decimals);
  const [mainWords, setMainWords] = useState<PriceWords>((main && display.words[main.locale]) || NO_WORDS);
  const [own, setOwn] = useState<Record<string, boolean>>(() => Object.fromEntries(others.map((l) => [l.locale, l.locale in display.words])));
  const [open, setOpen] = useState(false);
  const fold = useRef<HTMLDetailsElement>(null);

  const unit = 10 ** minorUnitDigits(places.currency);
  const money = (minor: number, style: PriceDecimals) => formatMoney(minor, places.currency, places.locale, { decimals: style });
  const example = (style: PriceDecimals) => ({ whole: money(499 * unit, style), part: money(499 * unit + unit / 2, style) });

  // A refusal that names a field in the fold opens it, and the field takes the focus (docs/admin-style.md 2.1, rule 6). `ActionForm` marks the
  // fields it names `aria-invalid`; the action stays the server's own, so the form still posts without a script.
  useEffect(() => {
    const element = fold.current;
    if (!element) return;
    const observer = new MutationObserver(() => {
      const named = element.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!named) return;
      element.open = true;
      if (document.activeElement?.getAttribute("aria-invalid") !== "true") named.focus();
    });
    observer.observe(element, { subtree: true, attributes: true, attributeFilter: ["aria-invalid"] });
    return () => observer.disconnect();
  }, []);

  return (
    <ActionForm action={action} successMessage={w.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <Card title={w.decimalsTitle}>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">{w.decimalsTitle}</legend>
            {PRICE_DECIMALS.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="decimals"
                  value={value}
                  checked={decimals === value}
                  onChange={() => setDecimals(value)}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="text-body-strong">{w.decimals[value].label}</span>
                  <span className="block text-muted">{fillWords(w.decimals[value].hint, example(value))}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className={`${hint} mt-3`}>{w.decimalsNote}</p>
        </Card>

        <Card title={w.wordsTitle} description={w.wordsHint}>
          {main && (
            <div className="flex flex-col gap-3">
              <WordFields locale={main.locale} words={mainWords} onChange={setMainWords} />
              <p className="text-sm" data-testid="price-words-preview">
                <span className="text-muted">{w.preview}: </span>
                <span className="text-ink">{withWords(money(499 * unit, decimals), { prefix: mainWords.prefix.trim(), suffix: mainWords.suffix.trim() })}</span>
              </p>
            </div>
          )}
          <p className={`${hint} mt-3`}>{fillWords(w.wordsMax, { max: PRICE_WORD_MAX })}</p>
        </Card>

        <Card title={w.quantityTitle}>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">{w.quantityTitle}</legend>
            {QUANTITY_PICKERS.map((value: QuantityPicker) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="quantityPicker" value={value} defaultChecked={display.quantityPicker === value} className="mt-0.5 size-4" />
                <span>
                  <span className="text-body-strong">{w.quantity[value].label}</span>
                  <span className="block text-muted">{w.quantity[value].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className={`${hint} mt-3`}>{w.quantityNote}</p>
        </Card>

        {/* Lisa's depth, one step away; its fields are sent and saved whether it is open or not. */}
        <details
          ref={fold}
          data-advanced=""
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
          className="flex flex-col gap-8 rounded-panel bg-sunken p-4"
        >
          <summary className="cursor-pointer text-title text-ink">
            {w.advanced.title}
            <span className="block text-sm text-muted">{w.advanced.text}</span>
          </summary>
          <div className="mt-6 flex flex-col gap-8">
            <section aria-labelledby="price-countries" className="flex flex-col gap-3">
              <h2 id="price-countries" className="text-title text-ink">
                {w.countriesTitle}
              </h2>
              <p className={hint}>{w.countriesHint}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {display.markets.map((market) => (
                  <label key={market.code} className="flex flex-col gap-1 text-sm font-medium">
                    {places.countries[market.code] ?? market.code}
                    <select name={`market:${market.code}`} defaultValue={market.decimals ?? ""} className={input}>
                      <option value="">
                        {w.countryStore} ({w.decimals[decimals].label.toLowerCase()})
                      </option>
                      {PRICE_DECIMALS.map((value) => (
                        <option key={value} value={value}>
                          {w.decimals[value].label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
            <section aria-labelledby="price-languages" className="flex flex-col gap-3">
              <h2 id="price-languages" className="text-title text-ink">
                {w.languagesTitle}
              </h2>
              {others.length === 0 ? (
                <p className={hint}>{w.noOtherLanguages}</p>
              ) : (
                <>
                  <p className={hint}>{fillWords(w.languagesHint, { main: main?.name ?? "" })}</p>
                  {others.map((language) => (
                    <div key={language.locale} className="flex flex-col gap-2">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={`own:${language.locale}`}
                          checked={own[language.locale] ?? false}
                          onChange={(event) => setOwn((was) => ({ ...was, [language.locale]: event.target.checked }))}
                          className="mt-0.5 size-4"
                        />
                        <span>{fillWords(w.ownWords, { language: language.name })}</span>
                      </label>
                      {/* Always drawn, so the form works without a script; typing here ticks the language's own words. */}
                      <WordFields
                        locale={language.locale}
                        words={display.words[language.locale] ?? NO_WORDS}
                        onType={() => setOwn((was) => ({ ...was, [language.locale]: true }))}
                      />
                    </div>
                  ))}
                </>
              )}
            </section>
          </div>
        </details>

        <div>
          <SubmitButton disabled={!canEdit}>{common.save}</SubmitButton>
          {!canEdit && <p className={`${hint} mt-2`}>{common.readOnly}</p>}
        </div>
      </fieldset>
    </ActionForm>
  );
}

/** A language's two words, before and after the price; controlled where the page shows them live, else as typed. */
function WordFields({
  locale,
  words,
  onChange,
  onType,
}: {
  locale: string;
  words: PriceWords;
  onChange?: (words: PriceWords) => void;
  onType?: () => void;
}) {
  const w = useAdminText("settings").prices;
  const field = (place: keyof PriceWords) => (
    <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
      {place === "prefix" ? w.before : w.after}
      <input
        name={`${place}:${locale}`}
        lang={locale}
        maxLength={PRICE_WORD_MAX}
        className={input}
        {...(onChange
          ? { value: words[place], onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ ...words, [place]: event.target.value }) }
          : { defaultValue: words[place], onInput: onType })}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {field("prefix")}
      {field("suffix")}
    </div>
  );
}
