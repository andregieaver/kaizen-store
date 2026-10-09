"use client";

import { X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { SIZE_LABELS } from "@/lib/breakpoints";
import {
  FONT_SIZE_UNITS,
  LETTER_SPACING_LIMITS,
  LETTER_SPACING_UNITS,
  LINE_HEIGHT_LIMITS,
  LINE_HEIGHT_UNITS,
  SHADOW_BLUR_MAX,
  SHADOW_OFFSET_MAX,
  SIZE_LIMITS,
  TEXT_ALIGNS,
  TEXT_DECORATIONS,
  TEXT_STYLES,
  TEXT_TRANSFORMS,
  TEXT_TRANSFORM_NAMES,
  TEXT_VARIANTS,
  TEXT_WEIGHTS,
  TEXT_WEIGHT_VALUES,
  TEXT_GRADIENT_COLORS,
  clearTypographyAt,
  textRoles,
  typographyAt,
  typographyPatch,
  typographySource,
  type Measure,
  type RoleDef,
  type TextGradient,
  type TextRole,
  type TextShadow,
  type Typography,
  type TypographyGroups,
  type TypographyKey,
} from "@/lib/typography";
import type { SizeOverrides } from "@/lib/page-content";

import { ColorField, fieldClass } from "./block-fields";
import { PixelRange } from "./pixel-range";
import { SavedGradients, newTextGradient, textGradientOf } from "./colour-library";
import { FontPicker, type InstallFont } from "./font-picker";
import { SizeSwitch, inheritedClass, sizeNote, useSizeEdit } from "./responsive-edit";

/**
 * The Typography panel (D179 phase 3, `docs/responsive-editing.md` 4 and 11), after Beaver Builder's: in a part's Style tab,
 * a group per kind of text it has (`textRoles()`), each in three folding sections, **Font** (family, weight, size, line
 * height, alignment), **Style & spacing** (letter spacing, transform, decoration, style, variant) and **Text shadow**. Every
 * setting is edited at the screen size the builder is at, with its device icon, where its value comes from (greyed while
 * inherited) and a × that gives a size's own back (`typographyPatch()`, `clearTypographyAt()`). **Colour** and its opacity
 * (D180) open the Font section, in the one colour field with the theme's swatches.
 */

type Part = { type?: string; part?: string; typography?: TypographyGroups; at?: SizeOverrides };
type Patch = { typography?: TypographyGroups; at?: SizeOverrides };

export function TypographyFields({
  part,
  onChange,
  install,
  roles = textRoles(part),
  familyDefault = "Inherited",
}: {
  part: Part;
  onChange: (patch: Patch) => void;
  install: InstallFont;
  roles?: RoleDef[];
  /** What no family means for the part's own text (the site's heading font, say). */
  familyDefault?: string;
}) {
  if (roles.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4" data-typography-panel="">
      <legend className="float-left mb-1 w-full font-medium">Typography</legend>
      {roles.length === 1 ? (
        <RoleFields part={part} def={roles[0]} onChange={onChange} install={install} familyDefault={familyDefault} />
      ) : (
        roles.map((def, index) => (
          <details key={def.role} open={index === 0} className="group rounded-md border border-border">
            <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
              {def.label}
              <Changed part={part} role={def.role} />
            </summary>
            <div className="border-t border-border p-3">
              <RoleFields part={part} def={def} onChange={onChange} install={install} familyDefault={def.role === "text" ? familyDefault : "As the component's text"} />
            </div>
          </details>
        ))
      )}
    </fieldset>
  );
}

/** "Set" beside a kind of text with settings of its own at any size. */
function Changed({ part, role }: { part: Part; role: TextRole }) {
  const set = Boolean(part.typography?.[role]) || Object.values(part.at ?? {}).some((own) => Boolean((own as { typography?: TypographyGroups } | undefined)?.typography?.[role]));
  return set ? <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-normal text-muted">Set</span> : null;
}

function Section({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="border-b border-border last:border-b-0">
      <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium">{title}</summary>
      <div className="flex flex-col gap-4 pb-4">{children}</div>
    </details>
  );
}

function RoleFields({ part, def, onChange, install, familyDefault }: { part: Part; def: RoleDef; onChange: (patch: Patch) => void; install: InstallFont; familyDefault: string }) {
  const { size } = useSizeEdit();
  const shown = typographyAt(part, def.role, size);
  const set = <K extends TypographyKey>(key: K, value: Typography[K] | undefined) => onChange(typographyPatch(part, size, def.role, key, value));
  const field = (key: TypographyKey, label: string) => ({
    mark: <TypoMark part={part} role={def.role} field={key} label={label} onChange={onChange} />,
    muted: inheritedClass(typographySource(part, def.role, key, size), size),
  });
  return (
    <div className="flex flex-col">
      <Section title="Font" open>
        {/* Colour and how solid it is (D180), at the top as in Beaver's panel; per size like every setting here. */}
        <ColorField
          label="Colour"
          {...field("color", "Colour")}
          value={shown.color}
          placeholder="Inherited"
          onChange={(color) => set("color", color)}
          onClear={() => set("color", undefined)}
          opacity={{ value: shown.opacity, onChange: (opacity) => set("opacity", opacity), ...field("opacity", "Opacity") }}
        />
        <GradientText
          value={shown.gradient ?? undefined}
          onChange={(gradient) => set("gradient", gradient)}
          mark={field("gradient", "Gradient text").mark}
          muted={field("gradient", "Gradient text").muted}
        />
        <FontPicker
          label="Family"
          value={shown.family}
          defaultLabel={familyDefault}
          install={install}
          onChange={(family) => set("family", family)}
          mark={field("family", "Family").mark}
        />
        <div className="flex flex-wrap gap-4">
          <SelectField
            label="Weight"
            {...field("weight", "Weight")}
            value={shown.weight === undefined ? "" : String(shown.weight)}
            options={[{ value: "", label: "Default" }, ...TEXT_WEIGHT_VALUES.map((w) => ({ value: String(w), label: `${w} ${TEXT_WEIGHTS[w]}` }))]}
            onChange={(value) => set("weight", value === "" ? undefined : (Number(value) as Typography["weight"]))}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <MeasureField
            label="Size"
            {...field("size", "Size")}
            value={shown.size}
            units={FONT_SIZE_UNITS}
            limits={SIZE_LIMITS}
            defaultUnit="px"
            onChange={(value) => set("size", value)}
          />
          <MeasureField
            label="Line height"
            {...field("lineHeight", "Line height")}
            value={shown.lineHeight}
            units={LINE_HEIGHT_UNITS}
            limits={LINE_HEIGHT_LIMITS}
            defaultUnit=""
            onChange={(value) => set("lineHeight", value)}
          />
        </div>
        {def.align !== false && (
          <ButtonsField
            label="Align"
            {...field("align", "Align")}
            value={shown.align ?? ""}
            options={(Object.keys(TEXT_ALIGNS) as (keyof typeof TEXT_ALIGNS)[]).map((value) => ({ value, label: TEXT_ALIGNS[value] }))}
            onChange={(value) => set("align", value === "" ? undefined : (value as Typography["align"]))}
          />
        )}
      </Section>
      <Section title="Style & spacing">
        <MeasureField
          label="Letter spacing"
          {...field("letterSpacing", "Letter spacing")}
          value={shown.letterSpacing}
          units={LETTER_SPACING_UNITS}
          limits={LETTER_SPACING_LIMITS}
          defaultUnit="px"
          onChange={(value) => set("letterSpacing", value)}
        />
        <ButtonsField
          label="Transform"
          {...field("transform", "Transform")}
          value={shown.transform ?? ""}
          options={(Object.keys(TEXT_TRANSFORMS) as (keyof typeof TEXT_TRANSFORMS)[]).map((value) => ({
            value,
            label: TEXT_TRANSFORMS[value],
            name: TEXT_TRANSFORM_NAMES[value],
          }))}
          onChange={(value) => set("transform", value === "" ? undefined : (value as Typography["transform"]))}
        />
        <div className="flex flex-wrap gap-4">
          <SelectField
            label="Decoration"
            {...field("decoration", "Decoration")}
            value={shown.decoration ?? ""}
            options={[{ value: "", label: "Default" }, ...Object.entries(TEXT_DECORATIONS).map(([value, label]) => ({ value, label }))]}
            onChange={(value) => set("decoration", value === "" ? undefined : (value as Typography["decoration"]))}
          />
          <SelectField
            label="Style"
            {...field("style", "Style")}
            value={shown.style ?? ""}
            options={[{ value: "", label: "Default" }, ...Object.entries(TEXT_STYLES).map(([value, label]) => ({ value, label }))]}
            onChange={(value) => set("style", value === "" ? undefined : (value as Typography["style"]))}
          />
          <SelectField
            label="Variant"
            {...field("variant", "Variant")}
            value={shown.variant ?? ""}
            options={[{ value: "", label: "Default" }, ...Object.entries(TEXT_VARIANTS).map(([value, label]) => ({ value, label }))]}
            onChange={(value) => set("variant", value === "" ? undefined : (value as Typography["variant"]))}
          />
        </div>
      </Section>
      <Section title="Text shadow">
        <ShadowFields
          value={shown.textShadow ?? undefined}
          {...field("textShadow", "Text shadow")}
          onChange={(shadow) => set("textShadow", shadow)}
        />
      </Section>
    </div>
  );
}

/**
 * Beside a typography setting's name: its device icon, and below Extra large where its value comes from, or the size's own
 * mark with a × that gives it back.
 */
export function TypoMark({
  part,
  role,
  field,
  label,
  onChange,
}: {
  part: Part;
  role: TextRole;
  field: TypographyKey;
  label: string;
  onChange: (patch: Patch) => void;
}) {
  const { size } = useSizeEdit();
  const source = typographySource(part, role, field, size);
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle text-xs font-normal">
      <SizeSwitch label={label} />
      {size !== "xl" &&
        (source.own ? (
          <>
            <span data-size-own="" className="rounded bg-surface px-1.5 py-0.5 text-foreground">
              {sizeNote(source, size)}
            </span>
            <button
              type="button"
              onClick={() => onChange(clearTypographyAt(part, size, role, field))}
              aria-label={`Clear ${label.toLowerCase()} for ${SIZE_LABELS[size]}, to take it from the larger sizes again`}
              title="Clear: take it from the larger sizes"
              className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </>
        ) : (
          <span data-size-from="" className="text-muted">
            {sizeNote(source, size)}
          </span>
        ))}
    </span>
  );
}

