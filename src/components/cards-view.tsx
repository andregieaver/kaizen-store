import type { CSSProperties } from "react";

import { cardShows, type CardBadgeTone, type CardItem, type CardsBlock } from "@/lib/page-content";

import { CardsFilter } from "./lazy/blocks";
import { ListIcon } from "./list-icon";

/** The grid's columns: one on a phone, at most two on a tablet, the block's own on a wide screen; written out, as the stylesheet holds them already. */
const COLUMNS: Record<CardsBlock["columns"], string> = { 1: "", 2: "md:grid-cols-2", 3: "md:grid-cols-2 lg:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };

/** A badge's colours: the theme's for neutral and accent, the usual signal colours for green and orange, each on a soft tint of itself. */
const TONES: Record<CardBadgeTone, CSSProperties> = {
  neutral: { color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--border)" },
  accent: { color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 16%, transparent)" },
  success: { color: "#22a04b", background: "color-mix(in srgb, #22a04b 16%, transparent)" },
  warning: { color: "#e07b00", background: "color-mix(in srgb, #e07b00 16%, transparent)" },
};

/** A card's marker: its icon in a soft circle of its colour, its number on the accent, its letters on their colour, or its round picture. */
function Marker({ block, item, index }: { block: CardsBlock; item: CardItem; index: number }) {
  switch (block.marker) {
    case "icon":
      return item.icon ? (
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-full ${item.color ? "" : "text-accent"}`}
          style={{ ...(item.color ? { color: item.color } : {}), background: "color-mix(in srgb, currentColor 16%, transparent)" }}
        >
          <ListIcon name={item.icon} className="size-5" />
        </span>
      ) : null;
    case "number":
      return (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {index + 1}
        </span>
      );
    case "letter":
      return item.letters ? (
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-base font-bold text-white"
          style={{ background: item.color ?? "var(--accent)" }}
        >
          {item.letters}
        </span>
      ) : null;
    case "picture":
      return item.picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- the store's own picture, drawn at its box's size
        <img
          src={item.picture.url}
          alt={item.picture.alt || item.title}
          width={item.picture.width}
          height={item.picture.height}
          loading="lazy"
          className="size-40 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span aria-hidden className="flex size-40 shrink-0 items-center justify-center rounded-full bg-surface text-3xl font-semibold text-muted">
          {(item.letters || item.title.trim().slice(0, 1)).toUpperCase()}
        </span>
      );
    default:
      return null;
  }
}

/**
 * Cards (D916) on the site: a grid of cards alike, each with its marker, small line, title, badge, words, points and link, in the block's
 * columns on wide screens (at most two on a tablet, one on a phone). Drawn on the server; with `filters` on and more than one group, chips
 * over the grid show one group at a time (`CardsFilter`), and every card is in the page without script.
 */
export function CardsView({ block }: { block: CardsBlock }) {
  const items = block.items.filter(cardShows);
  if (items.length === 0) return null;
  const boxed = (block.look ?? "boxed") === "boxed";
  const centred = block.centred === true;
  const groups = block.filters ? [...new Set(items.map((item) => item.group.trim()).filter(Boolean))] : [];
  const listId = `cards-${block.id}`;
  const pointStyle: CSSProperties | undefined = block.pointColor ? { color: block.pointColor } : undefined;
  return (
    <div className="kz-cards flex flex-col gap-6">
      {groups.length > 1 && (
        <CardsFilter
          list={listId}
          all={block.allLabel?.trim() || "All"}
          total={items.length}
          groups={groups.map((name) => ({ name, count: items.filter((item) => item.group.trim() === name).length }))}
        />
      )}
      <ul id={listId} className={`grid gap-4 ${COLUMNS[block.columns]}`} data-cards="">
        {items.map((item, index) => (
          <li
            key={item.id}
            data-group={item.group.trim() || undefined}
            className={`flex flex-col gap-3 ${boxed ? "rounded-card border border-border bg-surface p-6" : ""} ${centred ? "items-center text-center" : ""}`}
          >
            <Marker block={block} item={item} index={index} />
            {item.eyebrow.trim() && (
              <p data-kz-text="meta" className="text-xs font-semibold tracking-widest text-accent uppercase">
                {item.eyebrow}
              </p>
            )}
            {(item.title.trim() || item.badge.trim()) && (
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${centred ? "justify-center" : "justify-between"}`}>
                {item.title.trim() && (
                  <p data-kz-text="title" className="text-lg leading-snug font-semibold text-balance">
                    {item.title}
                  </p>
                )}
                {item.badge.trim() && (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style={TONES[item.badgeTone ?? "neutral"]}>
                    {item.badge}
                  </span>
                )}
              </div>
            )}
            {item.text.trim() && (
              <p data-kz-text="body" className="text-sm whitespace-pre-line text-muted [overflow-wrap:anywhere]">
                {item.text}
              </p>
            )}
            {item.points.some((point) => point.text.trim()) && (
              <ul className={`flex flex-col gap-2 text-sm ${centred ? "items-center" : ""}`}>
                {item.points
                  .filter((point) => point.text.trim())
                  .map((point) => (
                    <li key={point.id} className="flex gap-2 text-left">
                      {(block.pointMark ?? "check") === "check" ? (
                        <ListIcon name="circleCheck" className={`mt-0.5 size-4 shrink-0 ${block.pointColor ? "" : "text-accent"}`} style={pointStyle} />
                      ) : (
                        <span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full bg-current ${block.pointColor ? "" : "text-accent"}`} style={pointStyle} />
                      )}
                      <span>{point.text}</span>
                    </li>
                  ))}
              </ul>
            )}
            {item.href.trim() && (
              <a href={item.href} className="mt-auto text-sm font-medium text-accent underline-offset-2 hover:underline">
                {item.linkLabel.trim() || item.title}
                <span aria-hidden> →</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
