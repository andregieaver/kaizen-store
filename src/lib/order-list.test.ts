import { describe, expect, it } from "vitest";

import {
  BUILT_IN_VIEWS,
  DEFAULT_COLUMNS,
  DEFAULT_ORDER_LIST,
  ORDER_COLUMNS,
  ORDER_LIST_KEYS,
  addDays,
  columnsOf,
  countText,
  cursorFor,
  dateWindow,
  decodeCursor,
  describeFilters,
  encodeCursor,
  excludesCopied,
  expandShow,
  hasFilters,
  isDateString,
  isUnfinishedView,
  nextDay,
  normaliseViewTitle,
  orderListHref,
  orderListQuery,
  parseOrderListParams,
  rangeDays,
  readOrderListParams,
  readViewRecord,
  resolveOrderListParams,
  viewRecordOf,
} from "./order-list";

const parse = (query: string) => parseOrderListParams(new URLSearchParams(query));
const ID = "0b8c2d44-5f3e-4a62-9d11-2f6a8c1e7b90";

describe("reading the address", () => {
  it("is the defaults for an empty address", () => {
    expect(parse("")).toEqual(DEFAULT_ORDER_LIST);
    expect(parseOrderListParams({})).toEqual(DEFAULT_ORDER_LIST);
  });

  it("reads every parameter of the table", () => {
    const p = parse(`q=anna+hansen&show=archived&view=${ID}&pay=paid,refunded&ship=to_send&status=paid,fulfilled&tag=VIP,Late&from=2026-09-01&to=2026-09-30&market=no&source=draft&gift=1&archived=all&sort=total_asc&cols=total,placed`);
    expect(p).toEqual({
      q: "anna hansen",
      show: "archived",
      view: ID,
      pay: ["paid", "refunded"],
      ship: ["to_send"],
      status: ["paid", "fulfilled"],
      tag: ["vip", "late"],
      from: "2026-09-01",
      to: "2026-09-30",
      range: null,
      market: "NO",
      source: "draft",
      gift: true,
      archived: "all",
      sort: "total_asc",
      after: null,
      cols: ["placed", "total"],
    });
  });

  it("drops every unknown key and ignores every invalid value: never an error", () => {
    const p = parse(`foo=bar&pay=nonsense&ship=&status=open&tag=a%2Cb&from=2026-13-40&to=yesterday&range=forever&market=norway&source=elsewhere&gift=maybe&archived=maybe&sort=random&view=not-an-id&show=everything&cols=nope&after=%25%25`);
    // "a,b" is two tags, both valid; everything else falls back to its default.
    expect(p).toEqual({ ...DEFAULT_ORDER_LIST, tag: ["a", "b"] });
    expect(() => parse("pay=%00&q=%00%00&tag=%00")).not.toThrow();
  });

  it("takes several values by commas or by repeating the key, once each, in the vocabulary's order", () => {
    expect(parse("pay=refunded&pay=paid,paid").pay).toEqual(["paid", "refunded"]);
    expect(parse("tag=vip&tag=VIP&tag=late").tag).toEqual(["vip", "late"]);
  });

  it("reads Next's own searchParams object, with arrays and missing values", () => {
    expect(parseOrderListParams({ pay: ["paid", "refunded"], q: "anna", sort: undefined, show: null })).toMatchObject({ pay: ["paid", "refunded"], q: "anna", sort: "placed_desc", show: null });
  });

  it("keeps the old ?show= addresses working", () => {
    for (const show of ["to-send", "waiting", "unpaid"] as const) expect(parse(`show=${show}`).show).toBe(show);
    expect(expandShow(parse("show=to-send")).ship).toEqual(["to_send"]);
    expect(expandShow(parse("show=waiting")).ship).toEqual(["waiting"]);
    expect(expandShow(parse("show=unpaid")).pay).toEqual(["unpaid"]);
    expect(expandShow(parse("show=archived")).archived).toBe("yes");
    expect(expandShow(parse("")).ship).toEqual([]);
  });

  it("adds a built-in view to what is chosen and never removes a filter", () => {
    expect(expandShow(parse("show=to-send&ship=sent")).ship).toEqual(["sent", "to_send"]);
    expect(expandShow(parse("show=to-send&ship=to_send")).ship).toEqual(["to_send"]);
  });

  it("cuts the search to 100 characters and keeps the box's normalised text", () => {
    expect(parse(`q=${"a".repeat(300)}`).q).toHaveLength(100);
    expect(parse("q=%20%20anna%20%20%20hansen%20").q).toBe("anna hansen");
  });

  it("swaps dates given the wrong way round and lets an explicit date win over a relative range", () => {
    expect(parse("from=2026-09-30&to=2026-09-01")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(parse("range=30d&from=2026-09-01").range).toBeNull();
    expect(parse("range=30d").range).toBe("30d");
  });

  it("says which keys were present with no valid value (so a saved view can tell something no longer applies)", () => {
    expect(readOrderListParams(new URLSearchParams("pay=zzz&sort=placed_asc&market=norway")).ignored).toEqual(["market", "pay"].sort((a, b) => ORDER_LIST_KEYS.indexOf(a as never) - ORDER_LIST_KEYS.indexOf(b as never)));
    expect(readOrderListParams(new URLSearchParams("foo=1")).ignored).toEqual([]);
  });

  it("puts an invalid cursor aside: only a cursor-shaped value is kept, and decoding says whether it is real", () => {
    expect(parse("after=abc_DEF-123").after).toBe("abc_DEF-123");
    expect(parse("after=has space").after).toBeNull();
    expect(parse(`after=${"x".repeat(600)}`).after).toBeNull();
  });
});

describe("writing the address", () => {
  const roundTrip = (query: string) => orderListQuery(parse(query));

  it("writes only what differs from the defaults, in a fixed order", () => {
    expect(orderListQuery(DEFAULT_ORDER_LIST)).toBe("");
    expect(roundTrip("sort=placed_desc&archived=no")).toBe("");
    expect(roundTrip("tag=vip&q=anna&pay=paid")).toBe("q=anna&pay=paid&tag=vip");
  });

  it("is stable: writing what was read, reading it back and writing it again is the same address, for every kind of input", () => {
    const inputs = [
      "",
      "q=anna+hansen",
      "show=waiting",
      `view=${ID}&pay=refunded,paid&ship=sent,to_send&tag=Late,VIP`,
      "from=2026-09-30&to=2026-09-01&market=se&source=copied&gift=true",
      "range=this_month&archived=yes&sort=placed_asc",
      "cols=total,placed,tags",
      `cols=${DEFAULT_COLUMNS.join(",")}`,
      "pay=zzz&status=nope&foo=bar",
      "tag=%C3%86%C3%98%C3%85&q=%C3%A5se",
    ];
    for (const input of inputs) {
      const once = roundTrip(input);
      expect(roundTrip(once), input).toBe(once);
      expect(parse(once), input).toEqual(parse(input));
    }
  });

  it("does not write the default columns, and writes a chosen set in the fixed order", () => {
    expect(roundTrip(`cols=${DEFAULT_COLUMNS.join(",")}`)).toBe("");
    expect(roundTrip("cols=total,placed")).toBe("cols=placed%2Ctotal");
    expect(columnsOf(parse(""))).toEqual(DEFAULT_COLUMNS);
    expect(columnsOf(parse("cols=source,placed"))).toEqual(["placed", "source"]);
    expect(ORDER_COLUMNS).toHaveLength(9);
  });

  it("builds a link that keeps the state, changes some of it and starts from the first page", () => {
    const p = parse("pay=paid&after=abc");
    expect(orderListHref("/admin/s/orders", p, { sort: "total_desc" })).toBe("/admin/s/orders?pay=paid&sort=total_desc");
    expect(orderListHref("/admin/s/orders", DEFAULT_ORDER_LIST)).toBe("/admin/s/orders");
  });

  it("encodes the characters of a search so the address reads back the same", () => {
    const p = parse("q=a%26b%3Dc+%25+d");
    expect(p.q).toBe("a&b=c % d");
    expect(parse(orderListQuery(p)).q).toBe(p.q);
  });
});

describe("saved views", () => {
  it("store the parameters except the cursor and the view's own id, as strings the parser reads again", () => {
    const params = parse(`q=vip&pay=paid&tag=late&range=30d&sort=total_desc&after=abc&view=${ID}`);
    const record = viewRecordOf(params);
    expect(record).toEqual({ q: "vip", pay: "paid", tag: "late", range: "30d", sort: "total_desc" });
    expect(readViewRecord(record).present).toEqual({ q: "vip", pay: ["paid"], tag: ["late"], range: "30d", sort: "total_desc" });
  });

  it("read back to the same list: opening a view is typing its parameters", () => {
    const params = parse("pay=paid,refunded&ship=sent&tag=VIP&from=2026-09-01&to=2026-09-30&market=se&source=checkout&gift=1&archived=all&sort=placed_asc&cols=placed,total");
    const opened = resolveOrderListParams({}, readViewRecord(viewRecordOf(params)).present);
    expect(opened).toEqual({ ...params, after: null, view: null });
  });

  it("drop unknown keys and invalid values on the way in and out, and say which no longer apply", () => {
    const read = readViewRecord({ pay: "paid", market: "norway", foo: "bar", after: "abc", view: ID, tag: ["a", "b"], gift: true });
    expect(read.present).toEqual({ pay: ["paid"], tag: ["a", "b"], gift: true });
    expect(read.ignored).toEqual(["market"]);
    expect(readViewRecord(null)).toEqual({ present: {}, ignored: [] });
    expect(readViewRecord([1, 2])).toEqual({ present: {}, ignored: [] });
    expect(readViewRecord("pay=paid")).toEqual({ present: {}, ignored: [] });
  });

  it("are applied first and the address overrides them", () => {
    const view = readViewRecord({ pay: "paid", sort: "total_desc", q: "vip" }).present;
    const address = readOrderListParams(new URLSearchParams(`view=${ID}&sort=placed_asc&tag=late`)).present;
    const merged = resolveOrderListParams(address, view);
    expect(merged).toMatchObject({ pay: ["paid"], q: "vip", sort: "placed_asc", tag: ["late"], view: ID, after: null });
  });

  it("let a relative range in the address replace the view's dates, and dates replace its range", () => {
    const withDates = readViewRecord({ from: "2026-09-01", to: "2026-09-30" }).present;
    const range = readOrderListParams(new URLSearchParams("range=7d")).present;
    expect(resolveOrderListParams(range, withDates)).toMatchObject({ from: null, to: null, range: "7d" });
    const withRange = readViewRecord({ range: "30d" }).present;
    const dates = readOrderListParams(new URLSearchParams("from=2026-10-01")).present;
    expect(resolveOrderListParams(dates, withRange)).toMatchObject({ from: "2026-10-01", range: null });
  });

  it("never carry a cursor", () => {
    const view = { ...readViewRecord({ pay: "paid" }).present, after: "abc" };
    expect(resolveOrderListParams({}, view).after).toBeNull();
  });
});

describe("a saved view's title", () => {
  it("is trimmed with its spaces collapsed, 1 to 40 characters", () => {
    expect(normaliseViewTitle("  Unpaid   VIP ")).toEqual({ ok: true, title: "Unpaid VIP" });
    expect(normaliseViewTitle("x".repeat(40))).toEqual({ ok: true, title: "x".repeat(40) });
    expect(normaliseViewTitle("x".repeat(41))).toEqual({ ok: false, problem: "too_long" });
    expect(normaliseViewTitle("   ")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseViewTitle(undefined)).toEqual({ ok: false, problem: "empty" });
    expect(normaliseViewTitle(String.fromCodePoint(0x1f600).repeat(40)).ok).toBe(true);
    expect(normaliseViewTitle(String.fromCodePoint(0x1f600).repeat(41)).ok).toBe(false);
  });
});

describe("what the parameters mean", () => {
  it("says which statements are about real sales, so copied history never matches them", () => {
    expect(excludesCopied(parse(""))).toBe(false);
    expect(excludesCopied(parse("q=anna"))).toBe(false);
    expect(excludesCopied(parse("tag=vip&market=no&gift=1&archived=all&from=2026-09-01"))).toBe(false);
    expect(excludesCopied(parse("source=copied"))).toBe(false);
    expect(excludesCopied(parse("show=archived"))).toBe(false);
    expect(excludesCopied(parse("pay=paid"))).toBe(true);
    expect(excludesCopied(parse("ship=sent"))).toBe(true);
    expect(excludesCopied(parse("status=cancelled"))).toBe(true);
    expect(excludesCopied(parse("source=checkout"))).toBe(true);
    expect(excludesCopied(parse("source=draft"))).toBe(true);
    expect(excludesCopied(parse("show=to-send"))).toBe(true);
    expect(excludesCopied(parse("show=unpaid"))).toBe(true);
  });

  it("knows unfinished checkouts: show=unpaid or pay=unpaid", () => {
    expect(isUnfinishedView(parse("show=unpaid"))).toBe(true);
    expect(isUnfinishedView(parse("pay=unpaid,paid"))).toBe(true);
    expect(isUnfinishedView(parse("pay=paid"))).toBe(false);
  });

  it("knows when something narrows the list (and the columns do not)", () => {
    expect(hasFilters(parse(""))).toBe(false);
    expect(hasFilters(parse("cols=total&sort=total_asc"))).toBe(false);
    for (const q of ["q=a1", "show=to-send", "pay=paid", "ship=sent", "status=paid", "tag=x", "from=2026-09-01", "range=7d", "market=no", "source=draft", "gift=1", "archived=yes", `view=${ID}`]) {
      expect(hasFilters(parse(q)), q).toBe(true);
    }
  });

  it("lists the built-in views in the bar's order", () => {
    expect(BUILT_IN_VIEWS.map((v) => v.show)).toEqual([null, "to-send", "waiting", "unpaid", "archived"]);
  });

  it("describes each active filter in words for the chips", () => {
    const words = describeFilters(parse("q=anna&pay=partially_refunded&ship=to_send&tag=vip&range=30d&market=no&source=draft&gift=1&archived=yes")).map((d) => d.label);
    expect(words).toEqual(["Search: anna", "Payment: partially refunded", "Fulfilment: to send", "Tagged: vip", "Placed: last 30 days", "Market: NO", "Source: Staff-made", "Gifts", "Archived only"]);
    expect(describeFilters(parse(""))).toEqual([]);
  });
});

describe("the store's own days", () => {
  it("adds days as dates, over month ends and leap years, with no time zone in it", () => {
    expect(addDays("2026-10-06", 1)).toBe("2026-10-07");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("validates dates: real days of 2000 to 2100 written YYYY-MM-DD", () => {
    expect(["2026-10-06", "2024-02-29"].every(isDateString)).toBe(true);
    expect(["2026-02-29", "2026-13-01", "2026-1-1", "26-10-06", "1999-12-31", "2101-01-01", "", null, 5].some(isDateString)).toBe(false);
  });

  it("works out relative ranges from the store's today: 7 days include today", () => {
    expect(rangeDays("7d", "2026-10-06")).toEqual({ from: "2026-09-30", to: "2026-10-06" });
    expect(rangeDays("30d", "2026-10-06")).toEqual({ from: "2026-09-07", to: "2026-10-06" });
    expect(rangeDays("90d", "2026-10-06")).toEqual({ from: "2026-07-09", to: "2026-10-06" });
    expect(rangeDays("this_month", "2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    expect(rangeDays("last_month", "2026-10-06")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeDays("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(rangeDays("last_month", "2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("ends a range at the start of the day after its last day, as a date, so winter and summer time cannot move it", () => {
    expect(dateWindow({ from: "2026-03-28", to: "2026-03-29", range: null }, "2026-10-06")).toEqual({ from: "2026-03-28", toExclusive: "2026-03-30" });
    expect(dateWindow({ from: "2026-10-24", to: "2026-10-25", range: null }, "2026-10-06")).toEqual({ from: "2026-10-24", toExclusive: "2026-10-26" });
    expect(dateWindow({ from: "2026-09-01", to: null, range: null }, "2026-10-06")).toEqual({ from: "2026-09-01", toExclusive: null });
    expect(dateWindow({ from: null, to: "2026-09-30", range: null }, "2026-10-06")).toEqual({ from: null, toExclusive: "2026-10-01" });
    expect(dateWindow({ from: null, to: null, range: "7d" }, "2026-10-06")).toEqual({ from: "2026-09-30", toExclusive: "2026-10-07" });
    expect(dateWindow({ from: null, to: null, range: null }, "2026-10-06")).toEqual({ from: null, toExclusive: null });
  });
});

describe("the cursor", () => {
  const PLACED = "2026-10-06 14:30:15.123456+00";

  it("carries the sort, the sort key and the id, and reads back", () => {
    const cursor = cursorFor("placed_desc", PLACED, ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, "placed_desc")).toEqual({ sort: "placed_desc", key: PLACED, id: ID });
    expect(decodeCursor(cursorFor("total_asc", 129900, ID), "total_asc")).toEqual({ sort: "total_asc", key: "129900", id: ID });
    expect(decodeCursor(cursorFor("total_desc", BigInt(5), ID), "total_desc")?.key).toBe("5");
  });

  it("keeps a timestamp's microseconds: a JavaScript date would cut them, and equal-looking rows would repeat or vanish", () => {
    const key = "2026-10-06 14:30:15.123457+02";
    expect(decodeCursor(cursorFor("placed_asc", key, ID), "placed_asc")?.key).toBe(key);
  });

  it("is the first page (null) when it is invalid, for another sort, or holds the wrong kind of key", () => {
    expect(decodeCursor(null, "placed_desc")).toBeNull();
    expect(decodeCursor("", "placed_desc")).toBeNull();
    expect(decodeCursor("not a cursor", "placed_desc")).toBeNull();
    expect(decodeCursor("%%%%", "placed_desc")).toBeNull();
    expect(decodeCursor("e30", "placed_desc")).toBeNull();
    expect(decodeCursor(cursorFor("placed_desc", PLACED, ID), "placed_asc")).toBeNull();
    expect(decodeCursor(cursorFor("total_desc", PLACED, ID), "total_desc")).toBeNull();
    expect(decodeCursor(cursorFor("placed_desc", "12345", ID), "placed_desc")).toBeNull();
    expect(decodeCursor(cursorFor("placed_desc", PLACED, "not-an-id"), "placed_desc")).toBeNull();
    expect(decodeCursor(encodeCursor({ sort: "placed_desc", key: "'; drop table x", id: ID }), "placed_desc")).toBeNull();
  });

  it("is made of nothing the browser can read as SQL: the key is checked to be a timestamp or a number, the id a uuid", () => {
    for (const bad of ["1 or 1=1", "2026-10-06 14:30:15'; --", "9".repeat(30)]) {
      expect(decodeCursor(encodeCursor({ sort: bad.startsWith("9") ? "total_desc" : "placed_desc", key: bad, id: ID }), bad.startsWith("9") ? "total_desc" : "placed_desc"), bad).toBeNull();
    }
  });
});

describe("counting", () => {
  it("says the number, and 10,000+ when the count hit its cap", () => {
    expect(countText(0)).toBe("0 orders");
    expect(countText(1)).toBe("1 order");
    expect(countText(37)).toBe("37 orders");
    expect(countText(1234)).toBe("1,234 orders");
    expect(countText(10_000)).toBe("10,000 orders");
    expect(countText(10_001)).toBe("10,000+ orders");
  });
});
