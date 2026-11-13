"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FontPicker, type InstallFont } from "@/components/admin/font-picker";
import { Card } from "@/components/admin/ui";
import {
  GREETING_MAX,
  LABEL_MAX,
  OFFSET_MAX,
  WIDGET_CORNERS,
  WIDGET_LAUNCHERS,
  WIDGET_SIDES,
  WIDGET_WIDTHS,
  shownColour,
  type WidgetStyle,
} from "@/lib/support-widget-style";
import type { SupportWidget } from "@/server/support-widgets";

import { useAdminText } from "../../admin-text";
import { WidgetPreview } from "./widget-preview";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const field = "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";

/** One of a few choices as a row of buttons, the chosen one pressed. */
function Choice<T extends string>({ label, name, value, options, words, onChange }: { label: string; name: string; value: T; options: readonly T[]; words: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1 text-sm ${value === option ? "border-ink bg-ink text-card" : "border-line hover:bg-sunken"}`}
          >
            {words[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A colour of the widget's own, or the store's (none chosen): a swatch to pick it, and a way back to the store's. */
function ColourField({ label, name, value, fallback, onChange }: { label: string; name: string; value: string | null; fallback: string; onChange: (value: string | null) => void }) {
  const w = useAdminText("support").widgets;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input type="hidden" name={name} value={value ?? ""} />
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={shownColour(value, fallback)} onChange={(event) => onChange(event.target.value)} className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-card p-0.5" />
        <span className="text-sm text-muted">{value ?? w.storesOwn}</span>
      </div>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="w-fit text-sm text-muted underline">
          {w.useStores}
        </button>
      )}
    </div>
  );
}

/**
 * A chat widget's editor (D582): Homer names it, picks a button colour, the corners and the side, and sees the chat as visitors will in the
 * preview beside it; Lisa opens *More choices* for the panel's width, the button's place to the pixel, the font, the greeting, the language,
 * the privacy page and CSS of her own. Saved as one form.
 */
export function WidgetEditor({
  widget,
  save,
  install,
  markets,
  themeCss,
  colours,
  labels,
}: {
  widget: SupportWidget;
  save: Action | null;
  install: InstallFont;
  /** A store's countries for the chat's language (slug, name); null on Kaizena Flow's desk. */
  markets: { slug: string; name: string }[] | null;
  themeCss: string;
  /** The store's own colours, shown by the pickers until the owner chooses others. */
  colours: { accent: string; background: string; text: string };
  labels: { deskName: string; open: string; greeting: string; placeholder: string };
}) {
  const w = useAdminText("support").widgets;
  const [style, setStyle] = useState<WidgetStyle>(widget.style);
  const set = <K extends keyof WidgetStyle>(key: K) => (value: WidgetStyle[K]) => setStyle((current) => ({ ...current, [key]: value }));
  const preview = <WidgetPreview style={style} themeCss={themeCss} labels={{ ...labels, visitor: w.previewVisitor }} caption={w.preview} />;
  if (!save) return <Card title={w.look}>{preview}</Card>;
  return (
    <ActionForm action={save} successMessage={w.saved}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card title={w.look} description={w.lookHint}>
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.name}
              <input name="name" required maxLength={60} defaultValue={widget.name} className={field} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              <ColourField label={w.accent} name="accent" value={style.accent} fallback={colours.accent} onChange={set("accent")} />
              <ColourField label={w.background} name="background" value={style.background} fallback={colours.background} onChange={set("background")} />
              <ColourField label={w.text} name="text" value={style.text} fallback={colours.text} onChange={set("text")} />
            </div>
            <Choice label={w.corners} name="corners" value={style.corners} options={WIDGET_CORNERS} words={w.cornersChoice} onChange={set("corners")} />
            <Choice label={w.side} name="side" value={style.side} options={WIDGET_SIDES} words={w.sideChoice} onChange={set("side")} />
            <Choice label={w.launcher} name="launcher" value={style.launcher} options={WIDGET_LAUNCHERS} words={w.launcherChoice} onChange={set("launcher")} />
            {style.launcher === "label" ? (
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.label}
                <input name="label" maxLength={LABEL_MAX} value={style.label} placeholder={labels.open} onChange={(event) => set("label")(event.target.value)} className={field} />
              </label>
            ) : (
              <input type="hidden" name="label" value={style.label} />
            )}
            <details className="flex flex-col gap-4">
              <summary className="cursor-pointer text-sm font-medium">{w.more}</summary>
              <div className="mt-3 flex flex-col gap-4">
                <Choice label={w.width} name="width" value={style.width} options={WIDGET_WIDTHS} words={w.widthChoice} onChange={set("width")} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {w.offsetX}
                    <input name="offsetX" type="number" min={0} max={OFFSET_MAX} value={style.offsetX} onChange={(event) => set("offsetX")(Math.max(0, Math.min(OFFSET_MAX, Number(event.target.value) || 0)))} className={field} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {w.offsetY}
                    <input name="offsetY" type="number" min={0} max={OFFSET_MAX} value={style.offsetY} onChange={(event) => set("offsetY")(Math.max(0, Math.min(OFFSET_MAX, Number(event.target.value) || 0)))} className={field} />
                  </label>
                </div>
                <input type="hidden" name="font" value={style.font ?? ""} />
                <FontPicker label={w.font} value={style.font ?? undefined} onChange={(family) => set("font")(family ?? null)} install={install} defaultLabel={w.fontDefault} />
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.greeting}
                  <textarea name="greeting" rows={2} maxLength={GREETING_MAX} value={style.greeting} placeholder={labels.greeting} onChange={(event) => set("greeting")(event.target.value)} className={field} />
                  <span className="font-normal text-muted">{w.greetingHint}</span>
                </label>
                {markets && markets.length > 1 && (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {w.market}
                    <select name="market" defaultValue={widget.market ?? markets[0]?.slug} className={field}>
                      {markets.map((market) => (
                        <option key={market.slug} value={market.slug}>
                          {market.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.privacy}
                  <input name="privacy" type="url" defaultValue={widget.privacyUrl ?? ""} placeholder={w.privacyPlaceholder} className={field} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.css}
                  <textarea name="css" rows={5} spellCheck={false} value={style.css} onChange={(event) => set("css")(event.target.value)} className={`${field} font-mono text-xs`} />
                  <span className="font-normal text-muted">{w.cssHint}</span>
                </label>
              </div>
            </details>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </div>
        </Card>
        <div className="lg:sticky lg:top-4 lg:self-start">{preview}</div>
      </div>
    </ActionForm>
  );
}
