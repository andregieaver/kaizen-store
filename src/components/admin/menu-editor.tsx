"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
  type KeyboardEventHandler,
  type PointerEventHandler,
} from "react";

import { dropDepth, menuMoves, moveItem, subtreeEnd, type MenuMoves } from "@/lib/menu-structure";
import { LABEL_MAX, MEGA_MAX_COLUMNS, MENU_MAX_ITEMS, MENU_NAME_MAX, type AnyLinkKind, type AnyMenuEntry, type AnyMenuLink } from "@/lib/navigation";

import { ImageUploadButton, type Upload } from "./image-upload";
import {
  TARGET_NOUNS,
  targetLink,
  targetOf,
  type KindOption,
  type MenuLanguage,
  type Target,
  type TargetKind,
  type Targets,
} from "./menu-links";

/** An item while edited: a key, so React keeps each item's fields as items move. */
type Item = AnyMenuEntry & { key: string };

type SaveMenu = (id: string | null, input: unknown) => Promise<{ ok: true; id: string } | { ok: false; problems: string[] }>;

/** Where the menu shows, as links to change those places. */
export type MenuUse = { label: string; href: string };

/** What the page says that differs between a store and Kaizen. */
export type MenuEditorCopy = {
  /** The section of links the site names itself (the front page, the cart, …). */
  siteLinks: string;
  /** The Add menu items sections, by target. */
  sections: Partial<Record<TargetKind, string>>;
  urlHint: string;
  urlPlaceholder: string;
};

/** How far one level sits in from the one above it, in pixels, and how far to drag for one. */
const INDENT = 32;

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const small = "min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-40";

let counter = 0;
const keyed = (item: AnyMenuEntry): Item => ({ ...item, key: `item-${++counter}` });

/**
 * The menu editor (D85), after WordPress's: choose a menu or create one;
 * add links from the site's pages, products, categories, tags, articles,
 * its own links or a custom address on the left; order them on the right
 * by dragging, a link sitting under the one before it when dragged to the
 * right (or with the Move buttons, from the keyboard too); open a link to
 * change its texts, have it open in a new tab, move or remove it. Menus
 * are shown wherever they are chosen, so the editor says nothing about
 * places; it lists where the menu is used.
 */
