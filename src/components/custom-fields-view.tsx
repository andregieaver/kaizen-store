import Link from "next/link";
import type { ReactNode } from "react";

import { EmbeddedVideo } from "@/components/video-view";
import { RichText } from "@/components/rich-text";
import type { ShownBlock, ShownField, ShownGroup, ShownLink } from "@/lib/custom-fields";
import {
  drawable,
  drawableBlocks,
  drawableChildren,
  drawableRows,
  fileKind,
  isHexColor,
  isInternalAddress,
  isWebAddress,
  linksOf,
  mailAddress,
  phoneNumber,
  pictureOf,
  picturesOf,
  repeaterColumns,
  standsAlone,
  videoOf,
} from "@/lib/field-parts";
import { fileSize } from "@/lib/file-size";
import type { FieldDisplay, RichTextDoc } from "@/lib/page-content";

/**
 * A store's custom fields (D118) as the site draws them, in product layouts
 * (`ProductPartView`) and pages (`CustomFieldSection`): a group's fields as
 * a specification table, a list of `label: value` lines or small cards.
 * Values arrive resolved for the shopper's language (`ShownField`) and are
 * checked again as they are drawn (`src/lib/field-parts.ts`): an address is
 * a link only if it is one, and rich text is drawn as elements, never as
 * HTML. Nothing to show draws nothing.
 */

const LINK = "underline underline-offset-2 hover:no-underline";

/** A link to a safe address: a page of the site goes through the router, anything else is a plain link. */
function Anchor({ link, className = LINK, children }: { link: ShownLink; className?: string; children?: ReactNode }) {
  const content = children ?? link.label;
  const target = link.newTab ? ({ target: "_blank" } as const) : {};
  return isInternalAddress(link.href) ? (
    <Link href={link.href} className={className} {...target} rel={link.newTab ? "noopener noreferrer" : undefined}>
      {content}
    </Link>
  ) : (
    <a href={link.href} className={`${className} break-words`} {...target} rel="noopener noreferrer">
      {content}
    </a>
  );
}

