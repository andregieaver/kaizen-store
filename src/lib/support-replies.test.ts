import { describe, expect, it } from "vitest";

import { fillPlaceholders, firstName, insertReply, matchReplies, shortcutFrom, slashQuery, unknownPlaceholders } from "./support-replies";

const all = { customerFirstName: "Kari", agentFirstName: "Ola", store: "Fjell & Fjord" };
const none = { customerFirstName: null, agentFirstName: null, store: null };

describe("saved replies' placeholders (D216, step 13)", () => {
  it("fills in the customer's and the agent's first names and the store", () => {
    expect(fillPlaceholders("Hi {customer_first_name}, this is {agent_first_name} at {store}.", all)).toBe("Hi Kari, this is Ola at Fjell & Fjord.");
    expect(fillPlaceholders("{customer_first_name} {customer_first_name}", all)).toBe("Kari Kari");
  });

  it("leaves a name that is not known out, with the space before it, never as a gap or the placeholder", () => {
    expect(fillPlaceholders("Hi {customer_first_name}, thanks for waiting.", none)).toBe("Hi, thanks for waiting.");
    expect(fillPlaceholders("Hi {customer_first_name}!", none)).toBe("Hi!");
    expect(fillPlaceholders("{customer_first_name}, your parcel is on its way.", none)).toBe("your parcel is on its way.");
    expect(fillPlaceholders("Best wishes\n{agent_first_name}", none)).toBe("Best wishes\n");
  });

  it("keeps anything else as it was written, other lines included", () => {
    expect(fillPlaceholders("Use {code} at checkout.\n...", all)).toBe("Use {code} at checkout.\n...");
    expect(unknownPlaceholders("Hi {customer_name} and {store} {code}")).toEqual(["customer_name", "code"]);
    expect(unknownPlaceholders("Hi {customer_first_name}")).toEqual([]);
  });

  it("never lets a typed control character through", () => {
    expect(fillPlaceholders("a\u0000b {store}", all)).toBe("ab Fjell & Fjord");
  });

  it("takes a first name from a name, never from an email address", () => {
    expect(firstName("  Kari  Nordmann ")).toBe("Kari");
    expect(firstName("kari@example.com")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe("the composer's / picker", () => {
  const replies = [
    { id: "1", title: "Where is my parcel", shortcut: "tracking", locale: null },
    { id: "2", title: "Returns", shortcut: "returns", locale: "en" },
    { id: "3", title: "Retur", shortcut: "retur", locale: "nb" },
    { id: "4", title: "Thanks for waiting", shortcut: "wait", locale: null },
  ];

  it("reads the word after a / at the start of the text or a line, up to the cursor", () => {
    expect(slashQuery("/ret", 4)).toEqual({ query: "ret", start: 0 });
    expect(slashQuery("Hi\n/", 4)).toEqual({ query: "", start: 3 });
    expect(slashQuery("and/or", 6)).toBeNull();
    expect(slashQuery("/ret more", 9)).toBeNull();
  });

  it("offers shortcuts first, then titles, the conversation's language before any and another's last", () => {
    expect(matchReplies(replies, "ret", "nb").map((r) => r.id)).toEqual(["3", "2"]);
    expect(matchReplies(replies, "ret", "en").map((r) => r.id)).toEqual(["2", "3"]);
    expect(matchReplies(replies, "ret", "nb-NO").map((r) => r.id)).toEqual(["3", "2"]);
    expect(matchReplies(replies, "parcel", "en").map((r) => r.id)).toEqual(["1"]);
    expect(matchReplies(replies, "", "sv").map((r) => r.id)).toEqual(["1", "4", "3", "2"]);
    expect(matchReplies(replies, "zzz", "en")).toEqual([]);
  });

  it("puts the reply in place of /word and the cursor after it", () => {
    const slash = slashQuery("Hi\n/ret", 7)!;
    expect(insertReply("Hi\n/ret", slash, "Returns are free.")).toEqual({ text: "Hi\nReturns are free.", cursor: 20 });
  });

  it("suggests a shortcut from a title", () => {
    expect(shortcutFrom("Where is my parcel?")).toBe("where-is-my-parcel");
    expect(shortcutFrom("Bytte og retur før jul")).toBe("bytte-og-retur-for-j");
    expect(shortcutFrom("Ærlig talt")).toBe("aerlig-talt");
  });
});
