"use client";

import { useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { BlocksMessages } from "@/lib/admin-messages/blocks.en";
import type { IconName } from "@/lib/icons";
import {
  PREVIEW_FRAMES,
  PREVIEW_LINES_MAX,
  PREVIEW_MARKS,
  PREVIEW_PART_KINDS,
  PREVIEW_PARTS_MAX,
  PREVIEW_SHORT_MAX,
  PREVIEW_TEXT_MAX,
  PREVIEW_TONES,
  PREVIEW_VALUES_MAX,
  PREVIEW_WEEKS,
  type AppPreviewBlock,
  type PreviewLine,
  type PreviewPart,
  type PreviewPartKind,
} from "@/lib/page-content";

import { useAdminText } from "./admin-text";
import { Check, Choices, IconPicker, ItemsEditor, newItemId, optionsOf, TextField, type BlockEditorProps } from "./block-fields";

type Words = BlocksMessages["appPreview"];
type Change = (patch: Partial<PreviewPart>) => void;

/** Lines typed one on each line, each keeping the id of the line in its place, so its translations stay with it. */
function linesOf<T extends PreviewLine>(previous: readonly T[], text: string, make: (line: PreviewLine, index: number) => T): T[] {
  return text
    .split("\n")
    .slice(0, PREVIEW_LINES_MAX)
    .map((line, index) => make({ id: previous[index]?.id ?? newItemId(), text: line }, index));
}

/** Figures from 0 to 100 as typed, kept as typed while the owner writes, and handed on as numbers. */
function FiguresField({ label, hint, value, parse, onChange }: { label: string; hint: string; value: string; parse: (text: string) => boolean; onChange: (text: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <TextField
      label={label}
      hint={hint}
      multiline={value.includes("\n")}
      value={text}
      max={400}
      onChange={(next) => {
        setText(next);
        if (parse(next)) onChange(next);
      }}
    />
  );
}

const figure = (text: string) => {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};
const figuresIn = (text: string) =>
  text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(figure);

/** A part made anew as another kind, keeping its id, its place and its title where both kinds have one. */
function asKind(part: PreviewPart, kind: PreviewPartKind): PreviewPart {
  const base = { id: part.id, half: part.half, boxed: part.boxed };
  const title = "title" in part ? part.title : "";
  const id = newItemId;
  switch (kind) {
    case "title":
      return { ...base, kind, title, aside: "" };
    case "briefing":
      return { ...base, kind, icon: "sparkles", title, lines: 2 };
    case "checklist":
      return { ...base, kind, title, mark: "tick", items: [true, false, false].map((done) => ({ id: id(), text: "", done })) };
    case "progress":
      return { ...base, kind, value: 66 };
    case "bars":
      return { ...base, kind, title, aside: "", values: [55, 80, 40, 95, 65], soft: 0, captionStart: "", captionEnd: "" };
    case "pairs":
      return { ...base, kind, title, legendFirst: "", legendSecond: "", values: [[70, 60], [85, 90], [60, 50], [90, 80]], caption: "" };
    case "chat":
      return { ...base, kind, title, messages: [{ id: id(), text: "", mine: true }, { id: id(), text: "", mine: false }] };
    case "rings":
      return { ...base, kind, items: [72, 88, 54].map((value) => ({ id: id(), text: "", value })) };
    case "heatmap":
      return { ...base, kind, weeks: 4, on: [2, 5, 9, 12, 13, 18, 22, 25] };
    case "kanban":
      return { ...base, kind, columns: [2, 1, 1].map((n) => ({ id: id(), cards: Array.from({ length: n }, () => ({ id: id(), text: "" })) })) };
    case "rows":
      return { ...base, kind, title, items: (["success", "warning", "muted"] as const).map((tone) => ({ id: id(), text: "", tone })) };
  }
}

/** A note on the right and its colour, as a title and a bar chart have. */
function AsideFields({ w, aside, tone, onChange }: { w: Words; aside: string; tone?: keyof typeof PREVIEW_TONES; onChange: (patch: { aside?: string; asideTone?: keyof typeof PREVIEW_TONES }) => void }) {
  return (
    <>
      <TextField label={w.aside} value={aside} max={PREVIEW_SHORT_MAX} onChange={(next) => onChange({ aside: next })} />
      {aside.trim() && (
        <Choices legend={w.tone} options={optionsOf(PREVIEW_TONES, w.tones)} value={tone ?? "muted"} onChange={(next) => onChange({ asideTone: next === "muted" ? undefined : next })} />
      )}
    </>
  );
}

/** An optional icon before a title. */
function IconChoice({ w, icon, onChange }: { w: Words; icon: IconName | undefined; onChange: (icon: IconName | undefined) => void }) {
  return (
    <>
      <Check label={w.icon} checked={icon !== undefined} onChange={(on) => onChange(on ? "sparkles" : undefined)} />
      {icon && <IconPicker value={icon} onChange={onChange} />}
    </>
  );
}

/** One part's own fields, by its kind. */
function PartFields({ w, part, change }: { w: Words; part: PreviewPart; change: Change }) {
  switch (part.kind) {
    case "title":
      return (
        <>
          <TextField label={w.title} value={part.title} max={PREVIEW_TEXT_MAX} onChange={(title) => change({ title })} />
          <AsideFields w={w} aside={part.aside} tone={part.asideTone} onChange={change} />
          {part.aside.trim() && <Check label={w.pill} checked={part.asidePill === true} onChange={(on) => change({ asidePill: on || undefined })} />}
        </>
      );
    case "briefing":
      return (
        <>
          <IconPicker value={part.icon ?? "sparkles"} onChange={(icon) => change({ icon })} />
          <TextField label={w.title} value={part.title} max={PREVIEW_TEXT_MAX} onChange={(title) => change({ title })} />
          <Choices legend={w.lines} options={["0", "1", "2", "3"].map((n) => ({ value: n, label: n }))} value={String(part.lines)} onChange={(n) => change({ lines: Number(n) })} />
          {part.lines > 0 && <Check label={w.dots} checked={part.dots === true} onChange={(on) => change({ dots: on || undefined })} />}
        </>
      );
    case "checklist": {
      const done = part.items.filter((item) => item.done).length;
      return (
        <>
          <TextField label={w.title} value={part.title} max={PREVIEW_SHORT_MAX} onChange={(title) => change({ title })} />
          <TextField
            label={w.items}
            multiline
            value={part.items.map((item) => item.text).join("\n")}
            max={PREVIEW_TEXT_MAX * PREVIEW_LINES_MAX}
            onChange={(text) => change({ items: linesOf(part.items, text, (line, index) => ({ ...line, done: index < done })) })}
          />
          <Choices
            legend={w.done}
            options={Array.from({ length: part.items.length + 1 }, (_, n) => ({ value: String(n), label: String(n) }))}
            value={String(done)}
            onChange={(n) => change({ items: part.items.map((item, index) => ({ ...item, done: index < Number(n) })) })}
          />
          <Choices legend={w.mark} options={optionsOf(PREVIEW_MARKS, w.marks)} value={part.mark ?? "circle"} onChange={(mark) => change({ mark: mark === "circle" ? undefined : mark })} />
          <Check label={w.divided} checked={part.divided === true} onChange={(on) => change({ divided: on || undefined })} />
        </>
      );
    }
    case "progress":
      return (
        <FiguresField
          label={w.value}
          hint=""
          value={String(part.value)}
          parse={(text) => figure(text.trim()) !== null && text.trim() !== ""}
          onChange={(text) => change({ value: figure(text.trim()) ?? 0 })}
        />
      );
    case "bars":
      return (
        <>
          <IconChoice w={w} icon={part.icon} onChange={(icon) => change({ icon })} />
          <TextField label={w.title} value={part.title} max={PREVIEW_SHORT_MAX} onChange={(title) => change({ title })} />
          <AsideFields w={w} aside={part.aside} tone={part.asideTone} onChange={change} />
          <FiguresField
            label={w.values}
            hint={w.valuesHint}
            value={part.values.join(", ")}
            parse={(text) => {
              const values = figuresIn(text);
              return values.length > 0 && values.length <= PREVIEW_VALUES_MAX && values.every((v) => v !== null);
            }}
            onChange={(text) => change({ values: figuresIn(text) as number[] })}
          />
          <Choices
            legend={w.soft}
            options={["0", "1", "2", "3"].map((n) => ({ value: n, label: n }))}
            value={String(Math.min(3, part.soft))}
            onChange={(n) => change({ soft: Number(n) })}
          />
          <Check label={w.tall} checked={part.tall === true} onChange={(on) => change({ tall: on || undefined })} />
          <TextField label={w.captionStart} value={part.captionStart} max={PREVIEW_SHORT_MAX} onChange={(captionStart) => change({ captionStart })} />
          <TextField label={w.captionEnd} value={part.captionEnd} max={PREVIEW_SHORT_MAX} onChange={(captionEnd) => change({ captionEnd })} />
        </>
      );
    case "pairs":
      return (
        <>
          <TextField label={w.title} value={part.title} max={PREVIEW_SHORT_MAX} onChange={(title) => change({ title })} />
          <TextField label={w.legendFirst} value={part.legendFirst} max={PREVIEW_SHORT_MAX} onChange={(legendFirst) => change({ legendFirst })} />
          <TextField label={w.legendSecond} value={part.legendSecond} max={PREVIEW_SHORT_MAX} onChange={(legendSecond) => change({ legendSecond })} />
          <FiguresField
            label={w.pairs}
            hint={w.pairsHint}
            value={part.values.map((pair) => pair.join(" ")).join("\n")}
            parse={(text) => {
              const lines = text.split("\n").filter((line) => line.trim());
              return lines.length > 0 && lines.length <= PREVIEW_VALUES_MAX && lines.every((line) => figuresIn(line).length === 2 && figuresIn(line).every((v) => v !== null));
            }}
            onChange={(text) =>
              change({
                values: text
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line) => figuresIn(line) as [number, number]),
              })
            }
          />
          <TextField label={w.caption} value={part.caption} max={PREVIEW_TEXT_MAX} onChange={(caption) => change({ caption })} />
        </>
      );
    case "chat":
      return (
        <>
          <TextField label={w.title} value={part.title} max={PREVIEW_SHORT_MAX} onChange={(title) => change({ title })} />
          <TextField
            label={w.messages}
            hint={w.messagesHint}
            multiline
            value={part.messages.map((message) => message.text).join("\n")}
            max={PREVIEW_TEXT_MAX * PREVIEW_LINES_MAX}
            onChange={(text) => change({ messages: linesOf(part.messages, text, (line, index) => ({ ...line, mine: index % 2 === 0 })) })}
          />
        </>
      );
    case "rings":
      return (
        <TextField
          label={w.rings}
          hint={w.ringsHint}
          multiline
          value={part.items.map((item) => `${item.text}: ${item.value}`).join("\n")}
          max={(PREVIEW_TEXT_MAX + 6) * PREVIEW_LINES_MAX}
          onChange={(text) =>
            change({
              items: linesOf(part.items, text, (line, index) => {
                const match = /^(.*?)(?::\s*(\d+(?:[.,]\d+)?)\s*%?)?\s*$/.exec(line.text);
                const value = match?.[2] ? figure(match[2]) : null;
                return { id: line.id, text: (match?.[1] ?? line.text).trim(), value: value ?? part.items[index]?.value ?? 0 };
              }),
            })
          }
        />
      );
    case "heatmap": {
      const on = new Set(part.on);
      return (
        <>
          <Choices
            legend={w.weeks}
            options={PREVIEW_WEEKS.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(part.weeks)}
            onChange={(n) => {
              const weeks = Number(n) as (typeof PREVIEW_WEEKS)[number];
              change({ weeks, on: part.on.filter((day) => day < weeks * 7) });
            }}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{w.days}</legend>
            <div className="grid max-w-64 grid-cols-7 gap-1">
              {Array.from({ length: part.weeks * 7 }, (_, day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on.has(day)}
                  aria-label={fillWords(w.day, { n: day + 1 })}
                  onClick={() => change({ on: on.has(day) ? part.on.filter((d) => d !== day) : [...part.on, day].sort((a, b) => a - b) })}
                  className={`aspect-square rounded border border-line ${on.has(day) ? "bg-brand" : "bg-card"}`}
                />
              ))}
            </div>
          </fieldset>
        </>
      );
    }
    case "kanban":
      return (
        <>
          <Choices
            legend={w.columns}
            options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))}
            value={String(part.columns.length)}
            onChange={(n) => {
              const count = Number(n);
              const columns = Array.from({ length: count }, (_, i) => part.columns[i] ?? { id: newItemId(), cards: [{ id: newItemId(), text: "" }] });
              change({ columns });
            }}
          />
          {part.columns.map((column, c) => (
            <TextField
              key={column.id}
              label={fillWords(w.column, { n: c + 1 })}
              multiline
              value={column.cards.map((card) => card.text).join("\n")}
              max={PREVIEW_TEXT_MAX * PREVIEW_LINES_MAX}
              onChange={(text) => change({ columns: part.columns.map((other) => (other.id === column.id ? { ...other, cards: linesOf(other.cards, text, (line) => line) } : other)) })}
            />
          ))}
        </>
      );
    case "rows":
      return (
        <>
          <IconChoice w={w} icon={part.icon} onChange={(icon) => change({ icon })} />
          <TextField label={w.title} value={part.title} max={PREVIEW_SHORT_MAX} onChange={(title) => change({ title })} />
          <TextField
            label={w.rows}
            multiline
            value={part.items.map((item) => item.text).join("\n")}
            max={PREVIEW_TEXT_MAX * PREVIEW_LINES_MAX}
            onChange={(text) => change({ items: linesOf(part.items, text, (line, index) => ({ ...line, tone: part.items[index]?.tone ?? "muted" })) })}
          />
          {part.items.map((item, index) => (
            <Choices
              key={item.id}
              legend={fillWords(w.rowTone, { n: index + 1 })}
              options={optionsOf(PREVIEW_TONES, w.tones)}
              value={item.tone}
              onChange={(tone) => change({ items: part.items.map((other) => (other.id === item.id ? { ...other, tone } : other)) })}
            />
          ))}
        </>
      );
  }
}

