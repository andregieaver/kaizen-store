"use client";

import { useEffect, useId, useState } from "react";

import type { GridData } from "@/lib/content-grid";
import { copyLeftOut, itemsFromGrid, newCustomItem, newDetailLine } from "@/lib/custom-grid";
import { isCustomPicture } from "@/lib/custom-picture";
import { isSafeAddress } from "@/lib/field-parts";
import type { MenuLink } from "@/lib/navigation";
import {
  CUSTOM_ALT_MAX,
  CUSTOM_BADGE_MAX,
  CUSTOM_BUTTON_MAX,
  CUSTOM_DETAIL_LABEL_MAX,
  CUSTOM_DETAIL_TEXT_MAX,
  CUSTOM_ITEMS_MAX,
  CUSTOM_PRICE_TEXT_MAX,
  CUSTOM_TEXT_MAX,
  CUSTOM_TITLE_MAX,
  TILE_FIELDS_MAX,
  type ContentGridBlock,
  type CustomGridItem,
} from "@/lib/page-content";
import type { ItemLinkTargets } from "@/server/link-targets";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { BlocksMessages } from "@/lib/admin-messages/blocks.en";

import { useAdminText } from "./admin-text";
import { ItemsEditor, TextField, fieldClass, smallButton } from "./block-fields";
import { ImageUploadButton, type Upload } from "./image-upload";
import { targetLink, targetOf, type TargetKind } from "./menu-links";

/**
 * The items of a grid of custom items (D155), written by hand in the builder: each with its picture (uploaded through the
 * media library, with an alt text typed per item), title, text, link, button text, date, badge, price text and up to three
 * detail lines. The same list editor as testimonials and tabs, which keeps each item's id (its texts' translations).
 */

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * What custom items and a carousel do not do (D155), said where they are edited so nobody looks for it: each tile is a picture,
 * words, one link and a few lines, not a free layout.
 */
export const CUSTOM_ITEMS_LIMITS =
  "Not included: slides laid out freely (a hero slider with text and buttons over a picture), tabs, accordions, vertical or fading sliders, thumbnails, videos, a grid inside a card, live prices or filters. Each item is a picture, words, one link and a few lines.";

/** What an item is called in the list. */
export const itemName = (item: CustomGridItem, index: number, w?: BlocksMessages["custom"]): string =>
  item.title.trim() ||
  `${w ? fillWords(w.unnamed, { n: index + 1 }) : `Item ${index + 1}`}${item.text.trim() || item.picture ? "" : (w?.empty ?? " (nothing to show yet)")}`;

export function CustomItemsEditor({
  items,
  onChange,
  upload,
  linkTargets,
}: {
  items: CustomGridItem[];
  onChange: (items: CustomGridItem[]) => void;
  upload: Upload | null;
  /** Asks the owner's pages, products and so on for the link picker, once it is needed. */
  linkTargets: () => Promise<ItemLinkTargets>;
}) {
  const [targets, setTargets] = useState<ItemLinkTargets | null>(null);
  const w = useAdminText("blocks").custom;
  useEffect(() => {
    let alive = true;
    void linkTargets().then((found) => {
      if (alive) setTargets(found);
    });
    return () => {
      alive = false;
    };
  }, [linkTargets]);

  return (
    <div className="flex flex-col gap-3">
      <ItemsEditor<CustomGridItem>
        label={w.items}
        items={items}
        max={CUSTOM_ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => itemName(item, index, w)}
        newItem={() => newCustomItem(newId())}
        duplicate={(item) => ({ ...structuredClone(item), id: newId() })}
        onChange={onChange}
      >
        {(item, change) => <ItemFields item={item} change={change} upload={upload} targets={targets} />}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.order}</p>
      <p className="text-xs text-muted">{w.limits}</p>
    </div>
  );
}