export function MenuEditor({
  menus,
  menu,
  uses,
  basePath,
  languages,
  kinds,
  targets,
  copy,
  save,
  remove,
  upload,
}: {
  menus: { id: string; name: string }[];
  /** The menu edited; a new one has no id. */
  menu: { id: string | null; name: string; items: AnyMenuEntry[] };
  uses: MenuUse[];
  /** The Menus page: `?menu=` chooses the menu. */
  basePath: string;
  languages: MenuLanguage[];
  kinds: KindOption[];
  targets: Targets;
  copy: MenuEditorCopy;
  save: SaveMenu;
  remove: (id: string) => Promise<{ ok: boolean }>;
  /** Uploads a link's picture (D87); null where uploads are not set up. */
  upload: Upload | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(menu.name);
  const [items, setItems] = useState<Item[]>(() => menu.items.map(keyed));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; problems: string[] } | null>(null);
  const [saving, startSaving] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const main = languages[0];

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: Item[]) => {
    setItems(next);
    setDirty(true);
    setResult(null);
  };

  /** What an item is called in the list: its own text in the main language, else what it links to. */
  const nameOf = (item: AnyMenuEntry): string => {
    const own = item.label[main.locale]?.trim();
    if (own) return own;
    const target = targetOf(item.link);
    if (target) return (targets[target.kind] ?? []).find((t) => t.value === target.value)?.title.trim() ?? `${TARGET_NOUNS[target.kind]} not found`;
    if (item.link.kind === "url") return item.link.url || "Custom link";
    return main.defaults[item.link.kind] ?? kinds.find((k) => k.kind === item.link.kind)?.label ?? item.link.kind;
  };

  const add = (links: AnyMenuLink[], label: Record<string, string> = {}) => {
    const room = MENU_MAX_ITEMS - items.length;
    change([...items, ...links.slice(0, room).map((link) => keyed({ label, link, depth: 0 }))]);
    setAnnouncement(links.length === 1 ? "Added 1 link to the menu." : `Added ${Math.min(links.length, room)} links to the menu.`);
  };

  const submit = () =>
    startSaving(async () => {
      const outcome = await save(menu.id, {
        name,
        items: items.map((item) => ({
          label: item.label,
          link: item.link,
          depth: item.depth,
          ...(item.newTab && { newTab: true }),
          // Only a top link is a mega menu (D87); one moved under another is no longer.
          ...(item.depth === 0 && item.mega && { mega: item.mega }),
          ...(item.image && { image: item.image }),
        })),
      });
      if (!outcome.ok) {
        setResult(outcome);
        return;
      }
      setResult({ ok: true });
      setDirty(false);
      if (!menu.id) router.replace(`${basePath}?menu=${outcome.id}`);
      router.refresh();
    });

  const choose = (id: string) => {
    if (dirty && !window.confirm("Leave this menu without saving the changes?")) return;
    router.push(id ? `${basePath}?menu=${id}` : `${basePath}?menu=new`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-4 text-sm">
        {menus.length > 0 && (
          <>
            <label className="flex flex-wrap items-center gap-2">
              Select a menu to edit:
              <select value={menu.id ?? ""} onChange={(event) => choose(event.target.value)} className={`${input} w-auto min-w-48`}>
                {!menu.id && <option value="">New menu</option>}
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <span>or</span>
          </>
        )}
        <Link
          href={`${basePath}?menu=new`}
          onClick={(event) => {
            if (dirty && !window.confirm("Leave this menu without saving the changes?")) event.preventDefault();
          }}
          className="underline"
        >
          create a new menu
        </Link>
        .
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <AddItems kinds={kinds} targets={targets} copy={copy} locale={main.locale} full={items.length >= MENU_MAX_ITEMS} onAdd={add} />

        <section aria-labelledby="menu-structure-heading" className="flex min-w-0 flex-col rounded-lg border border-border bg-background">
          <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
            <h2 id="menu-structure-heading" className="sr-only">
              Menu structure
            </h2>
            <label className={`${field} min-w-0 flex-1`}>
              Menu name
              <input
                value={name}
                maxLength={MENU_NAME_MAX}
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                  setResult(null);
                }}
                className={input}
                required
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? "Saving …" : menu.id ? "Save menu" : "Create menu"}
            </button>
          </div>

          <div className="flex flex-col gap-4 p-4">
            <p className="text-sm text-muted">
              {items.length === 0
                ? "Add links from the column on the left."
                : "Drag the links into the order you want; drag one to the right to put it under the link above it. Open a link with its arrow to change its text or move it."}
            </p>
            <Structure
              items={items}
              expanded={expanded}
              onToggle={(key) =>
                setExpanded((open) => {
                  const next = new Set(open);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
              onChange={change}
              onAnnounce={setAnnouncement}
              nameOf={nameOf}
              languages={languages}
              kinds={kinds}
              targets={targets}
              copy={copy}
              upload={upload}
            />
            <p role="status" aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? "Saving …" : menu.id ? "Save menu" : "Create menu"}
            </button>
            <p role="status" aria-live="polite" className="text-sm">
              {result?.ok ? "Saved. The site shows it now." : dirty ? "Unsaved changes." : ""}
            </p>
            {menu.id &&
              (confirming ? (
                <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
                  Delete {menu.name}?{uses.length > 0 && " It is used where listed below; those places will show no menu."}
                  <button
                    type="button"
                    onClick={() =>
                      startSaving(async () => {
                        if (menu.id && (await remove(menu.id)).ok) {
                          setDirty(false);
                          router.replace(basePath);
                          router.refresh();
                        }
                      })
                    }
                    className="min-h-9 rounded-md bg-red-700 px-3 font-medium text-white"
                  >
                    Delete menu
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="min-h-9 px-2 underline">
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="ml-auto text-sm text-red-700 underline">
                  Delete menu
                </button>
              ))}
          </div>
          {result && !result.ok && (
            <div role="alert" className="mx-4 mb-4 rounded-lg border border-red-700 p-4 text-sm">
              <p className="font-medium">Nothing was saved yet. Please fix:</p>
              <ul className="mt-2 list-disc pl-5">
                {result.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          {menu.id && (
            <div className="border-t border-border p-4 text-sm">
              <h3 className="font-medium">Where it shows</h3>
              {uses.length === 0 ? (
                <p className="text-muted">
                  Nowhere yet. Choose it for the standard header or footer under Header and footer, or place it with a Menu
                  component in a page, header or footer.
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {uses.map((use) => (
                    <li key={use.href + use.label}>
                      <Link href={use.href} className="underline">
                        {use.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding items
// ---------------------------------------------------------------------------

/** The column of things to add: a section per kind of target, the site's own links, and a custom link. */
function AddItems({
  kinds,
  targets,
  copy,
  locale,
  full,
  onAdd,
}: {
  kinds: KindOption[];
  targets: Targets;
  copy: MenuEditorCopy;
  /** The main language, which a custom link's text is in. */
  locale: string;
  full: boolean;
  onAdd: (links: AnyMenuLink[], label?: Record<string, string>) => void;
}) {
  const targetKinds = kinds.filter((k): k is KindOption & { kind: TargetKind } => k.kind in TARGET_NOUNS);
  const own = kinds.filter((k) => !(k.kind in TARGET_NOUNS) && k.kind !== "url");
  return (
    <aside aria-labelledby="add-items-heading" className="flex flex-col rounded-lg border border-border bg-background">
      <h2 id="add-items-heading" className="border-b border-border p-4 font-medium">
        Add menu items
      </h2>
      {full && <p className="p-4 text-sm text-muted">The menu has as many links as it can take ({MENU_MAX_ITEMS}).</p>}
      {targetKinds.map((k, index) => (
        <AddSection
          key={k.kind}
          title={copy.sections[k.kind] ?? k.label}
          open={index === 0}
          options={(targets[k.kind] ?? []).map((t: Target) => ({ value: t.value, title: t.title, note: t.note }))}
          empty={`No ${(copy.sections[k.kind] ?? k.label).toLowerCase()} yet.`}
          disabled={full}
          onAdd={(values) => onAdd(values.map((value) => targetLink(k.kind, value, kinds)))}
        />
      ))}
      <AddSection
        title={copy.siteLinks}
        options={own.map((k) => ({ value: k.kind, title: k.label }))}
        empty=""
        disabled={full}
        onAdd={(values) => onAdd(values.map((kind) => ({ kind }) as AnyMenuLink))}
      />
      <CustomLink copy={copy} disabled={full} onAdd={(url, text) => onAdd([{ kind: "url", url }], { [locale]: text })} />
    </aside>
  );
}

/** One section: tick what to add, then Add to menu. A long list can be searched. */
function AddSection({
  title,
  options,
  empty,
  open = false,
  disabled,
  onAdd,
}: {
  title: string;
  options: { value: string; title: string; note?: string }[];
  empty: string;
  open?: boolean;
  disabled: boolean;
  onAdd: (values: string[]) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const shown = useMemo(
    () => (search.trim() ? options.filter((o) => o.title.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search],
  );
  const all = shown.length > 0 && shown.every((o) => chosen.has(o.value));
  return (
    <details open={open} className="group border-b border-border last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-medium">
        {title}
        <span aria-hidden className="transition-transform group-open:rotate-180 motion-reduce:transition-none">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {options.length === 0 ? (
          <p className="text-sm text-muted">{empty}</p>
        ) : (
          <>
            {options.length > 8 && (
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                aria-label={`Search ${title.toLowerCase()}`}
                className={input}
              />
            )}
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2" aria-label={title}>
              {shown.map((option) => (
                <li key={option.value}>
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.has(option.value)}
                      onChange={(event) =>
                        setChosen((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(option.value);
                          else next.delete(option.value);
                          return next;
                        })
                      }
                    />
                    <span>
                      {option.title}
                      {option.note && <span className="text-muted"> ({option.note})</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(event) => setChosen(event.target.checked ? new Set(shown.map((o) => o.value)) : new Set())}
                  aria-describedby={`${id}-all`}
                />
                <span id={`${id}-all`}>Select all</span>
              </label>
              <button
                type="button"
                disabled={disabled || chosen.size === 0}
                onClick={() => {
                  // In the list's order, not the order they were ticked.
                  onAdd(options.filter((o) => chosen.has(o.value)).map((o) => o.value));
                  setChosen(new Set());
                }}
                className={small}
              >
                Add to menu
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

/** A link to any address, with its text. */
function CustomLink({
  copy,
  disabled,
  onAdd,
}: {
  copy: MenuEditorCopy;
  disabled: boolean;
  onAdd: (url: string, text: string) => void;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-medium">
        Custom link
        <span aria-hidden className="transition-transform group-open:rotate-180 motion-reduce:transition-none">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <label className={field}>
          Web address
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={copy.urlPlaceholder}
            inputMode="url"
            aria-describedby={`${id}-hint`}
            className={input}
          />
          <span id={`${id}-hint`} className="text-xs font-normal text-muted">
            {copy.urlHint}
          </span>
        </label>
        <label className={field}>
          Link text
          <input value={text} maxLength={LABEL_MAX} onChange={(event) => setText(event.target.value)} className={input} />
        </label>
        <button
          type="button"
          disabled={disabled || !url.trim() || !text.trim()}
          onClick={() => {
            onAdd(url.trim(), text.trim());
            setUrl("");
            setText("");
          }}
          className={`${small} w-fit self-end`}
        >
          Add to menu
        </button>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// The menu's structure
// ---------------------------------------------------------------------------

type Drag = { key: string; offset: number; over: string | null };

function Structure({
  items,
  expanded,
  onToggle,
  onChange,
  onAnnounce,
  nameOf,
  languages,
  kinds,
  targets,
  copy,
  upload,
}: {
  items: Item[];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onChange: (items: Item[]) => void;
  onAnnounce: (text: string) => void;
  nameOf: (item: AnyMenuEntry) => string;
  languages: MenuLanguage[];
  kinds: KindOption[];
  targets: Targets;
  copy: MenuEditorCopy;
  upload: Upload | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const from = drag ? items.findIndex((item) => item.key === drag.key) : -1;
  // While an item is dragged, the items under it go with it, out of the list.
  const carried = from >= 0 ? subtreeEnd(items, from) - from - 1 : 0;
  const visible = from >= 0 ? [...items.slice(0, from + 1), ...items.slice(from + 1 + carried)] : items;
  const drop = (() => {
    if (!drag || from < 0) return null;
    const to = drag.over ? visible.findIndex((item) => item.key === drag.over) : from;
    if (to < 0) return null;
    return { to, depth: dropDepth(items, from, to, items[from].depth + Math.round(drag.offset / INDENT)) };
  })();

  if (items.length === 0) return null;

  const onDragStart = (event: DragStartEvent) => setDrag({ key: String(event.active.id), offset: 0, over: String(event.active.id) });
  const onDragMove = (event: DragMoveEvent) => setDrag((d) => d && { ...d, offset: event.delta.x });
  const onDragOver = (event: DragOverEvent) => setDrag((d) => d && { ...d, over: event.over ? String(event.over.id) : null });
  const onDragEnd = (event: DragEndEvent) => {
    if (drop && event.over) {
      const next = moveItem(items, from, drop.to, drop.depth);
      onChange(next);
      onAnnounce(`${nameOf(items[from])} moved to place ${drop.to + 1}${drop.depth > 0 ? `, ${drop.depth === 1 ? "one level" : "two levels"} in` : ""}.`);
    }
    setDrag(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <SortableContext items={visible.map((item) => item.key)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-2" aria-label="Menu structure">
          {visible.map((item) => {
            const index = items.indexOf(item);
            const dragged = item.key === drag?.key;
            return (
              <MenuItemRow
                key={item.key}
                item={item}
                depth={dragged && drop ? drop.depth : item.depth}
                carried={dragged ? carried : 0}
                name={nameOf(item)}
                parentName={(() => {
                  for (let i = index - 1; i >= 0; i--) if (items[i].depth < item.depth) return nameOf(items[i]);
                  return null;
                })()}
                previousName={(() => {
                  for (let i = index - 1; i >= 0; i--) {
                    if (items[i].depth === item.depth) return nameOf(items[i]);
                    if (items[i].depth < item.depth) return null;
                  }
                  return null;
                })()}
                moves={menuMoves(items, index)}
                expanded={expanded.has(item.key)}
                onToggle={() => onToggle(item.key)}
                onChange={(next) => onChange(items.map((it) => (it.key === item.key ? next : it)))}
                onMove={(next, what) => {
                  onChange(next);
                  onAnnounce(`${nameOf(item)} moved ${what}.`);
                }}
                onRemove={() => {
                  // Its own items move up a level, into its place.
                  const end = subtreeEnd(items, index);
                  onChange([
                    ...items.slice(0, index),
                    ...items.slice(index + 1, end).map((child) => ({ ...child, depth: child.depth - 1 })),
                    ...items.slice(end),
                  ]);
                  onAnnounce(`${nameOf(item)} removed.`);
                }}
                languages={languages}
                kinds={kinds}
                targets={targets}
                copy={copy}
                upload={upload}
                // A link right under a mega menu's top link is one of its columns, with a picture (D87).
                inMega={(() => {
                  if (item.depth !== 1) return false;
                  for (let i = index - 1; i >= 0; i--) if (items[i].depth === 0) return Boolean(items[i].mega);
                  return false;
                })()}
              />
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/** What a link is, as the list says it: Page, Product, Custom link, … */
function kindName(link: AnyMenuLink, kinds: KindOption[]): string {
  const target = targetOf(link);
  if (target) return TARGET_NOUNS[target.kind];
  return kinds.find((k) => k.kind === link.kind)?.label ?? link.kind;
}

function MenuItemRow({
  item,
  depth,
  carried,
  name,
  parentName,
  previousName,
  moves,
  expanded,
  onToggle,
  onChange,
  onMove,
  onRemove,
  languages,
  kinds,
  targets,
  copy,
  upload,
  inMega,
}: {
  item: Item;
  depth: number;
  carried: number;
  name: string;
  parentName: string | null;
  previousName: string | null;
  moves: MenuMoves<Item>;
  expanded: boolean;
  onToggle: () => void;
  onChange: (item: Item) => void;
  onMove: (items: Item[], what: string) => void;
  onRemove: () => void;
  languages: MenuLanguage[];
  kinds: KindOption[];
  targets: Targets;
  copy: MenuEditorCopy;
  upload: Upload | null;
  inMega: boolean;
}) {
  const id = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const target = targetOf(item.link);
  const original = target ? (targets[target.kind] ?? []).find((t) => t.value === target.value) : null;
  const mega = item.mega;
  const move = (next: Item[] | null, label: string, what: string) =>
    next && (
      <button type="button" className={small} onClick={() => onMove(next, what)}>
        {label}
      </button>
    );
  const placeholder = (locale: string): string =>
    original?.title ?? (item.link.kind === "url" ? "Required" : (languages.find((l) => l.locale === locale)?.defaults[item.link.kind as AnyLinkKind] ?? ""));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, marginLeft: depth * INDENT }}
      className={`max-w-2xl ${isDragging ? "relative z-10 opacity-90" : ""}`}
      data-menu-item={name}
      data-depth={depth}
    >
      <div
        // The whole bar drags with the pointer, as in WordPress; from the keyboard, its handle does.
        onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined}
        className={`flex min-h-12 cursor-grab touch-none items-center gap-2 select-none rounded-md border border-border bg-surface px-2 active:cursor-grabbing ${isDragging ? "shadow-lg" : ""}`}
      >
        <button
          type="button"
          {...attributes}
          onKeyDown={listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
          aria-label={`Move ${name}`}
          aria-roledescription="sortable link"
          className="flex size-9 shrink-0 cursor-grab items-center justify-center rounded text-muted hover:bg-background"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {carried > 0 && <span className="text-xs text-muted">+{carried} under it</span>}
        {depth > 0 && <span className="hidden text-xs text-muted sm:inline">sub item</span>}
        {item.mega && depth === 0 && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">Mega menu</span>}
        <span className="shrink-0 text-xs text-muted">{kindName(item.link, kinds)}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`${id}-panel`}
          aria-label={`Edit ${name}`}
          className="flex size-9 shrink-0 items-center justify-center rounded hover:bg-background"
        >
          <span aria-hidden className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </div>
      {expanded && (
        <div id={`${id}-panel`} className="flex flex-col gap-4 rounded-b-md border border-t-0 border-border bg-background p-4">
          {item.link.kind === "url" && (
            <label className={field}>
              Web address
              <input
                value={item.link.url}
                onChange={(event) => onChange({ ...item, link: { kind: "url", url: event.target.value } })}
                placeholder={copy.urlPlaceholder}
                inputMode="url"
                className={input}
              />
            </label>
          )}
          <div className={`grid gap-3 ${languages.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {languages.map((language) => (
              <label key={language.locale} className={field}>
                {languages.length > 1 ? `Navigation label in ${language.name}` : "Navigation label"}
                <input
                  value={item.label[language.locale] ?? ""}
                  maxLength={LABEL_MAX}
                  onChange={(event) => onChange({ ...item, label: { ...item.label, [language.locale]: event.target.value } })}
                  placeholder={placeholder(language.locale)}
                  lang={language.locale}
                  className={input}
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(item.newTab)}
              onChange={(event) => onChange({ ...item, newTab: event.target.checked || undefined })}
            />
            Open the link in a new tab
          </label>
          {item.depth === 0 && (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(item.mega)}
                  onChange={(event) => onChange({ ...item, mega: event.target.checked ? { columns: 4 } : undefined })}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Mega menu</span>
                  <span className="block text-xs text-muted">
                    The links under this one open side by side across the page&apos;s width, in columns, each with its picture
                    and the links under it. On phones they are listed as usual.
                  </span>
                </span>
              </label>
              {mega && (
                <div className="flex flex-wrap items-end gap-4 pl-6">
                  <label className={field}>
                    Columns
                    <select
                      value={mega.columns}
                      onChange={(event) => onChange({ ...item, mega: { ...mega, columns: Number(event.target.value) } })}
                      className={`${input} w-24`}
                    >
                      {Array.from({ length: MEGA_MAX_COLUMNS }, (_, n) => n + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(mega.center)}
                      onChange={(event) => onChange({ ...item, mega: { columns: mega.columns, ...(event.target.checked && { center: true }) } })}
                    />
                    Centre the links under it
                  </label>
                </div>
              )}
            </div>
          )}
          {inMega && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Picture</span>
              <span className="text-xs text-muted">Shown above the link in its column of the mega menu. A landscape picture (4:3) works best.</span>
              <div className="flex flex-wrap items-center gap-3">
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
                  <img src={item.image.url} alt="" className="aspect-[4/3] w-32 rounded-md bg-surface object-cover" />
                )}
                <ImageUploadButton
                  upload={upload}
                  label={item.image ? "Replace picture" : "Upload picture"}
                  onUploaded={(image) => onChange({ ...item, image })}
                />
                {item.image && (
                  <button type="button" onClick={() => onChange({ ...item, image: undefined })} className="text-sm underline">
                    Remove picture
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Move</span>
            {move(moves.up, "Up one", "up one")}
            {move(moves.down, "Down one", "down one")}
            {previousName && move(moves.under, `Under ${previousName}`, `under ${previousName}`)}
            {parentName && move(moves.out, `Out from under ${parentName}`, `out from under ${parentName}`)}
            {move(moves.top, "To the top", "to the top")}
          </div>
          {target && (
            <p className="text-sm text-muted">
              Original: {original ? original.title : `${TARGET_NOUNS[target.kind]} not found`}
              {original?.note && ` (${original.note})`}
            </p>
          )}
          <div className="flex items-center gap-3 border-t border-border pt-3 text-sm">
            <button type="button" onClick={onRemove} className="text-red-700 underline">
              Remove
            </button>
            <span aria-hidden className="text-muted">
              |
            </span>
            <button type="button" onClick={onToggle} className="underline">
              Close
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
