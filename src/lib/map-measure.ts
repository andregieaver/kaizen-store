import type { MapLayout } from "./heat-read";

/**
 * Where each anchor of a store page is (D656, `docs/heatmaps-and-recordings.md` 9.2): run inside the page by the heatmaps' photographer, so
 * it uses only DOM APIs and what it defines itself (Playwright sends its source). It emits the keys `anchorOf()` (`heat-anchor.ts`) gives a
 * click: every part wrapper (`kz-{id}` as its first class), every product card (inside a part, `{part}/c{n}`; in none, `@card:{list}:{n}`),
 * and the landmarks `@header`, `@footer`, `@main` and `@body`; each box in page pixels, `[x, y, w, h]`. Boxes of no size are skipped, the
 * first box of a key is kept, and at most 3,000.
 */
export function measureAnchors(): MapLayout {
  const MAX = 3000;
  const PART = /^kz-((?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:header|footer|product)(?:-[a-z]+)+))$/;
  const anchors: Record<string, [number, number, number, number]> = {};
  let count = 0;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const add = (key: string, element: Element) => {
    if (count >= MAX || key in anchors) return;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    anchors[key] = [Math.round(box.left + sx), Math.round(box.top + sy), Math.round(box.width), Math.round(box.height)];
    count++;
  };
  const partOf = (element: Element): string | null => {
    const match = PART.exec(element.classList[0] ?? "");
    return match ? match[1] : null;
  };
  const partAround = (element: Element): Element | null => {
    for (let up = element.parentElement; up && up !== document.documentElement; up = up.parentElement) if (partOf(up)) return up;
    return null;
  };

  for (const element of Array.from(document.querySelectorAll("[class^='kz-']"))) {
    const id = partOf(element);
    if (id) add(id, element);
  }
  const cards = Array.from(document.querySelectorAll("li.product-card"));
  const lists = Array.from(new Set(cards.map((card) => card.parentElement)));
  for (const card of cards) {
    const part = partAround(card);
    if (part) {
      const n = Array.from(part.querySelectorAll("li.product-card")).indexOf(card);
      if (n >= 0 && n < 100) add(`${partOf(part)}/c${n}`, card);
      continue;
    }
    const list = card.parentElement;
    const listIndex = lists.indexOf(list);
    const n = list ? Array.from(list.children).filter((c) => c.matches("li.product-card")).indexOf(card) : -1;
    if (listIndex >= 0 && listIndex < 10 && n >= 0 && n < 100) add(`@card:${listIndex}:${n}`, card);
  }
  for (const tag of ["header", "footer", "main"]) {
    const element = document.querySelector(tag);
    if (element) add(`@${tag}`, element);
  }
  const root = document.documentElement;
  const w = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0, window.innerWidth);
  const h = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
  if (document.body && count < MAX) anchors["@body"] = [0, 0, w, h];
  return { v: 1, w, h, fold: window.innerHeight, anchors };
}