function ItemFields({
  item,
  change,
  upload,
  targets,
}: {
  item: CustomGridItem;
  change: (patch: Partial<CustomGridItem>) => void;
  upload: Upload | null;
  targets: ItemLinkTargets | null;
}) {
  const dateId = useId();
  const w = useAdminText("blocks").custom;
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{w.picture}</p>
        <div className="flex flex-wrap items-center gap-3">
          {item.picture && (
            // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
            <img src={item.picture.url} alt="" className="size-14 rounded-md object-cover" />
          )}
          <ImageUploadButton
            upload={upload}
            label={item.picture ? w.chooseAnother : w.choose}
            current={item.picture}
            onUploaded={(picture, made) => change({ picture: { ...picture, alt: made?.alt ?? item.picture?.alt ?? "" } })}
          />
          {item.picture && (
            <button type="button" onClick={() => change({ picture: null })} className={smallButton}>
              {w.remove}
            </button>
          )}
        </div>
        {item.picture && (
          <TextField
            label={w.describe}
            value={item.picture.alt}
            max={CUSTOM_ALT_MAX}
            hint={w.describeHint}
            onChange={(alt) => change({ picture: item.picture && { ...item.picture, alt } })}
          />
        )}
      </div>
      <TextField label={w.title} markup value={item.title} max={CUSTOM_TITLE_MAX} onChange={(title) => change({ title })} />
      <TextField label={w.text} value={item.text} max={CUSTOM_TEXT_MAX} multiline hint={w.textHint} onChange={(text) => change({ text })} />
      <LinkPicker link={item.link} targets={targets} onChange={(link) => change({ link })} />
      <TextField
        label={w.button}
        markup
        value={item.buttonLabel}
        max={CUSTOM_BUTTON_MAX}
        placeholder={w.buttonPlaceholder}
        hint={w.buttonHint}
        onChange={(buttonLabel) => change({ buttonLabel })}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={dateId} className="text-sm font-medium">
          {w.date} <span className="font-normal text-muted">{w.optional}</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            id={dateId}
            type="date"
            value={item.date ?? ""}
            onChange={(event) => change({ date: event.target.value === "" ? null : event.target.value })}
            className={`${fieldClass} max-w-48`}
          />
          {item.date && (
            <button type="button" onClick={() => change({ date: null })} className={smallButton}>
              {w.clear}
            </button>
          )}
        </div>
      </div>
      <TextField label={w.badge} value={item.badge} max={CUSTOM_BADGE_MAX} placeholder={w.badgePlaceholder} hint={w.badgeHint} onChange={(badge) => change({ badge })} />
      <TextField
        label={w.price}
        markup
        value={item.priceText}
        max={CUSTOM_PRICE_TEXT_MAX}
        placeholder={w.pricePlaceholder}
        hint={w.priceHint}
        onChange={(priceText) => change({ priceText })}
      />
      <DetailLines details={item.details} onChange={(details) => change({ details })} />
    </>
  );
}

