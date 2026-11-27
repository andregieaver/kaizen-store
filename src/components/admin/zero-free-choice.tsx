"use client";

import { Select } from "@/components/admin/ui/field";

export type ZeroFreeWords = { label: string; inherit: string; free: string; amount: string };

/**
 * Whether a price of nothing says Free (D913), for a category, a tag or a product: as the level above, Free, or the amount. The store's own choice is
 * a checkbox on Settings, Products; the most specific level that says something wins (`commerce.zero_shows_free()`).
 */
export function ZeroFreeChoice({ id, value, onChange, words }: { id: string; value: boolean | null; onChange: (next: boolean | null) => void; words: ZeroFreeWords }) {
  return (
    <label htmlFor={id} className="flex max-w-xs flex-col gap-1 text-xs font-medium">
      {words.label}
      <Select id={id} dense value={value === null ? "" : value ? "free" : "amount"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "free")}>
        <option value="">{words.inherit}</option>
        <option value="free">{words.free}</option>
        <option value="amount">{words.amount}</option>
      </Select>
    </label>
  );
}