/** Things a field points at (products, pages), as a small grid of pictures when any has one, else a list of links. */
function RelatedLinks({ links }: { links: ShownLink[] }) {
  if (links.some((link) => link.image)) {
    return (
      <ul className="grid grid-cols-2 gap-3 kzb-md-cols-3">
        {links.map((link, index) => (
          <li key={`${link.href}-${index}`}>
            <Anchor link={link} className="group flex flex-col gap-2 no-underline">
              {link.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- a library picture whose size is not known here; the link's words name it
                <img
                  src={link.image}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-lg bg-surface object-cover"
                />
              ) : (
                <span aria-hidden className="aspect-square w-full rounded-lg bg-surface" />
              )}
              <span className="text-sm underline-offset-2 group-hover:underline">{link.label}</span>
            </Anchor>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {links.map((link, index) => (
        <li key={`${link.href}-${index}`}>
          <Anchor link={link} />
        </li>
      ))}
    </ul>
  );
}

/** A group's fields as a nested list (a repeater inside one is drawn as a list, to stay compact); labels always show, as without them its values would not say what they are. */
function NestedFields({ fields }: { fields: ShownField[] }) {
  return (
    <dl className="flex flex-col gap-2">
      {fields.map((field) => (
        <div key={field.id} className="grid gap-0.5 kzb-md-cols-label kzb-md-gap-3">
          <dt className="text-muted">{field.label}</dt>
          <dd className="min-w-0">{fieldValue(field, "list")}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A repeater's rows: a table with a column per field (wide ones scroll on their own), a list of blocks or cards. */
function Rows({ rows, display }: { rows: ShownField[][]; display: FieldDisplay }) {
  if (display === "table") {
    const columns = repeaterColumns(rows);
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {columns.map((column) => (
                <th key={column.id} scope="col" className="px-3 py-2 align-bottom font-medium text-muted">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => {
                  const cell = row.find((field) => field.id === column.id);
                  return (
                    <td key={column.id} className="px-3 py-2 align-top">
                      {cell ? fieldValue(cell, "list") : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ul className={display === "cards" ? "grid gap-3 kzb-md-cols-2" : "flex flex-col gap-3"}>
      {rows.map((row, index) => (
        <li
          key={index}
          className={display === "cards" ? "rounded-lg border border-border p-4" : "border-l-2 border-border pl-3"}
        >
          <NestedFields fields={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Flexible content's rows, each a block of its own in order: nothing heads a
 * row but its content (its layout's label is only an aria label), and the
 * fields of a row are drawn by `fieldValue()` as a repeater's cells are. A
 * value that says what it is on its own (a paragraph, a picture, a video) is
 * drawn bare; a number, a date or an amount keeps its label. `cards` puts each
 * row in a box.
 */
function FlexibleBlocks({ blocks, display }: { blocks: ShownBlock[]; display: FieldDisplay }) {
  return (
    <ol className={display === "cards" ? "grid gap-3" : "flex flex-col gap-4"}>
      {blocks.map((block, index) => (
        <li
          key={index}
          aria-label={block.label}
          data-layout={block.layout}
          className={`flex flex-col gap-2 ${display === "cards" ? "rounded-lg border border-border p-4" : ""}`}
        >
          {block.fields.map((field) => (
            <div key={field.id} className="min-w-0">
              {standsAlone(field) ? (
                fieldValue(field, "list")
              ) : (
                <>
                  <span className="font-medium" data-kz-text="label">
                    {field.label}:{" "}
                  </span>
                  {fieldValue(field, "list")}
                </>
              )}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** One field's value as elements; call only for a `drawable()` field. */
export function fieldValue(field: ShownField, display: FieldDisplay = "table"): ReactNode {
  const { type, value, text } = field;
  switch (type) {
    case "file": {
      const [file] = linksOf(field);
      if (!file) return null;
      const kind = fileKind(file.contentType, file.label);
      const details = [kind, file.size ? fileSize(file.size) : null].filter(Boolean).join(" · ");
      return (
        <span>
          <a href={file.href} download rel="noopener noreferrer" className={`${LINK} break-words`}>
            {file.label}
          </a>
          {details && <span className="ml-2 text-muted">{details}</span>}
        </span>
      );
    }
    case "link": {
      const [link] = linksOf(field);
      return link ? <Anchor link={link} /> : null;
    }
    case "product":
    case "page":
      return <RelatedLinks links={linksOf(field)} />;
    case "term":
      return (
        <span>
          {linksOf(field).map((link, index) => (
            <span key={`${link.href}-${index}`}>
              {index > 0 && ", "}
              <Anchor link={link} />
            </span>
          ))}
        </span>
      );
    case "group":
      return <NestedFields fields={drawableChildren(field)} />;
    case "repeater":
      return <Rows rows={drawableRows(field)} display={display} />;
    case "flexible":
      return <FlexibleBlocks blocks={drawableBlocks(field)} display={display} />;
    case "textarea":
      return <div className="whitespace-pre-line">{text}</div>;
    case "email": {
      const address = mailAddress(text);
      return address ? (
        <a href={`mailto:${address}`} className={LINK}>
          {address}
        </a>
      ) : (
        text
      );
    }
    case "phone": {
      const number = phoneNumber(text);
      return number ? (
        <a href={`tel:${number}`} className={LINK}>
          {text}
        </a>
      ) : (
        text
      );
    }
    case "url": {
      const address = text.trim();
      // An anchor on the page opens in the same tab.
      if (/^#\S*$/.test(address))
        return (
          <a href={address} className={`${LINK} break-words`}>
            {address}
          </a>
        );
      return isWebAddress(address) ? (
        <a href={address} target="_blank" rel="noopener noreferrer" className={`${LINK} break-words`}>
          {address}
        </a>
      ) : (
        text
      );
    }
    case "checkbox":
      return (
        <ul className="list-disc space-y-0.5 pl-5">
          {(field.items ?? [])
            .filter((item) => item.trim() !== "")
            .map((item) => (
              <li key={item}>{item}</li>
            ))}
        </ul>
      );
    case "color": {
      const hex = text.trim();
      if (!isHexColor(hex)) return hex;
      return (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: hex }}
          />
          {hex}
        </span>
      );
    }
    case "richText":
      return <RichText doc={value as RichTextDoc} />;
    case "image": {
      const picture = pictureOf(value);
      return picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- a library picture whose size is not known here, shown as it is
        <img src={picture.url} alt={picture.alt} loading="lazy" className="h-auto max-w-full rounded-lg bg-surface" />
      ) : null;
    }
    case "gallery":
      return (
        <ul className="grid grid-cols-2 gap-2 kzb-md-cols-3">
          {picturesOf(value).map((picture, index) => (
            <li key={`${picture.url}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img
                src={picture.thumbnailUrl ?? picture.url}
                alt={picture.alt}
                loading="lazy"
                className="aspect-square w-full rounded-lg bg-surface object-cover"
              />
            </li>
          ))}
        </ul>
      );
    case "video": {
      const video = videoOf(value);
      // The page's video component's click-to-play embed: nothing is fetched from the video site before it is played.
      return video ? (
        <EmbeddedVideo
          source={video.video.source}
          player={video.player}
          poster={undefined}
          title={field.label}
          style={{ aspectRatio: "16 / 9" }}
        />
      ) : null;
    }
    default:
      // Text, number, measurement, money, date, time, choices and yes/no: already worded for the language (money in the market's currency, without VAT).
      return text;
  }
}

/** Values that flow in a line of text; the others (pictures, videos, lists, rich text) take a block of their own. */
const isInline = (field: ShownField): boolean =>
  !["richText", "image", "gallery", "video", "checkbox", "textarea", "product", "page", "group", "repeater", "flexible"].includes(
    field.type,
  );

/**
 * Fields in one display: `table` (label left, value right, the default),
 * `list` (label: value lines) or `cards` (a bordered card each, in a grid).
 * Without `showLabel` only the values are drawn.
 */
export function CustomFieldsList({
  fields,
  display = "table",
  showLabel = true,
}: {
  fields: ShownField[];
  display?: FieldDisplay;
  showLabel?: boolean;
}) {
  const shown = fields.filter(drawable);
  if (shown.length === 0) return null;

  if (display === "list") {
    return (
      <ul className="flex flex-col gap-2 text-sm" data-kz-text="value">
        {shown.map((field) => (
          <li key={field.id} className="flex flex-col gap-1">
            {isInline(field) ? (
              <div>
                {showLabel && (
                  <span className="font-medium" data-kz-text="label">
                    {field.label}:{" "}
                  </span>
                )}
                {fieldValue(field, display)}
              </div>
            ) : (
              <>
                {showLabel && (
                  <div className="font-medium" data-kz-text="label">
                    {field.label}
                  </div>
                )}
                {fieldValue(field, display)}
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (display === "cards") {
    return (
      <dl className="grid gap-3 text-sm kzb-md-cols-2 kzb-lg-cols-3">
        {shown.map((field) => (
          <div key={field.id} className="flex flex-col gap-1 rounded-lg border border-border p-4">
            {showLabel && <dt className="text-xs font-medium tracking-wide text-muted uppercase">{field.label}</dt>}
            <dd className="min-w-0">{fieldValue(field, display)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="divide-y divide-border rounded-lg border border-border text-sm">
      {shown.map((field) => (
        <div
          key={field.id}
          className={
            // A repeater's table wants the whole width, so its label goes above it.
            showLabel && field.type !== "repeater" && field.type !== "flexible"
              ? "grid gap-1 px-4 py-3 kzb-md-cols-label kzb-md-gap-4"
              : "flex flex-col gap-1 px-4 py-3"
          }
        >
          {showLabel && <dt className="text-muted">{field.label}</dt>}
          <dd className="min-w-0">{fieldValue(field, display)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A group of fields, with its heading over it when `heading` is given (the
 * caller decides: the component's own words, else the group's name).
 */
export function CustomFieldsGroup({
  group,
  display,
  showLabel,
  heading,
  id,
}: {
  group: ShownGroup;
  display?: FieldDisplay;
  showLabel?: boolean;
  heading?: string | null;
  /** The heading's id, for `aria-labelledby`. */
  id: string;
}) {
  if (!group.fields.some(drawable)) return null;
  return (
    <section
      aria-labelledby={heading ? id : undefined}
      aria-label={heading ? undefined : group.name}
      className="flex flex-col gap-2"
    >
      {heading && (
        <h2 id={id} className="font-medium">
          {heading}
        </h2>
      )}
      <CustomFieldsList fields={group.fields} display={display} showLabel={showLabel} />
    </section>
  );
}

/** One field on its own, in the same displays, with a heading over it only when the owner wrote one. */
export function CustomFieldView({
  field,
  display,
  showLabel,
  heading,
  id,
}: {
  field: ShownField;
  display?: FieldDisplay;
  showLabel?: boolean;
  heading?: string | null;
  id: string;
}) {
  if (!drawable(field)) return null;
  return (
    <section
      aria-labelledby={heading ? id : undefined}
      aria-label={heading ? undefined : field.label}
      className="flex flex-col gap-2"
    >
      {heading && (
        <h2 id={id} className="font-medium">
          {heading}
        </h2>
      )}
      <CustomFieldsList fields={[field]} display={display} showLabel={showLabel} />
    </section>
  );
}

/** The groups of a store's fields that apply to a thing, drawn one under another with their names over them. */
export function CustomFieldGroups({
  groups,
  display,
  showLabel,
  idPrefix,
  headingFor,
}: {
  groups: ShownGroup[];
  display?: FieldDisplay;
  showLabel?: boolean;
  idPrefix: string;
  /** The heading over a group: its name, the component's own words, or none. */
  headingFor: (group: ShownGroup) => string | null;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <CustomFieldsGroup
          key={group.id}
          group={group}
          display={display}
          showLabel={showLabel}
          heading={headingFor(group)}
          id={`${idPrefix}-${group.id}-heading`}
        />
      ))}
    </div>
  );
}
