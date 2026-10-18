import type { LiveDemo } from "@/lib/demo-stores";
import type { ThemeSwatch } from "@/lib/theme-store";

/**
 * *See it live* on a theme's page in the theme store (D277, `docs/themes-content-and-demo-stores.md` section 6): a card for each published
 * demo store wearing one of the theme's looks, with its picture (else the look's colours), its name, its trade and which look it wears, each
 * opening the store at its own address. Nothing is drawn when there is none. The only place the theme store says *demo store*.
 */
export function SeeItLive({
  title,
  demos,
  looks,
}: {
  /** The theme's name: what a demo store wearing its own look is said to wear. */
  title: string;
  demos: readonly LiveDemo[];
  /** The theme's looks by key (null: its own), for each card's look name and colours. */
  looks: readonly { key: string | null; name: string; swatch: ThemeSwatch | null }[];
}) {
  if (demos.length === 0) return null;
  const own = looks.find((look) => look.key === null);
  return (
    <section aria-labelledby="see-it-live" className="flex flex-col gap-6" data-see-it-live="">
      <div className="flex flex-col gap-1">
        <h2 id="see-it-live" className="text-2xl font-semibold tracking-tight">
          See it live
        </h2>
        <p className="text-muted">Demo stores wearing {title}, with their own words, pictures and products.</p>
      </div>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {demos.map((demo) => {
          // A preset the theme no longer has: the theme's own look, as an install of it shows (`installedLook()`).
          const look = looks.find((one) => one.key === demo.variation && demo.variation !== null) ?? own;
          const lookName = look && look.key !== null ? `${title} · ${look.name}` : title;
          const s = look?.swatch ?? own?.swatch ?? null;
          return (
            <li key={demo.id}>
              <a href={demo.href} className="group flex flex-col gap-3">
                {demo.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a demo store's picture from Kaizena Flow's media library
                  <img src={demo.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-lg border border-border object-cover" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex aspect-video w-full items-end gap-2 rounded-lg border border-border p-5"
                    style={{ background: s?.background ?? "#f5f5f5" }}
                  >
                    <span className="h-8 w-20 rounded-full" style={{ background: s?.accent ?? "#111111" }} />
                    <span className="size-8 rounded-full" style={{ background: s?.text ?? "#111111" }} />
                  </span>
                )}
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium group-hover:underline">{demo.name}</span>
                  {demo.trade && <span className="text-sm text-muted">{demo.trade}</span>}
                  <span className="text-sm text-muted">Wears {lookName}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