const unitLabel = (unit: string) => (unit === "" ? "×" : unit);

/** A number and its unit; empty is none (inherited). A value outside the unit's limits is marked and not kept. */
function MeasureField<U extends string>({
  label,
  value,
  units,
  limits,
  defaultUnit,
  onChange,
  mark,
  muted,
}: {
  label: string;
  value: Measure<U> | undefined;
  units: readonly U[];
  limits: Record<U, [number, number]>;
  defaultUnit: U;
  onChange: (value: Measure<U> | undefined) => void;
  mark: ReactNode;
  muted: string;
}) {
  const id = useId();
  const { size } = useSizeEdit();
  // What is being typed, until it is a value the unit allows (kept apart per size and value shown).
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const key = `${size}:${value?.value ?? ""}${value?.unit ?? ""}`;
  const text = draft?.key === key ? draft.text : value ? String(value.value) : "";
  const unit = value?.unit ?? defaultUnit;
  const [min, max] = limits[unit];
  const typed = Number(text);
  const invalid = text.trim() !== "" && (!Number.isFinite(typed) || typed < min || typed > max);
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {mark}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          max={max}
          value={text}
          placeholder="Default"
          aria-invalid={invalid}
          aria-describedby={`${id}-range`}
          onChange={(event) => {
            const next = event.target.value;
            setDraft({ key, text: next });
            if (next.trim() === "") return onChange(undefined);
            const n = Number(next);
            if (Number.isFinite(n) && n >= min && n <= max) onChange({ value: n, unit });
          }}
          onBlur={() => setDraft(null)}
          className={`${fieldClass} w-24 aria-invalid:border-red-700`}
        />
        <select
          aria-label={`${label}: unit`}
          value={unit}
          onChange={(event) => {
            const next = event.target.value as U;
            if (value) {
              const [low, high] = limits[next];
              onChange({ value: Math.min(high, Math.max(low, value.value)), unit: next });
            } else setDraft(null);
          }}
          className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
          disabled={!value}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </select>
      </div>
      <span id={`${id}-range`} className="text-xs text-muted">
        {min} to {max} {unit === "" ? "times the size" : unit}
      </span>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  mark,
  muted,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  mark: ReactNode;
  muted: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {mark}
      </div>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-10 rounded-md border border-border bg-background px-2 text-sm">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A few choices as buttons; pressing the chosen one again takes it away (back to the default). */
function ButtonsField({
  label,
  value,
  options,
  onChange,
  mark,
  muted,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; name?: string }[];
  onChange: (value: string) => void;
  mark: ReactNode;
  muted: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
        {mark}
      </div>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            aria-label={option.name}
            title={option.name}
            onClick={() => onChange(value === option.value ? "" : option.value)}
            className="min-h-10 min-w-10 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-surface aria-pressed:font-medium"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Letters filled with a gradient (D183): on or off, two to four colours at an angle, and the store's saved gradients to start from or add to. */
function GradientText({ value, onChange, mark, muted }: { value: TextGradient | undefined; onChange: (gradient: TextGradient | undefined) => void; mark: ReactNode; muted: string }) {
  const id = useId();
  // A colour field keeps what is typed in it, so when colours come or go the fields start again.
  const [revision, setRevision] = useState(0);
  const gradient = value ?? newTextGradient();
  const colours = gradient.colors;
  return (
    <div className={`flex flex-col gap-3 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label className="flex items-center gap-2 text-sm font-medium" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked ? gradient : undefined)} className="size-4" />
          Gradient text
        </label>
        {mark}
      </div>
      {value && (
        <div className="flex flex-col gap-3 pl-6">
          <p className="text-xs text-muted">The letters are filled with these colours, over the text colour.</p>
          <div className="h-6 rounded border border-border" aria-hidden style={{ backgroundImage: `linear-gradient(${gradient.angle}deg, ${colours.join(", ")})` }} />
          <SavedGradients
            label="Text gradient"
            current={{ style: "shift", colors: colours, angle: gradient.angle }}
            onPick={(saved) => {
              setRevision((n) => n + 1);
              onChange(textGradientOf(saved));
            }}
          />
          <ul className="flex flex-wrap items-end gap-3">
            {colours.map((colour, index) => (
              <li key={`${revision}-${index}`} className="flex items-end gap-2">
                <ColorField
                  label={`Colour ${index + 1}`}
                  value={colour}
                  noSwatches={false}
                  onChange={(next) => onChange({ ...gradient, colors: colours.map((c, i) => (i === index ? next : c)) })}
                />
                <button
                  type="button"
                  disabled={colours.length <= TEXT_GRADIENT_COLORS.min}
                  onClick={() => {
                    setRevision((n) => n + 1);
                    onChange({ ...gradient, colors: colours.filter((_, i) => i !== index) });
                  }}
                  aria-label={`Remove colour ${index + 1}`}
                  className="min-h-10 rounded-md border border-border px-2 text-xs hover:bg-surface disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              disabled={colours.length >= TEXT_GRADIENT_COLORS.max}
              onClick={() => {
                setRevision((n) => n + 1);
                onChange({ ...gradient, colors: [...colours, colours[colours.length - 1]] });
              }}
              className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-surface disabled:opacity-50"
            >
              Add a colour
            </button>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Angle
            <span className="flex items-center gap-3 font-normal">
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={gradient.angle}
                aria-valuetext={`${gradient.angle} degrees`}
                onChange={(event) => onChange({ ...gradient, angle: Number(event.target.value) })}
                className="w-48 accent-foreground"
              />
              <output className="w-12 tabular-nums">{gradient.angle}°</output>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

const NO_SHADOW: TextShadow = { color: "#000000", x: 1, y: 1, blur: 2 };

/** A shadow behind the letters: on or off, its colour, and how far it falls (x, y) and how soft it is, in pixels. */
function ShadowFields({ value, onChange, mark, muted }: { value: TextShadow | undefined; onChange: (shadow: TextShadow | undefined) => void; mark: ReactNode; muted: string }) {
  const id = useId();
  const shadow = value ?? NO_SHADOW;
  const number = (key: "x" | "y" | "blur", label: string, min: number, max: number) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={shadow[key]}
          disabled={!value}
          onChange={(event) => {
            const n = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(n)) onChange({ ...shadow, [key]: Math.min(max, Math.max(min, n)) });
          }}
          className={`${fieldClass} w-20`}
        />
        <span className="font-normal text-muted">px</span>
      </span>
      <PixelRange value={shadow[key]} min={min} max={max} disabled={!value} label={`Shadow ${label}, slider`} onChange={(next) => onChange({ ...shadow, [key]: next })} className="w-28" />
    </label>
  );
  return (
    <div className={`flex flex-col gap-3 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label className="flex items-center gap-2 text-sm font-medium" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked ? shadow : undefined)} className="size-4" />
          Shadow behind the letters
        </label>
        {mark}
      </div>
      {value && (
        <div className="flex flex-col gap-3 pl-6">
          <ColorField label="Colour" value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} />
          <div className="flex flex-wrap gap-4">
            {number("x", "X", -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX)}
            {number("y", "Y", -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX)}
            {number("blur", "Blur", 0, SHADOW_BLUR_MAX)}
          </div>
        </div>
      )}
    </div>
  );
}

