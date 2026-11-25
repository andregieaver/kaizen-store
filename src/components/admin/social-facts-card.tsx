import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import { formatMoney } from "@/lib/money";
import type { SocialFacts } from "@/lib/social-facts";

/**
 * The adviser's facts as the owner reads them (D870 S1.3), on the Social posts page one step away (Lisa's): every figure the adviser will
 * work from, worked out by code (`socialFacts()`), so the owner can check what it is told before it says anything.
 */
export function SocialFactsCard({ facts, words: w, locale }: { facts: SocialFacts; words: SocialMessages["facts"]; locale: string }) {
  const money = (minor: number) => formatMoney(minor, facts.store.currency, locale);
  const number = (n: number) => n.toLocaleString(locale);
  const pct = (share: number | null) => (share === null ? w.unknown : `${Math.round(share * 100)} %`);
  const signed = (share: number) => `${share > 0 ? "+" : ""}${Math.round(share * 100)} %`;
  const reach = (n: number | null) => (n === null ? w.unknown : number(n));
  const ig = facts.instagram;
  const instagramLines = (): string[] => {
    if (ig.state !== "ready") return [ig.state === "none" ? w.igNone : ig.state === "reconnect" ? w.igReconnect : w.igWaiting];
    return [
      fillWords(w.igLine, {
        username: ig.username,
        posts: number(ig.posts),
        perWeek: ig.postsPerWeek.toLocaleString(locale),
        days: ig.daysSinceLastPost === null ? w.unknown : number(ig.daysSinceLastPost),
      }),
      fillWords(w.igKinds, { feed: reach(ig.byKind.feed.averageReach), reel: reach(ig.byKind.reel.averageReach), story: reach(ig.byKind.story.averageReach) }),
      ...(ig.savesPer100Reach === null ? [] : [fillWords(w.igSaves, { saves: ig.savesPer100Reach.toLocaleString(locale) })]),
      ...(ig.bestWeekday === null ? [] : [fillWords(w.igBestDay, { day: w.weekdays[ig.bestWeekday as keyof typeof w.weekdays] })]),
    ];
  };
  const fb = facts.facebook ?? { state: "none" as const };
  const facebookLines = (): string[] => {
    if (fb.state !== "ready") return [fb.state === "none" ? w.fbNone : fb.state === "choose" ? w.fbChoose : w.fbWaiting];
    return [
      fillWords(w.fbLine, {
        name: fb.name,
        posts: number(fb.posts),
        perWeek: fb.postsPerWeek.toLocaleString(locale),
        days: fb.daysSinceLastPost === null ? w.unknown : number(fb.daysSinceLastPost),
      }),
      fillWords(w.fbAverages, { reach: reach(fb.averageReach), interactions: reach(fb.averageInteractions) }),
      ...(fb.bestWeekday === null ? [] : [fillWords(w.igBestDay, { day: w.weekdays[fb.bestWeekday as keyof typeof w.weekdays] })]),
    ];
  };
  const rows: { label: string; lines: string[] }[] = [
    {
      label: fillWords(w.sales, { days: String(facts.sales.days) }),
      lines: [
        fillWords(w.salesLine, { revenue: money(facts.sales.revenueMinor), orders: number(facts.sales.orders) }),
        facts.sales.revenueChange === null ? w.noChange : fillWords(w.change, { change: signed(facts.sales.revenueChange), days: String(facts.sales.days) }),
      ],
    },
    {
      label: w.social,
      lines: [
        facts.social
          ? fillWords(w.socialLine, {
              sessions: number(facts.social.sessions),
              sessionShare: pct(facts.social.shareOfSessions),
              revenue: money(facts.social.revenueMinor),
              revenueShare: pct(facts.social.shareOfRevenue),
            })
          : w.socialOff,
      ],
    },
    {
      label: w.push,
      lines:
        facts.push.length === 0
          ? [fillWords(w.pushNone, { days: String(facts.sales.days) })]
          : facts.push.map((p) =>
              [
                p.title,
                p.margin === null ? null : fillWords(w.margin, { margin: pct(p.margin) }),
                fillWords(w.sold, { units: number(p.units) }),
                p.stock === null ? null : fillWords(w.inStock, { stock: number(p.stock) }),
              ]
                .filter(Boolean)
                .join(" · "),
            ),
    },
    ...(facts.newProducts.length > 0 ? [{ label: w.newProducts, lines: facts.newProducts.map((p) => p.title) }] : []),
    { label: w.creator, lines: [fillWords(w.creatorLine, { written: number(facts.creator.written), copied: number(facts.creator.copied) })] },
    {
      label: w.instagram,
      lines: instagramLines(),
    },
    { label: w.facebook, lines: facebookLines() },
  ];
  return (
    <details className="rounded-panel bg-sunken p-4">
      <summary className="cursor-pointer text-body-strong text-ink">{w.title}</summary>
      <p className="mt-2 text-caption text-ink-2">{w.lead}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-sm font-medium text-ink">{row.label}</dt>
            <dd className="flex flex-col text-sm text-ink-2">
              {row.lines.map((line, i) => (
                <span key={i}>{line}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
