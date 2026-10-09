import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A row of several lines of columns (D187), arranged in the database as the page builder saves it: `layout` is the first
 * line's, `moreLines` the layouts of the lines under it, `columns` one list line after line. On the site each line is a box
 * of its own under the one before, its columns side by side, and a phone stacks every column in order.
 */

const column = (id: string, words: string, extra: Record<string, unknown> = {}) => ({
  id,
  blocks: [{ id: `${id}-b`, type: "heading", text: words, level: 2 }],
  ...extra,
});

/** A new store with one published page of the given rows; returns the page's address. */
async function pageWithRows(rows: unknown[]): Promise<string> {
  const slug = `linjer-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Linjebutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Linjebutikk', null) as id`;
    const content = {
      title: "Linjer",
      slug: "linjer",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows,
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'linjer', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/linjer`;
}

test("a row of several lines puts each line under the one before, and a phone stacks every column in order", async ({
  page,
}) => {
  const url = await pageWithRows([
    // Two columns on the first line, one alone on the second.
    {
      id: "r1",
      type: "row",
      layout: "2",
      moreLines: ["1"],
      columns: [column("a", "Alpha"), column("b", "Bravo"), column("c", "Charlie")],
    },
    // Three on the first, a quarter and three quarters on the second, one on the third.
    {
      id: "r2",
      type: "row",
      layout: "3",
      moreLines: ["2", "1"],
      columns: [
        column("d", "Delta"),
        column("e", "Echo"),
        column("f", "Foxtrot"),
        column("g", "Golf", { width: 25 }),
        column("h", "Hotel", { width: 75 }),
        column("i", "India"),
      ],
    },
    // A row of one line, as every row was before.
    { id: "r3", type: "row", layout: "2", columns: [column("j", "Juliet"), column("k", "Kilo")] },
  ]);
  const box = async (id: string) => {
    const found = await page.locator(`.kz-${id}`).boundingBox();
    expect(found, `column ${id} is drawn`).not.toBeNull();
    return found!;
  };
  const near = (actual: number, expected: number, message: string, tolerance = 2) =>
    expect(Math.abs(actual - expected), `${message} (${actual} against ${expected})`).toBeLessThanOrEqual(tolerance);

  // A computer: the first line's columns are side by side, the second line's column under them and as wide as the row.
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const [a, b, c] = [await box("a"), await box("b"), await box("c")];
  near(a.y, b.y, "Alpha and Bravo are side by side");
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  near(a.width, b.width, "and share the line evenly");
  expect(c.y, "Charlie is on the line under them").toBeGreaterThan(a.y + a.height - 1);
  near(c.x, a.x, "at the row's left");
  near(c.width, a.width + b.width + (b.x - (a.x + a.width)), "as wide as the two and the gap between them");

  // Each line has its own layout and shares.
  const [d, e, f] = [await box("d"), await box("e"), await box("f")];
  near(d.y, e.y, "Delta, Echo and Foxtrot are on one line");
  near(e.y, f.y, "Echo and Foxtrot are on one line");
  near(d.width, e.width, "of three equal columns");
  near(e.width, f.width, "of three equal columns");
  const [g, h, i] = [await box("g"), await box("h"), await box("i")];
  expect(g.y, "the second line is under the first").toBeGreaterThan(d.y + d.height - 1);
  near(g.y, h.y, "Golf and Hotel are side by side");
  near(h.width / g.width, 3, "Hotel has three times Golf's share", 0.1);
  expect(i.y, "the third line is under the second").toBeGreaterThan(g.y + g.height - 1);
  near(i.width, d.width * 3 + (e.x - (d.x + d.width)) * 2, "and India has the whole width");

  // A row of one line is as before: its columns side by side.
  const [j, k] = [await box("j"), await box("k")];
  near(j.y, k.y, "Juliet and Kilo are side by side");
  expect(k.x).toBeGreaterThan(j.x + j.width - 1);

  // A phone: every column under the one before, in the order of the lines.
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(url);
  const order = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
  const boxes = await Promise.all(order.map((id) => box(id)));
  for (const [index, found] of boxes.entries()) {
    near(found.x, boxes[0].x, `${order[index]} is at the left edge of the one column`);
    if (index > 0) {
      expect(found.y, `${order[index]} is under ${order[index - 1]}`).toBeGreaterThan(
        boxes[index - 1].y + boxes[index - 1].height - 1,
      );
    }
  }
});
