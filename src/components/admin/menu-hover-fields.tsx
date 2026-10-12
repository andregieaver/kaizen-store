"use client";

import {
  MENU_HOVER_EDGES,
  MENU_HOVER_KINDS,
  MENU_HOVER_TRAVEL,
  MENU_LINE_MAX,
  MENU_RADIUS_MAX,
  type MenuHover,
  type MenuHoverEdge,
  type MenuHoverKind,
  type MenuHoverTravel,
} from "@/lib/menu-hover";

import { Check, Choices, NumberField } from "./block-fields";
import { ColorField } from "./colour-field";
import { GradientText } from "./typography-fields";

const entries = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/**
 * A menu component's hover and active effect (D207): none (the links' own light hover), a line or a background, how it
 * moves, its colours and the text colour, and whether the page shown is marked the same way.
 */
export function MenuHoverFields({ value, onChange }: { value: MenuHover | undefined; onChange: (hover: MenuHover | undefined) => void }) {
  const set = (patch: Partial<MenuHover>) => value && onChange({ ...value, ...patch });
  const kind: MenuHoverKind | "none" = value?.kind ?? "none";
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">Hover and active</legend>
      <p className="text-xs text-muted">How the links answer the pointer, and how the link of the page a visitor is on is shown. Times and easing follow the theme&apos;s hover timing, or this component&apos;s own under Motion.</p>
      <Choices<MenuHoverKind | "none">
        legend="Effect"
        options={[{ value: "none", label: "Light shade" }, ...entries(MENU_HOVER_KINDS)]}
        value={kind}
        onChange={(next) => onChange(next === "none" ? undefined : { ...value, kind: next })}
      />
      {value && (
        <>
          <Choices<MenuHoverTravel>
            legend="Movement"
            options={entries(MENU_HOVER_TRAVEL)}
            value={value.travel ?? "grow"}
            onChange={(travel) => set({ travel })}
          />
          {value.kind === "line" && (
            <>
              <Choices<MenuHoverEdge> legend="Line" options={entries(MENU_HOVER_EDGES)} value={value.edge ?? "below"} onChange={(edge) => set({ edge })} />
              <NumberField label="Thickness" value={value.thickness ?? 2} min={1} max={MENU_LINE_MAX} unit="px" onChange={(thickness) => set({ thickness })} />
            </>
          )}
          <ColorField
            label={value.kind === "line" ? "Line colour" : "Background colour"}
            value={value.color}
            placeholder="The theme's accent"
            onChange={(color) => set({ color })}
            onClear={() => set({ color: undefined })}
          />
          {value.kind === "background" && (
            <>
              <GradientText
                label="Background gradient"
                hint="The background is filled with these colours, over the background colour."
                value={value.gradient}
                onChange={(gradient) => set({ gradient })}
                mark={null}
                muted=""
              />
              <NumberField label="Corners" value={value.radius ?? 6} min={0} max={MENU_RADIUS_MAX} unit="px" onChange={(radius) => set({ radius })} />
            </>
          )}
          <ColorField
            label="Text colour"
            value={value.textColor}
            placeholder="As the links are"
            onChange={(textColor) => set({ textColor })}
            onClear={() => set({ textColor: undefined })}
          />
          <Check
            label="Show the page visitors are on the same way"
            hint="The link to the page shown keeps the effect while the pointer is elsewhere."
            checked={value.active !== false}
            onChange={(active) => set({ active: active ? undefined : false })}
          />
        </>
      )}
    </fieldset>
  );
}
