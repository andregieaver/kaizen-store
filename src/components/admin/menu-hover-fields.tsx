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

import { useAdminText } from "./admin-text";
import { Check, Choices, NumberField } from "./block-fields";
import { ColorField } from "./colour-field";
import { GradientText } from "./typography-fields";

const entries = <T extends string>(labels: Record<T, string>, own?: Partial<Record<T, string>>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: own?.[value] ?? labels[value] }));

/**
 * A menu component's hover and active effect (D207): none (the links' own light hover), a line or a background, how it
 * moves, its colours and the text colour, and whether the page shown is marked the same way.
 */
export function MenuHoverFields({ value, onChange }: { value: MenuHover | undefined; onChange: (hover: MenuHover | undefined) => void }) {
  const set = (patch: Partial<MenuHover>) => value && onChange({ ...value, ...patch });
  const kind: MenuHoverKind | "none" = value?.kind ?? "none";
  const w = useAdminText("blocks").menuHover;
  return (
    <fieldset className="flex flex-col gap-4 rounded-panel border border-line p-4">
      <legend className="px-1 text-sm font-medium">{w.legend}</legend>
      <p className="text-xs text-muted">{w.intro}</p>
      <Choices<MenuHoverKind | "none">
        legend={w.effect}
        options={[{ value: "none", label: w.shade }, ...entries(MENU_HOVER_KINDS, w.kinds)]}
        value={kind}
        onChange={(next) => onChange(next === "none" ? undefined : { ...value, kind: next })}
      />
      {value && (
        <>
          <Choices<MenuHoverTravel>
            legend={w.movement}
            options={entries(MENU_HOVER_TRAVEL, w.travel)}
            value={value.travel ?? "grow"}
            onChange={(travel) => set({ travel })}
          />
          {value.kind === "line" && (
            <>
              <Choices<MenuHoverEdge> legend={w.line} options={entries(MENU_HOVER_EDGES, w.edges)} value={value.edge ?? "below"} onChange={(edge) => set({ edge })} />
              <NumberField label={w.thickness} value={value.thickness ?? 2} min={1} max={MENU_LINE_MAX} unit="px" onChange={(thickness) => set({ thickness })} />
            </>
          )}
          <ColorField
            label={value.kind === "line" ? w.lineColour : w.backgroundColour}
            value={value.color}
            placeholder={w.accent}
            onChange={(color) => set({ color })}
            onClear={() => set({ color: undefined })}
          />
          {value.kind === "background" && (
            <>
              <GradientText
                label={w.gradient}
                hint={w.gradientHint}
                value={value.gradient}
                onChange={(gradient) => set({ gradient })}
                mark={null}
                muted=""
              />
              <NumberField label={w.corners} value={value.radius ?? 6} min={0} max={MENU_RADIUS_MAX} unit="px" onChange={(radius) => set({ radius })} />
            </>
          )}
          <ColorField
            label={w.textColour}
            value={value.textColor}
            placeholder={w.asLinks}
            onChange={(textColor) => set({ textColor })}
            onClear={() => set({ textColor: undefined })}
          />
          <Check
            label={w.active}
            hint={w.activeHint}
            checked={value.active !== false}
            onChange={(active) => set({ active: active ? undefined : false })}
          />
        </>
      )}
    </fieldset>
  );
}
