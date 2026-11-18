import { describe, expect, it } from "vitest";

import {
  answerSubject,
  automated,
  bareAddress,
  cleanSubject,
  deskAddress,
  deskTakesReplies,
  displayName,
  inboundDomain,
  messageIdOf,
  messageOf,
  referencedIds,
  replyAddress,
  replyOnly,
  routeOf,
  THREAD_IDS_MAX,
} from "./inbound-email";
import { MESSAGE_MAX } from "./support-rules";

/** Email into the support desk (D332, `docs/support.md` step 16): routing, machines, and the customer's own words. */

const DOMAIN = "in.example.com";

describe("replies to the store's order emails (ecosystem plan E1.4)", () => {
  const desk = { mode: "ai_first", formMessages: "inbox", emailKey: "abcdefghijkl0123" };

  it("go to the desk only while it is on, takes customers' messages alone and has its address", () => {
    expect(deskTakesReplies(desk)).toBe(true);
    expect(deskTakesReplies({ ...desk, mode: "people" })).toBe(true);
    expect(deskTakesReplies({ ...desk, mode: "off" })).toBe(false);
    // Both the inbox and the owner's email would answer the same reply twice: the store's address keeps it.
    expect(deskTakesReplies({ ...desk, formMessages: "inbox_and_email" })).toBe(false);
    expect(deskTakesReplies({ ...desk, formMessages: "email" })).toBe(false);
    expect(deskTakesReplies({ ...desk, formMessages: null })).toBe(false);
    expect(deskTakesReplies({ ...desk, emailKey: null })).toBe(false);
    expect(deskTakesReplies({ ...desk, emailKey: "NOT-A-KEY" })).toBe(false);
  });
});

describe("addresses", () => {
  it("reads the receiving domain, bare addresses and names", () => {
    expect(inboundDomain(" @In.Example.com ")).toBe(DOMAIN);
    expect(inboundDomain("")).toBeNull();
    expect(inboundDomain("not a domain")).toBeNull();
    expect(bareAddress('"Kari Nordmann" <Kari@Example.COM>')).toBe("kari@example.com");
    expect(bareAddress("kari@example.com")).toBe("kari@example.com");
    expect(bareAddress("kari")).toBeNull();
    expect(displayName('"Kari Nordmann" <kari@example.com>')).toBe("Kari Nordmann");
    expect(displayName("kari@example.com")).toBeNull();
  });

  it("routes to the first desk or reply address at the domain, and nothing else", () => {
    const desk = deskAddress("abcdefghijkl", DOMAIN);
    const reply = replyAddress("0123456789ab", DOMAIN);
    expect(routeOf(["shop@store.no", `Support <${desk}>`], DOMAIN)).toEqual({ kind: "desk", key: "abcdefghijkl" });
    expect(routeOf([reply.toUpperCase(), desk], DOMAIN)).toEqual({ kind: "reply", key: "0123456789ab" });
    expect(routeOf([`Books <books-abcdefghijkl@${DOMAIN}>`], DOMAIN)).toEqual({ kind: "books", key: "abcdefghijkl" });
    expect(routeOf(["desk-abcdefghijkl@elsewhere.com"], DOMAIN)).toBeNull();
    expect(routeOf([`desk-short@${DOMAIN}`, `other-abcdefghijkl@${DOMAIN}`], DOMAIN)).toBeNull();
  });
});

describe("machines", () => {
  it("knows auto-replies, bounces, lists and its own sender, and lets a person's email through", () => {
    expect(automated("kari@example.com", { "Auto-Submitted": "auto-replied" }, null)).toBe("auto_submitted");
    expect(automated("kari@example.com", { "auto-submitted": "no" }, null)).toBeNull();
    expect(automated("kari@example.com", { Precedence: "bulk" }, null)).toBe("bulk");
    expect(automated("news@example.com", { "List-Id": "<news.example.com>" }, null)).toBe("list");
    expect(automated("MAILER-DAEMON@example.com", {}, null)).toBe("machine_sender");
    expect(automated("no-reply@shop.no", {}, null)).toBe("machine_sender");
    expect(automated("butikk@kaizenaflow.com", {}, "Butikk@kaizenaflow.com")).toBe("own_sender");
    expect(automated('"Kari" <kari@example.com>', { "X-Mailer": "Apple Mail" }, "butikk@kaizenaflow.com")).toBeNull();
  });
});

