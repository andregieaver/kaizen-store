import type { ReactNode } from "react";

import { EmbeddedVideo } from "@/components/video-view";
import { RichText } from "@/components/rich-text";
import type { ShownField, ShownGroup } from "@/lib/custom-fields";
import {
  drawable,
  isHexColor,
  isWebAddress,
  mailAddress,
  phoneNumber,
  pictureOf,
  picturesOf,
  videoOf,
} from "@/lib/field-parts";
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

/** One field's value as elements; call only for a `drawable()` field. */
export function fieldValue(field: ShownField): ReactNode {
  const { type, value, text } = field;
  switch (type) {
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
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      // Text, number, measurement, date, time, choices and yes/no: already worded for the language.
      return text;
  }
}

/** Values that flow in a line of text; the others (pictures, videos, lists, rich text) take a block of their own. */
const isInline = (field: ShownField): boolean =>
  !["richText", "image", "gallery", "video", "checkbox", "textarea"].includes(field.type);

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
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((field) => (
          <li key={field.id} className="flex flex-col gap-1">
            {isInline(field) ? (
              <div>
                {showLabel && <span className="font-medium">{field.label}: </span>}
                {fieldValue(field)}
              </div>
            ) : (
              <>
                {showLabel && <div className="font-medium">{field.label}</div>}
                {fieldValue(field)}
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (display === "cards") {
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((field) => (
          <div key={field.id} className="flex flex-col gap-1 rounded-lg border border-border p-4">
            {showLabel && <dt className="text-xs font-medium tracking-wide text-muted uppercase">{field.label}</dt>}
            <dd className="min-w-0">{fieldValue(field)}</dd>
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
            showLabel ? "grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4" : "px-4 py-3"
          }
        >
          {showLabel && <dt className="text-muted">{field.label}</dt>}
          <dd className="min-w-0">{fieldValue(field)}</dd>
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
