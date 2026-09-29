"use client";

import { FIELD_CATEGORIES, FIELD_TYPES, FIELD_TYPE_KEYS, type FieldType } from "@/lib/custom-fields";

import { Modal } from "./modal";

const hint = "text-xs font-normal text-muted";

/**
 * Choosing the type of a new field: labelled and explained, grouped as the
 * library groups them (Basic, Choice, Content, Date and colour, Relational,
 * Layout). `types` limits the choice: the fields inside a group or repeater
 * are of any type but those two.
 */
export function FieldTypePicker({
  open,
  onClose,
  onPick,
  types = FIELD_TYPE_KEYS,
  title = "Add a field",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: FieldType) => void;
  types?: readonly FieldType[];
  title?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="flex flex-col gap-5">
        {FIELD_CATEGORIES.map((category) => {
          const inCategory = FIELD_TYPE_KEYS.filter(
            (type) => types.includes(type) && FIELD_TYPES[type].category === category,
          );
          if (inCategory.length === 0) return null;
          return (
            <section key={category} aria-label={category}>
              <h3 className="mb-2 text-sm font-medium">{category}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {inCategory.map((type) => (
                  <li key={type}>
                    <button
                      type="button"
                      onClick={() => onPick(type)}
                      className="flex h-full w-full flex-col items-start gap-0.5 rounded-md border border-border p-3 text-left hover:border-foreground hover:bg-surface"
                    >
                      <span className="text-sm font-medium">{FIELD_TYPES[type].label}</span>
                      <span className={hint}>{FIELD_TYPES[type].hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className={hint}>
          Not here: raw HTML, scripts and CSS. Pages and the site&apos;s own code have their places for those.
        </p>
      </div>
    </Modal>
  );
}
