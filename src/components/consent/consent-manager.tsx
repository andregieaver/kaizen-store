"use client";

import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  CONSENT_DAYS,
  FULL_CONSENT,
  KNOWN_COOKIES,
  NO_CONSENT,
  OPTIONAL_CATEGORIES,
  consentCookieName,
  consentIsCurrent,
  consentVersion,
  decodeConsent,
  encodeConsent,
  type ConsentChoices,
  type OptionalCategory,
  type TrackingSettings,
} from "@/lib/cookie-consent";
import { addCustomCode, type CustomCode } from "@/lib/custom-code";

/** The widget's words, in the site's language (from `i18n`, picked on the server). */
export type ConsentTexts = {
  title: string;
  text: string;
  acceptAll: string;
  rejectAll: string;
  choose: string;
  save: string;
  settings: string;
  alwaysOn: string;
  cookiePage: string;
  categories: Record<"necessary" | OptionalCategory, { name: string; text: string }>;
};

/** Opens the choices from anywhere on the page: the cookie page's and the footer's buttons. */
export const OPEN_CONSENT_EVENT = "kaizen:cookie-settings";

type Props = {
  /** The store's id, or null on Kaizen's own site: each site asks for itself. */
  storeId: string | null;
  tracking: TrackingSettings;
  /** The owner's own code (D61), added as far as the visitor allows. */
  code?: CustomCode;
  /** The optional categories the site uses: its tools', and what its cookie scan found. */
  categories: OptionalCategory[];
  texts: ConsentTexts;
  /** The site's cookie page. */
  cookiePage: string;
};

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[][] };
type Tracked = Window & { dataLayer?: unknown[]; gtag?: Gtag; fbq?: Fbq; _fbq?: Fbq };

const loaded = new Set<string>();

function loadScript(src: string) {
  if (loaded.has(src)) return;
  loaded.add(src);
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

const consentState = (granted: boolean) => (granted ? "granted" : "denied");

/**
 * Loads the tools the visitor allowed, each once (D58). Google's get Consent
 * Mode v2 signals first; nothing loads for a category that is not allowed.
 */
function applyChoices(tracking: TrackingSettings, choices: ConsentChoices) {
  const w = window as Tracked;
  if (tracking.ga4 || tracking.gtm) {
    w.dataLayer = w.dataLayer ?? [];
    if (!w.gtag) {
      w.gtag = function gtag() {
        // Google's tag reads the `arguments` object itself.
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments);
      };
      w.gtag("consent", "default", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
        functionality_storage: "denied",
        personalization_storage: "denied",
        security_storage: "granted",
      });
    }
    w.gtag("consent", "update", {
      analytics_storage: consentState(choices.statistics),
      ad_storage: consentState(choices.marketing),
      ad_user_data: consentState(choices.marketing),
      ad_personalization: consentState(choices.marketing),
      functionality_storage: consentState(choices.preferences),
      personalization_storage: consentState(choices.preferences),
    });
  }
  if (tracking.ga4 && choices.statistics && !loaded.has("ga4")) {
    loaded.add("ga4");
    w.gtag!("js", new Date());
    w.gtag!("config", tracking.ga4);
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tracking.ga4)}`);
  }
  if (tracking.gtm && (choices.statistics || choices.marketing) && !loaded.has("gtm")) {
    loaded.add("gtm");
    w.dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
    loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(tracking.gtm)}`);
  }
  if (tracking.metaPixel && choices.marketing && !loaded.has("meta")) {
    loaded.add("meta");
    if (!w.fbq) {
      // Meta's stub: calls wait in a queue until its script arrives.
      const fbq: Fbq = Object.assign(
        (...args: unknown[]) => {
          if (fbq.callMethod) fbq.callMethod(...args);
          else fbq.queue.push(args);
        },
        { queue: [] as unknown[][], loaded: true, version: "2.0" },
      );
      Object.assign(fbq, { push: fbq });
      w.fbq = fbq;
      w._fbq = fbq;
    }
    w.fbq("init", tracking.metaPixel);
    w.fbq("track", "PageView");
    loadScript("https://connect.facebook.net/en_US/fbevents.js");
  }
}

const noSubscription = () => () => {};