describe("the customer's own words", () => {
  it("cuts the quoted history each client writes, and the signature", () => {
    expect(replyOnly("Thanks, that helps!\n\nOn Mon, 3 Mar 2026 at 10:00, Shop <reply-x@in.example.com> wrote:\n> Your parcel was sent.")).toBe("Thanks, that helps!");
    expect(replyOnly("Takk!\n\nDen man. 3. mar. 2026 kl. 10:00 skrev Butikk <reply-x@in.example.com>:\n> Pakken er sendt.")).toBe("Takk!");
    expect(replyOnly("Tack!\n\nDen 3 mars 2026 10:00 skrev Butik <reply-x@in.example.com>:\n> Paketet är skickat.")).toBe("Tack!");
    expect(replyOnly("Danke\n\nAm 03.03.2026 um 10:00 schrieb Shop <x@y.de>:\n> Text")).toBe("Danke");
    expect(replyOnly("Merci\n\nLe 3 mars 2026 à 10:00, Boutique <x@y.fr> a écrit :\n> Texte")).toBe("Merci");
    expect(replyOnly("Here it is.\n\n-----Original Message-----\nFrom: Shop\nSent: Monday\nSubject: Re: Order")).toBe("Here it is.");
    expect(replyOnly("Here it is.\n\nFrom: Shop <x@y.no>\nSent: 3 March 2026 10:00\nTo: Kari\nSubject: Order")).toBe("Here it is.");
    expect(replyOnly("Where is my order?\n\n-- \nKari Nordmann\n+47 900 00 000")).toBe("Where is my order?");
    expect(replyOnly("Thanks\n\nOn Mon, 3 Mar 2026 at 10:00, Shop\n<x@y.no> wrote:\n> old")).toBe("Thanks");
  });

  it("keeps the words between quotes, and keeps the quote when it is all there is", () => {
    expect(replyOnly("> What size?\nLarge, please.\n> Colour?\nBlue.")).toBe("Large, please.\nBlue.");
    expect(replyOnly("> only a quote")).toBe("only a quote");
  });

  it("makes the message: the text part or the HTML, the subject first in a new conversation, held to the limit", () => {
    expect(messageOf({ text: "Hello\n\nOn x wrote:\n> y", html: null, subject: "Re: Where is my parcel?" }, { withSubject: true }).body).toBe("Where is my parcel?\n\nHello");
    expect(messageOf({ text: null, html: "<html><body><p>Hi there</p><p>Order 1001</p></body></html>", subject: null }, { withSubject: false }).body).toBe("Hi there\nOrder 1001");
    const long = messageOf({ text: "a ".repeat(2000), html: null, subject: null }, { withSubject: false });
    expect(long.cut).toBe(true);
    expect(long.body.length).toBeLessThanOrEqual(MESSAGE_MAX.customer);
  });
});

describe("subjects and threads", () => {
  it("cleans the subject, answers with Re: and keeps a Message-ID in brackets", () => {
    expect(cleanSubject("Re: SV: Fwd:  My   order ")).toBe("My order");
    expect(cleanSubject("  ")).toBeNull();
    expect(answerSubject("My order", "Answer from Shop")).toBe("Re: My order");
    expect(answerSubject(null, "Answer from Shop")).toBe("Answer from Shop");
    expect(messageIdOf("abc@mail.example.com")).toBe("<abc@mail.example.com>");
    expect(messageIdOf("<abc@mail.example.com>")).toBe("<abc@mail.example.com>");
    expect(messageIdOf("bad\r\nheader: injected")).toBeNull();
  });
});

describe("which conversation a reply continues", () => {
  it("reads In-Reply-To first, then References from the newest back, without repeats", () => {
    expect(
      referencedIds({
        "In-Reply-To": "<answer-2@resend.dev>",
        References: "<first@mail.example.com> <answer-1@resend.dev>\r\n <second@mail.example.com> <answer-2@resend.dev>",
      }),
    ).toEqual(["<answer-2@resend.dev>", "<second@mail.example.com>", "<answer-1@resend.dev>", "<first@mail.example.com>"]);
  });

  it("finds the headers whatever their case, and nothing in an email that answers no one", () => {
    expect(referencedIds({ "in-reply-to": "<a@x.example>" })).toEqual(["<a@x.example>"]);
    expect(referencedIds({ references: ["<a@x.example>", "<b@x.example>"] })).toEqual(["<b@x.example>", "<a@x.example>"]);
    expect(referencedIds({})).toEqual([]);
    expect(referencedIds({ "In-Reply-To": "not an id" })).toEqual([]);
  });

  it("looks at no more than THREAD_IDS_MAX ids", () => {
    const many = Array.from({ length: 50 }, (_, i) => `<m${i}@x.example>`).join(" ");
    const ids = referencedIds({ References: many });
    expect(ids).toHaveLength(THREAD_IDS_MAX);
    expect(ids[0]).toBe("<m49@x.example>");
  });
});
