"use client";

import { useState, useTransition } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import { fillWords } from "@/lib/admin-fill";
import type { RegistrantPrefill } from "@/lib/domain-registrant";
import { formatMoney } from "@/lib/money";

import { ActionForm, SubmitButton } from "./action-form";
import { RegistrantFields } from "./domain-buyer";
import type { MoveInActions, MoveInLookShape, MoveInStartShape, TransferQuoteShape } from "./domain-types";
import { Button, Card, Chip } from "./ui";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
type Said = { ok: boolean; messages: string[] } | null;

function Said({ said }: { said: Said }) {
  if (!said) return null;
  return (
    <p role="status" className={said.ok ? "text-body text-positive-text" : "text-body text-danger-text"}>
      {said.messages.join(" ")}
    </p>
  );
}

/**
 * Bringing a domain here (D315 phase 6): its DNS (look, then copy, then the owner changes the nameservers) and its registration (the price,
 * the code, paid first). Homer sees two plain cards; the records and the registrant are there to read and change.
 */
export function DomainMoveIn({
  domains,
  arriving,
  canBuy,
  closedWhy,
  registrant,
  words,
  getWords,
  locale,
  actions,
}: {
  /** The store's connected domains whose DNS isn't here yet. */
  domains: string[];
  arriving: { apex: string; nameservers: string[] }[];
  canBuy: boolean;
  closedWhy: string | null;
  registrant: RegistrantPrefill;
  words: DomainsMessages["moveIn"];
  getWords: DomainsMessages["get"];
  locale: string;
  actions: MoveInActions;
}) {
  return (
    <div className="flex flex-col gap-6">
      {arriving.length > 0 && <Arriving arriving={arriving} words={words.dns} actions={actions} />}
      <DnsMove domains={domains} words={words.dns} actions={actions} />
      <Transfer canBuy={canBuy} closedWhy={closedWhy} registrant={registrant} words={words.transfer} getWords={getWords} locale={locale} actions={actions} />
    </div>
  );
}

function Arriving({ arriving, words, actions }: { arriving: { apex: string; nameservers: string[] }[]; words: DomainsMessages["moveIn"]["dns"]; actions: MoveInActions }) {
  const [said, setSaid] = useState<Said>(null);
  const [pending, start] = useTransition();
  return (
    <Card title={words.waitingTitle}>
      <ul className="flex flex-col gap-3">
        {arriving.map((z) => (
          <li key={z.apex} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body text-ink">{fillWords(words.waiting, { domain: z.apex, nameservers: z.nameservers.join(", ") })}</span>
            <Button
              kind="quiet"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const state = await actions.stop(z.apex);
                  setSaid({ ok: state.status === "ok", messages: state.messages });
                })
              }
            >
              {words.stop}
            </Button>
          </li>
        ))}
      </ul>
      <Said said={said} />
    </Card>
  );
}