/** Removes a withdrawn category's cookies this site can reach (its own domain and the parent). */
function forget(categories: OptionalCategory[]) {
  const names = document.cookie.split("; ").map((pair) => pair.split("=")[0]);
  const host = location.hostname;
  const domains = ["", host, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of names) {
    const known = KNOWN_COOKIES.find((cookie) => cookie.pattern.test(name));
    if (!known || !categories.includes(known.category as OptionalCategory)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}

function newVisitor(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

/**
 * The cookie consent widget (D58): asks once, on the first visit, when the
 * site uses anything optional; remembers the answer in the site's consent
 * cookie for a year; records it as proof; and loads only what was allowed.
 * Accepting and rejecting are equally easy, and the choices can be opened
 * again at any time from the cookie page or the footer.
 */
export function ConsentManager({ storeId, tracking, code = {}, categories, texts, cookiePage }: Props) {
  const version = consentVersion(categories);
  const name = consentCookieName(storeId);
  // Hidden once the visitor decides here; before that, shown when there is no current choice.
  const [decided, setDecided] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState<ConsentChoices>(NO_CONSENT);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  const read = () => decodeConsent(document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1));

  // The consent cookie as the page starts: nothing on the server, so the banner appears in the browser.
  const cookies = useSyncExternalStore(
    noSubscription,
    () => document.cookie,
    () => null,
  );
  const current = cookies !== null && consentIsCurrent(read(), version);
  const banner = cookies !== null && !decided && !current;

  // A choice already made loads what it allowed.
  const start = useEffectEvent(() => {
    const stored = read();
    if (categories.length > 0 && consentIsCurrent(stored, version)) {
      applyChoices(tracking, stored!.choices);
      addCustomCode(code, stored!.choices);
    }
  });
  useEffect(() => start(), []);

  const openChoices = () => {
    const stored = read();
    setDraft(consentIsCurrent(stored, version) ? stored!.choices : NO_CONSENT);
    setChoosing(true);
  };
  // The choices open again from the cookie page's and footer's buttons.
  const onOpen = useEffectEvent(openChoices);
  useEffect(() => {
    const listener = () => onOpen();
    window.addEventListener(OPEN_CONSENT_EVENT, listener);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, listener);
  }, []);

  useEffect(() => {
    if (choosing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [choosing]);

  // Meta counts each page; the storefront moves between pages without loading them.
  useEffect(() => {
    if (pathname === firstPath.current) return;
    (window as Tracked).fbq?.("track", "PageView");
  }, [pathname]);

  const decide = (choices: ConsentChoices) => {
    const stored = read();
    const visitor = stored?.visitor ?? newVisitor();
    // Only what the site uses can be allowed.
    const allowed = Object.fromEntries(
      OPTIONAL_CATEGORIES.map((c) => [c, choices[c] && categories.includes(c)]),
    ) as ConsentChoices;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeConsent({ visitor, version, choices: allowed })}; Max-Age=${CONSENT_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
    void fetch("/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, visitor, version, choices: allowed }),
      keepalive: true,
    }).catch(() => {});
    setDecided(true);
    setChoosing(false);
    const withdrawn = stored ? OPTIONAL_CATEGORIES.filter((c) => stored.choices[c] && !allowed[c]) : [];
    if (withdrawn.length > 0) {
      // A tool already running cannot be stopped: its cookies go, and the page starts again without it.
      forget(withdrawn);
      location.reload();
      return;
    }
    applyChoices(tracking, allowed);
    addCustomCode(code, allowed);
  };

  if (categories.length === 0) return null;
  const button =
    "min-h-11 flex-1 rounded-button px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <>
      {banner && !choosing && (
        <section
          aria-labelledby={titleId}
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col gap-3 rounded-lg border border-border bg-background p-5 text-sm shadow-xl md:right-auto md:bottom-4 md:left-4 md:max-w-md print:hidden"
        >
          <h2 id={titleId} className="text-base font-semibold">
            {texts.title}
          </h2>
          <p>
            {texts.text}{" "}
            <a href={cookiePage} className="underline">
              {texts.cookiePage}
            </a>
          </p>
          {/* Rejecting is as easy as accepting: the same look, side by side. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => decide(NO_CONSENT)} className={`${button} button-primary`}>
              {texts.rejectAll}
            </button>
            <button type="button" onClick={() => decide(FULL_CONSENT)} className={`${button} button-primary`}>
              {texts.acceptAll}
            </button>
          </div>
          <button type="button" onClick={openChoices} className="w-fit text-sm underline">
            {texts.choose}
          </button>
        </section>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${titleId}-choices`}
        onCancel={(event) => {
          event.preventDefault();
          setChoosing(false);
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40"
      >
        {choosing && (
          <form
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              decide(draft);
            }}
            className="flex flex-col gap-4 p-5 text-sm"
          >
            <h2 id={`${titleId}-choices`} className="text-base font-semibold">
              {texts.settings}
            </h2>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-3">
                <input type="checkbox" checked disabled id={`${titleId}-necessary`} className="mt-1 size-4" />
                <label htmlFor={`${titleId}-necessary`} className="flex flex-col">
                  <span className="font-medium">
                    {texts.categories.necessary.name} <span className="font-normal text-muted">({texts.alwaysOn})</span>
                  </span>
                  <span className="text-muted">{texts.categories.necessary.text}</span>
                </label>
              </li>
              {categories.map((category) => (
                <li key={category} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    id={`${titleId}-${category}`}
                    checked={draft[category]}
                    onChange={(event) => setDraft({ ...draft, [category]: event.target.checked })}
                    className="mt-1 size-4 accent-foreground"
                  />
                  <label htmlFor={`${titleId}-${category}`} className="flex flex-col">
                    <span className="font-medium">{texts.categories[category].name}</span>
                    <span className="text-muted">{texts.categories[category].text}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => decide(NO_CONSENT)} className={`${button} border border-border`}>
                {texts.rejectAll}
              </button>
              <button type="button" onClick={() => decide(FULL_CONSENT)} className={`${button} border border-border`}>
                {texts.acceptAll}
              </button>
              <button type="submit" className={`${button} button-primary`}>
                {texts.save}
              </button>
            </div>
            <a href={cookiePage} className="w-fit underline">
              {texts.cookiePage}
            </a>
          </form>
        )}
      </dialog>
    </>
  );
}

/** A button that opens the cookie choices (on the cookie page and in the footer). */
export function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))} className={className}>
      {label}
    </button>
  );
}
