// The Mission Statement page (`/mission-statement`), made on 7 November 2026 at the owner's request ("the mission statement with mockup
// content based of what's written on the about us page"), from docs/site-design.md's recipes in the feature pages' shape (6.11): the hero
// with the mission, three beliefs, Kaizena Flow and Kaizen Life, how we work, where we are headed and the end. Its words are the About us
// page's (KaizenaLabs' mission, who we are, what we do, why we exist, where we are headed), put as a mission; the few lines that go beyond
// it say what is built, their source beside them. Checked by `checkPage()` (parts.ts).
import { expect, it } from "vitest";

import { CARD, LINED, TURN_A, TURN_B, TURN_C, card, cardsRow, checkPage, dual, featureRow, hero, highlightRow, id, lead, mainAction, margin, onSand, pad, para, rich } from "./parts";

const under = (text: string, href: string) => rich([para({ text, href })], { style: margin(-20, 0, 0, 0), typography: { text: { align: "center" } } });

export function missionStatementPage() {
  const rows = [
    // About us, Why we exist: "Our mission is to leverage this to enhance the capabilities and livelihood for everyone."
    hero({
      eyebrow: "Our Mission",
      title: "AI That Lifts Everyone",
      bold: "We use AI to enhance the capabilities and livelihood of everyone.",
      rest: "It is why KaizenaLabs exists, and why we built Kaizena Flow.",
      anchor: { text: "Read what we believe", href: "#believe" },
      claims: ["Simple", "Automated", "Made for people"],
    }),
    // About us: bullish on the opportunities and power of AI for companies and individuals; custom, simplified and automated solutions.
    // People in charge: the AI manager asks before anything that matters, and its changes are in the activity log as the AI's (D94, D309).
    cardsRow({
      htmlId: "believe",
      eyebrow: "What Drives Us",
      title: "Three Things We Believe",
      tone: "light-color",
      bold: "AI is the biggest chance in a generation, for companies and people alike.",
      rest: "We want everyone to share in it, not only the largest companies.",
      background: TURN_A,
      cards: [
        card("Power", "for Everyone", "Big-company tools for every business.", "A shop of one should have the help a large company has: a team of AI that works for it."),
        card("Simple", "by Design", "Custom, simplified and automated.", "We take the hard parts away, so people spend their time on what they love doing."),
        card("People", "in Charge", "AI does the work, you decide.", "Our agents ask before anything that matters, and every change they make is written down."),
      ],
    }),
    // About us, Kaizena Flow: a store platform that challenges Shopify, WooCommerce and the like, every tool and AI by your side. The lines
    // are built: the AI manager (D94), the Dream Factory (D409), VAT and the EU's rules (D157, wave 1), languages (D109, D312).
    featureRow({
      eyebrow: "For Businesses",
      title: "Kaizena Flow",
      tone: "dark-color",
      bold: "An online store platform that challenges the giants.",
      rest: "With every tool in one place and AI by your side, there is no end to what a shop can do.",
      background: TURN_B,
      lines: ["An AI Store Manager on every page", "Your store built from one description", "Europe's VAT and rules included", "Selling in your customers' languages"],
    }),
    // About us, Kaizen Life: all of life's diversity together; any email or social media account, any wearable; AI to organise and automate.
    // The Flow/Life Connection: a bridge between them.
    featureRow({
      eyebrow: "For Everyday Life",
      title: "Kaizen Life",
      tone: "light-color",
      bold: "All of life's diversity, brought together.",
      rest: "Connect any email or social media account and any wearable, and let AI organise and automate your days.",
      background: TURN_A,
      listFirst: true,
      lines: ["Email and social media in one place", "Training and tracking from your wearables", "AI that organises and automates", "A bridge to Kaizena Flow"],
    }),
    // About us, Who we are: a hybrid team of humans and AI agents, in Oslo. Kaizena Flow's own site runs on Kaizena Flow (D466, D484).
    // Kaizen: continuous improvement, the name's own meaning. Data in the EU (CLAUDE.md, Stack).
    highlightRow([
      { eyebrow: "Our Team", title: "People and AI Agents", bold: "We work side by side with our own AI agents.", rest: "And we use what we build: this site runs on Kaizena Flow." },
      { eyebrow: "Our Name", title: "Always Improving", bold: "Kaizen means continuous improvement.", rest: "We ship small steps every day, and test each one before the next." },
      { eyebrow: "Our Home", title: "Oslo, Norway", bold: "Made in Oslo, for Europe and beyond.", rest: "Kaizena Flow keeps its data processing in the EU." },
    ]),
    // About us, Where we are headed: a global voice and solutions provider; the future with AI is unknown, but we will be part of it.
    {
      id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true, contentMax: 880, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 30, 40), typography: { text: { color: "#171717", align: "center" } },
        blocks: [
          dual(2, "Where We Are Headed", "A Global Voice in AI", "light-color"),
          lead("We aim to become a global voice and solutions provider in AI.", "No one knows exactly what the future with AI brings, but we mean to be an integral part of it, and to bring our customers along."),
        ],
      }],
    },
    // The end (6.7): the main action, and the Investors page as the text link.
    {
      id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true, contentMax: 968,
      typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Join Us", "Be Part of What Comes Next", "dark-color"),
          lead("Open your store and let AI do the work.", "Or read how to invest in KaizenaLabs."),
          mainAction(),
          under("Invest in KaizenaLabs", "/investors"),
        ],
      }],
    },
  ];
  return {
    title: "Mission Statement",
    slug: "mission-statement",
    seo: {
      title: "Our Mission: AI That Lifts Everyone | Kaizena Flow",
      description: "KaizenaLabs, the lab behind Kaizena Flow, uses AI to enhance the capabilities and livelihood of everyone, from shop owners to everyday life.",
    },
    rows,
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

it("builds the Mission Statement page as the editor would save it", () => {
  const checked = checkPage("mission-statement", missionStatementPage());
  expect(checked.errors).toEqual([]);
  expect(checked.slugProblem).toBeNull();
  expect(checked.blocking).toBe(0);
  expect(checked.claims).toEqual([]);
  expect(checked.seo[0]).toBeLessThan(60);
  expect(checked.seo[1]).toBeLessThan(160);
});