/** Up to three lines under the title, each a label and its words, as a tile shows custom fields. */
function DetailLines({ details, onChange }: { details: CustomGridItem["details"]; onChange: (details: CustomGridItem["details"]) => void }) {
  const set = (index: number, patch: Partial<CustomGridItem["details"][number]>) =>
    onChange(details.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const w = useAdminText("blocks").custom;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{w.details}</legend>
      {details.map((line, index) => (
        <div key={line.id} className="flex flex-wrap items-end gap-2">
          <div className="min-w-32 flex-1">
            <TextField label={fillWords(w.label, { n: index + 1 })} value={line.label} max={CUSTOM_DETAIL_LABEL_MAX} placeholder={w.labelPlaceholder} onChange={(label) => set(index, { label })} />
          </div>
          <div className="min-w-40 flex-[2]">
            <TextField label={fillWords(w.words, { n: index + 1 })} value={line.text} max={CUSTOM_DETAIL_TEXT_MAX} placeholder={w.wordsPlaceholder} onChange={(text) => set(index, { text })} />
          </div>
          <button type="button" onClick={() => onChange(details.filter((_, i) => i !== index))} aria-label={fillWords(w.removeLine, { n: index + 1 })} className={`${smallButton} text-danger-text `}>
            {w.remove}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={details.length >= TILE_FIELDS_MAX}
        onClick={() => onChange([...details, newDetailLine(newId())])}
        className={`${smallButton} w-fit`}
      >
        {w.addLine}
      </button>
    </fieldset>
  );
}

const SITE_LINKS: readonly MenuLink["kind"][] = ["home", "products", "blog", "account", "cart"];

/**
 * An item's link: a page, product, article, category or tag of the site by address, one of its own places, or a web
 * address. It is kept by slug and resolved where it is shown, so a copy of the page or store never carries another's ids.
 */
function LinkPicker({ link, targets, onChange }: { link: MenuLink | null; targets: ItemLinkTargets | null; onChange: (link: MenuLink | null) => void }) {
  const id = useId();
  const all = useAdminText("blocks");
  const w = all.custom;
  const withTargets: readonly string[] = ["product", "page", "category", "tag", "article", "blogCategory"];
  // A kind that points at something the owner has none of (no products yet) is not offered.
  const kinds = (targets?.kinds ?? []).filter((kind) => !withTargets.includes(kind.kind) || (targets?.targets[kind.kind as TargetKind]?.length ?? 0) > 0 || kind.kind === link?.kind);
  const target = link ? targetOf(link) : null;
  const options = target ? (targets?.targets[target.kind] ?? []) : [];
  const unsafe = link?.kind === "url" && link.url !== "" && !isSafeAddress(link.url);
  const choose = (kind: string) => {
    if (kind === "") return onChange(null);
    if (kind === "url") return onChange({ kind: "url", url: "" });
    if ((SITE_LINKS as readonly string[]).includes(kind)) return onChange({ kind } as MenuLink);
    const first = targets?.targets[kind as TargetKind]?.[0];
    onChange(first ? (targetLink(kind as TargetKind, first.value, kinds) as MenuLink) : null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-kind`} className="text-sm font-medium">
          {w.linkTo}
        </label>
        <select id={`${id}-kind`} value={link?.kind ?? ""} onChange={(event) => choose(event.target.value)} className={fieldClass} disabled={!targets}>
          <option value="">{w.noLink}</option>
          {kinds.map((kind) => (
            <option key={kind.kind} value={kind.kind}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>
      {link && target && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-target`} className="text-sm font-medium">
            {w.which}
          </label>
          <select
            id={`${id}-target`}
            value={target.value}
            onChange={(event) => onChange(targetLink(target.kind, event.target.value, kinds) as MenuLink)}
            className={fieldClass}
          >
            {!options.some((option) => option.value === target.value) && <option value={target.value}>{fillWords(w.notFound, { value: target.value })}</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
                {option.note ? ` (${option.note})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {link?.kind === "url" && (
        <TextField
          label={w.address}
          value={link.url}
          max={1000}
          placeholder={all.link.addressPlaceholder}
          hint={unsafe ? w.unsafe : w.addressHint}
          onChange={(url) => onChange({ kind: "url", url })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy current items
// ---------------------------------------------------------------------------

/** A picture's size as the browser reads it, or null when it cannot be loaded in a few seconds. */
function measurePicture(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), 4000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * A button over a grid of pages, articles or products (D155): turns what it shows now into custom items to edit, a snapshot
 * with titles, excerpts, pictures and links by address. A product's price is dropped, never turned into words.
 */
export function CopyCurrentItems({
  block,
  platform,
  load,
  onCopied,
}: {
  block: ContentGridBlock;
  /** On Kaizen's own pages, which have no products to link to. */
  platform: boolean;
  load: () => Promise<GridData | { problem: string }>;
  onCopied: (items: CustomGridItem[]) => void;
}) {
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const w = useAdminText("blocks").custom;
  const copy = async () => {
    setState({ busy: true, note: null });
    try {
      const data = await load();
      if ("problem" in data) return setState({ busy: false, note: data.problem });
      if (data.items.length === 0) return setState({ busy: false, note: w.nothingYet });
      const left = copyLeftOut(data.items);
      const sizes = new Map<string, { width: number; height: number } | null>();
      await Promise.all(
        data.items
          .slice(0, CUSTOM_ITEMS_MAX)
          .flatMap((item) => (item.image && isCustomPicture(item.image.url) && !sizes.has(item.image.url) ? [item.image.url] : []))
          .map(async (url) => {
            sizes.set(url, await measurePicture(url));
          }),
      );
      const items = itemsFromGrid(block.source.type, data.items, { newId, platform, pictureSize: (url) => sizes.get(url) ?? null });
      const leftOut = [
        left.restricted > 0 ? fillWords(w.restricted, { n: left.restricted }) : "",
        left.pictures > 0 ? countWords(left.pictures, w.pictures) : "",
      ].filter(Boolean);
      const said = leftOut.length > 0 ? fillWords(w.leftOut, { list: leftOut.join("; ") }) : "";
      // Nothing left to keep (every item is for one kind of buyer): the grid stays as it is.
      if (items.length === 0) return setState({ busy: false, note: fillWords(w.nothingCopied, { said }) });
      onCopied(items);
      const source = (w.sources as Record<string, string>)[block.source.type] ?? block.source.type;
      setState({ busy: false, note: countWords(items.length, w.copied, { source, said }) });
    } catch {
      setState({ busy: false, note: w.failed });
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <p className="text-sm font-medium">{w.startFrom}</p>
      <p className="text-xs text-muted">{w.startHint}</p>
      <button type="button" disabled={state.busy} onClick={() => void copy()} className={`${smallButton} w-fit`}>
        {state.busy ? w.copying : w.copy}
      </button>
      {state.note && (
        <p role="status" className="text-xs text-muted">
          {state.note}
        </p>
      )}
    </div>
  );
}