function DnsMove({ domains, words, actions }: { domains: string[]; words: DomainsMessages["moveIn"]["dns"]; actions: MoveInActions }) {
  const [domain, setDomain] = useState(domains[0] ?? "");
  const [zoneText, setZoneText] = useState("");
  const [look, setLook] = useState<MoveInLookShape | null>(null);
  const [left, setLeft] = useState<string[]>([]);
  const [started, setStarted] = useState<MoveInStartShape | null>(null);
  const [pending, start] = useTransition();

  if (domains.length === 0) {
    return (
      <Card title={words.title} description={words.intro}>
        <p className="text-body text-muted">{words.noneConnected}</p>
      </Card>
    );
  }

  const copy = (pointHere: boolean) =>
    start(async () => {
      if (!look?.ok) return;
      setStarted(await actions.start(domain, zoneText, look.found.filter((r) => !left.includes(r.key)).map((r) => r.key), pointHere));
    });

  return (
    <Card title={words.title} description={words.intro}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {words.domain}
          <select
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setLook(null);
              setStarted(null);
            }}
            className={input}
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <details className="rounded-panel border border-line p-4">
          <summary className="cursor-pointer text-body">{words.zoneFile}</summary>
          <p className="mt-2 text-caption text-muted">{words.zoneFileHint}</p>
          <textarea
            rows={8}
            value={zoneText}
            onChange={(e) => {
              setZoneText(e.target.value);
              setLook(null);
            }}
            className={`${input} mt-2 py-2 font-mono`}
            spellCheck={false}
          />
        </details>
        <div>
          <Button kind="strong" disabled={pending || !domain} onClick={() => start(async () => setLook(await actions.look(domain, zoneText)))}>
            {words.look}
          </Button>
        </div>
        {look && !look.ok && <Said said={{ ok: false, messages: look.problems }} />}
        {look?.ok && !started?.ok && (
          <div className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4">
            <p className="text-body text-ink">{words.found}</p>
            <ul className="flex flex-col gap-1">
              {look.found.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!left.includes(r.key)}
                    onChange={(e) => setLeft(e.target.checked ? left.filter((k) => k !== r.key) : [...left, r.key])}
                    aria-label={r.line}
                  />
                  <span className="break-all font-mono text-caption text-ink-2">{r.line}</span>
                  <Chip>{r.from === "file" ? words.fromFile : words.fromProbe}</Chip>
                  {r.live === false && <Chip signal="warning">{words.notLive}</Chip>}
                </li>
              ))}
            </ul>
            {look.kept.length > 0 && (
              <>
                <p className="text-caption text-muted">{words.kept}</p>
                <ul className="font-mono text-caption text-muted">
                  {look.kept.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            {(look.problems.length > 0 || look.skipped.length > 0) && (
              <>
                <p className="text-caption text-muted">{words.problems}</p>
                <ul className="text-caption text-warning-text">
                  {[...look.problems, ...look.skipped].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-caption text-muted">{words.missedNote}</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="main" disabled={pending} onClick={() => copy(false)}>
                {words.start}
              </Button>
            </div>
          </div>
        )}
        {started && !started.ok && <Said said={{ ok: false, messages: started.problems }} />}
        {started?.ok && (
          <div className="flex flex-col gap-2 rounded-panel border border-line bg-sunken p-4" role="status">
            {started.pointed ? (
              <p className="text-body text-positive-text">{words.pointed}</p>
            ) : (
              <>
                <p className="text-body text-ink">
                  {fillWords(words.started, { domain: started.domain, registrar: look?.ok && look.registrar ? fillWords(words.registrarIs, { registrar: look.registrar }) : "" })}
                </p>
                <ul className="select-all font-mono text-body-strong text-ink">
                  {started.nameservers.map((ns) => (
                    <li key={ns}>{ns}</li>
                  ))}
                </ul>
              </>
            )}
            {started.missing.length + started.unanswered.length === 0 ? (
              <p className="text-caption text-positive-text">{words.allAnswered}</p>
            ) : (
              <>
                <p className="text-caption text-warning-text">{words.checkMissing}</p>
                <ul className="font-mono text-caption text-ink-2">
                  {[...started.missing, ...started.unanswered].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            {look?.ok && look.registeredHere && !started.pointed && (
              <div>
                <Button kind="secondary" disabled={pending} onClick={() => copy(true)}>
                  {words.pointHere}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Transfer({
  canBuy,
  closedWhy,
  registrant,
  words,
  getWords,
  locale,
  actions,
}: {
  canBuy: boolean;
  closedWhy: string | null;
  registrant: RegistrantPrefill;
  words: DomainsMessages["moveIn"]["transfer"];
  getWords: DomainsMessages["get"];
  locale: string;
  actions: MoveInActions;
}) {
  const [domain, setDomain] = useState("");
  const [quote, setQuote] = useState<TransferQuoteShape | null>(null);
  const [pending, start] = useTransition();
  const price = quote?.ok ? formatMoney(quote.amountMinor, quote.currency, locale) : "";
  return (
    <Card title={words.title} description={words.intro}>
      {!canBuy ? (
        <p className="text-body text-muted">{closedWhy}</p>
      ) : quote?.ok ? (
        <ActionForm action={actions.transfer} className="flex flex-col gap-4" replaceOnSuccess>
          <input type="hidden" name="domain" value={quote.domain} />
          <input type="hidden" name="agreed" value={`${quote.currency}:${quote.amountMinor}`} />
          <p className="text-body text-ink-2">{fillWords(words.price, { domain: quote.domain, price })}</p>
          <label className="flex flex-col gap-1 text-sm">
            {words.code}
            <input name="authCode" required className={`${input} font-mono`} autoComplete="off" spellCheck={false} maxLength={64} />
            <span className="text-caption text-muted">{words.codeHint}</span>
          </label>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" name="connect" defaultChecked />
            {words.connect}
          </label>
          <RegistrantFields registrant={registrant} words={getWords} />
          <p className="text-caption text-muted">{words.payNote}</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton>{fillWords(words.start, { price })}</SubmitButton>
            <Button kind="secondary" type="button" onClick={() => setQuote(null)}>
              {getWords.back}
            </Button>
          </div>
        </ActionForm>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              {words.domain}
              <input value={domain} onChange={(e) => setDomain(e.target.value)} className={input} autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={253} />
            </label>
            <Button kind="strong" disabled={pending || !domain.trim()} onClick={() => start(async () => setQuote(await actions.quote(domain)))}>
              {words.look}
            </Button>
          </div>
          {quote && !quote.ok && <Said said={{ ok: false, messages: quote.problems }} />}
        </div>
      )}
    </Card>
  );
}