/**
 * An app preview's fields (D916): how it is framed and its bar, the sidebar's name and menu, and its parts, each of a kind with its own
 * fields; a part turned into another kind keeps its place and title. Lines are typed one on each line; figures as numbers from 0 to 100.
 */
export function AppPreviewFields({ block, onChange }: BlockEditorProps<AppPreviewBlock>) {
  const w = useAdminText("blocks").appPreview;
  return (
    <>
      <Choices legend={w.frame} options={optionsOf(PREVIEW_FRAMES, w.frames)} value={block.frame} onChange={(frame) => onChange({ frame })} />
      {block.frame === "window" && (
        <>
          <TextField label={w.bar} hint={w.barHint} value={block.bar} max={PREVIEW_SHORT_MAX} onChange={(bar) => onChange({ bar })} />
          <Check label={w.barTitle} checked={block.barTitle === true} onChange={(on) => onChange({ barTitle: on || undefined })} />
        </>
      )}
      <TextField label={w.sideTitle} value={block.sideTitle} max={PREVIEW_SHORT_MAX} onChange={(sideTitle) => onChange({ sideTitle })} />
      <TextField
        label={w.side}
        hint={w.sideHint}
        multiline
        value={block.side.map((item) => item.text).join("\n")}
        max={PREVIEW_SHORT_MAX * PREVIEW_LINES_MAX}
        onChange={(text) => onChange({ side: linesOf(block.side, text, (line) => line) })}
      />
      <ItemsEditor<PreviewPart>
        label={w.parts}
        items={block.parts}
        max={PREVIEW_PARTS_MAX}
        addLabel={w.add}
        nameOf={(part, index) => ("title" in part && part.title.trim()) || fillWords(w.unnamed, { kind: w.kinds[part.kind], n: index + 1 })}
        duplicate={(part) => ({ ...structuredClone(part), id: newItemId() })}
        newItem={() => asKind({ id: newItemId(), kind: "title", title: "", aside: "", boxed: true }, "checklist")}
        onChange={(parts) => onChange({ parts })}
      >
        {(part, change) => (
          <>
            <Choices
              legend={w.kind}
              options={optionsOf(PREVIEW_PART_KINDS, w.kinds)}
              value={part.kind}
              onChange={(kind) => onChange({ parts: block.parts.map((other) => (other.id === part.id ? asKind(part, kind) : other)) })}
            />
            <PartFields w={w} part={part} change={change as Change} />
            <Check label={w.half} checked={part.half === true} onChange={(on) => change({ half: on || undefined })} />
            <Check label={w.boxed} checked={part.boxed === true} onChange={(on) => change({ boxed: on || undefined })} />
          </>
        )}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.blankHint}</p>
      <TextField label={w.alt} hint={w.altHint} multiline value={block.alt} max={300} onChange={(alt) => onChange({ alt })} />
    </>
  );
}
