"use client";

import { Select } from "@/components/admin/ui/field";

export type InheritWords = { label: string; inherit: string; on: string; off: string };

/**
 * A category's, a tag's or a product's own yes or no, or the level above's: whether a price of nothing says Free (D913, `commerce.zero_shows_free()`),
 * and whether Buy now goes past the cart page (D915, `commerce.skips_cart()`). The store's own choice is on its Settings page; the most specific
 * level that says something wins.
 */
export function InheritChoice({ id, value, onChange, words }: { id: string; value: boolean | null; onChange: (next: boolean | null) => void; words: InheritWords }) {
  return (
    <label htmlFor={id} className="flex max-w-xs flex-col gap-1 text-xs font-medium">
      {words.label}
      <Select id={id} dense value={value === null ? "" : value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "on")}>
        <option value="">{words.inherit}</option>
        <option value="on">{words.on}</option>
        <option value="off">{words.off}</option>
      </Select>
    </label>
  );
}
