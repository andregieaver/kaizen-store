"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "./icons";

/** A choice in a dropdown: its words, an optional picture, and what shows beside it (a price, stock). */
export type DropdownOption = {
  value: string;
  label: string;
  /** Beside the label, such as the price; shown in the list and on the closed dropdown. */
  detail?: ReactNode;
  /** Under the label in the list, such as the stock. */
  note?: ReactNode;
  image?: { url: string; alt?: string } | null;
  disabled?: boolean;
};

/**
 * The storefront's dropdown, drawn in the store's theme with room for a
 * picture beside each choice (a variant's thumbnail), where a native select
 * can show only text. It is a select-only combobox (WAI-ARIA): the arrow
 * keys, Home and End move through the choices, Enter or Space chooses,
 * Escape closes, typing jumps to a choice starting with the letters, and a
 * choice that cannot be had is shown but skipped.
 */
export function Dropdown({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  placement = "down",
  className = "",
  size = "normal",
  spanParent = false,
}: {
  label: string;
  /** Keep the label for screen readers only (the bar on phones). */
  hideLabel?: boolean;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  /** Open upwards at the bottom of the screen. */
  placement?: "down" | "up";
  className?: string;
  size?: "normal" | "compact";
  /** Open the list across the nearest positioned parent (the bar on phones), not just under the dropdown. */
  spanParent?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const selected = options.find((o) => o.value === value) ?? options[0];
  const optionId = (index: number) => `${id}-option-${index}`;

  // Closes when the shopper clicks or taps elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // Keeps the active choice in view as it moves.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId only depends on id
  }, [open, active]);

  const enabled = (index: number) => index >= 0 && index < options.length && !options[index].disabled;
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (enabled(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const openAt = (index: number) => {
    setActive(enabled(index) ? index : first());
    setOpen(true);
  };
  const choose = (index: number) => {
    if (!enabled(index)) return;
    onChange(options[index].value);
    setOpen(false);
    boxRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value);
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openAt(event.key === "ArrowUp" && current < 0 ? last() : current);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        openAt(event.key === "Home" ? first() : last());
      } else if (event.key.length === 1) {
        jump(event.key, current);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((a) => step(a, -1));
        break;
      case "Home":
      case "PageUp":
        event.preventDefault();
        setActive(first());
        break;
      case "End":
      case "PageDown":
        event.preventDefault();
        setActive(last());
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        choose(active);
        break;
      default:
        if (event.key.length === 1) jump(event.key, active);
    }
  };

  /** Typing moves to the next choice starting with what was typed in the last half second. */
  const jump = (key: string, from: number) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 500 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const text = typed.current.text;
    const order = [...options.keys()].map((i) => (from + (text.length > 1 ? 0 : 1) + i) % options.length);
    const found = order.find((i) => enabled(i) && options[i].label.toLowerCase().startsWith(text));
    if (found === undefined) return;
    if (open) setActive(found);
    else onChange(options[found].value);
  };

  const picture = (option: DropdownOption, box: string) =>
    option.image ? (
      // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
      <img src={option.image.url} alt={option.image.alt ?? ""} className={`${box} shrink-0 rounded-md bg-surface object-cover`} />
    ) : null;
  const pictures = options.some((o) => o.image);
  const thumb = size === "compact" ? "size-8" : "size-10";

  return (
    <div ref={rootRef} className={`${spanParent ? "" : "relative"} ${className}`}>
      <span id={`${id}-label`} className={hideLabel ? "sr-only" : "mb-1 block text-sm font-medium"}>
        {label}
      </span>
      <div
        ref={boxRef}
        role="combobox"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openAt(options.findIndex((o) => o.value === value)))}
        onKeyDown={onKeyDown}
        className={`rounded-button flex w-full cursor-pointer items-center border border-border bg-background text-left outline-offset-2 select-none hover:border-foreground/40 ${
          size === "compact" ? "min-h-11 gap-2 px-1.5 py-1 text-sm" : "min-h-12 gap-3 px-3 py-2"
        }`}
      >
        {selected && picture(selected, thumb)}
        {size === "compact" ? (
          // Little room: the label over its detail.
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate">{selected?.label}</span>
            {selected?.detail && <span className="font-semibold whitespace-nowrap">{selected.detail}</span>}
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
            {selected?.detail && <span className="shrink-0 text-sm">{selected.detail}</span>}
          </>
        )}
        <Icon name="chevron" className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${open === (placement === "down") ? "rotate-180" : ""}`} />
      </div>
      <ul
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-labelledby={`${id}-label`}
        tabIndex={-1}
        hidden={!open}
        className={`absolute right-0 left-0 z-40 max-h-[min(22rem,60dvh)] overflow-y-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-xl ${
          placement === "up" ? "bottom-full mb-2" : "top-full mt-1"
        } ${spanParent ? "mx-2" : ""}`}
      >
        {options.map((option, index) => (
          <li
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            onPointerMove={() => enabled(index) && setActive(index)}
            onClick={() => choose(index)}
            className={`flex items-center gap-3 rounded-md px-2 py-2 ${
              option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            } ${index === active ? "bg-surface" : ""}`}
          >
            {pictures && (picture(option, thumb) ?? <span aria-hidden className={`${thumb} shrink-0 rounded-md bg-surface`} />)}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.note && <span className="block text-sm text-muted">{option.note}</span>}
            </span>
            {option.detail && <span className="shrink-0 text-sm">{option.detail}</span>}
            <Icon name="check" className={`size-4 shrink-0 ${option.value === value ? "" : "invisible"}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
