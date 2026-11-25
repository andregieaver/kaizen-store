import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { Card, Chip, EmptyState, Field, List, ListRow, PageHeader, RowActions, RowLead, Select, TextInput } from "@/components/admin/ui";
import { TextArea } from "@/components/admin/ui/field";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { AUTOPILOT_GAPS, incidentGroup } from "@/lib/incidents";
import { requirePlatformReader } from "@/server/auth";
import { autopilotSettings, incidentBoard, type IncidentEntry } from "@/server/incidents";

import { incidentAction } from "./actions";

export const metadata: Metadata = { title: "Incidents" };

type W = PlatformMessages["incidents"];

/**
 * The incident log (D895): for Homer, what needs the owner (Approve or Dismiss a proposal, a hand-over to read), what is being fixed and what
 * was fixed lately; an idea to add. For Lisa, one step away: each entry's page, and the autopilot's switch and gap under Autopilot.
 */
export default async function PlatformIncidentsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = PLATFORM_WORDS[lang].incidents;
  const [board, settings] = await Promise.all([incidentBoard(), autopilotSettings()]);
  const needsYou = board.filter((e) => incidentGroup(e.status) === "needs_you");
  const working = board.filter((e) => incidentGroup(e.status) === "being_fixed" || incidentGroup(e.status) === "waiting");
  const fixed = board.filter((e) => incidentGroup(e.status) === "fixed");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{w.phone.lead}</span>
            <span className="max-sm:hidden">{w.description}</span>
          </>
        }
      />
      <Card title={w.needsYou} count={needsYou.length}>
        {needsYou.length === 0 ? (
          <EmptyState compact title={w.needsYouNone} />
        ) : (
          <List label={w.needsYou}>
            {needsYou.map((entry) => (
              <ListRow key={entry.id}>
                <EntryLead entry={entry} w={w} lang={lang} />
                <RowActions>
                  {entry.status === "proposed" ? (
                    <ActionForm action={incidentAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <SubmitButton name="intent" value="approve">
                        {w.approve}
                      </SubmitButton>
                      <SubmitButton name="intent" value="dismiss" variant="secondary">
                        {w.dismiss}
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <ActionForm action={incidentAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <SubmitButton name="intent" value="send_back" variant="secondary">
                        {w.sendBack}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </RowActions>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      <Card title={w.beingFixed} count={working.length}>
        {working.length === 0 ? (
          <EmptyState compact title={w.beingFixedNone} />
        ) : (
          <List label={w.beingFixed}>
            {working.map((entry) => (
              <ListRow key={entry.id}>
                <EntryLead entry={entry} w={w} lang={lang} />
                <Chip signal={entry.status === "claimed" ? "positive" : "neutral"}>{entry.status === "claimed" ? w.statuses.claimed : w.waiting}</Chip>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      <Card title={w.fixed} count={fixed.length}>
        {fixed.length === 0 ? (
          <EmptyState compact title={w.fixedNone} />
        ) : (
          <List label={w.fixed}>
            {fixed.map((entry) => (
              <ListRow key={entry.id}>
                <EntryLead entry={entry} w={w} lang={lang} note={entry.fixNote} />
                <Chip signal={entry.status === "done" ? "positive" : "neutral"}>{w.statuses[entry.status]}</Chip>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      {/* Lisa's step: an idea and the autopilot's settings, each a row that opens on a phone. */}
      <PhoneRows>
        <PhoneRow flat title={w.idea.title} sub={w.idea.sub} change={w.phone.open} done={w.phone.close}>
          <Card title={w.idea.title} description={w.idea.sub}>
            <ActionForm action={incidentAction} className="flex flex-col gap-3" replaceOnSuccess>
              <Field label={w.idea.field} required>
                {(control) => <TextInput {...control} name="title" maxLength={200} full />}
              </Field>
              <Field label={w.idea.note}>
                {(control) => <TextArea {...control} name="note" maxLength={2000} rows={3} full />}
              </Field>
              <div>
                <SubmitButton name="intent" value="idea">
                  {w.idea.save}
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </PhoneRow>
        <PhoneRow flat last title={w.autopilot.title} sub={settings.on ? w.autopilot.on : w.autopilot.off} change={w.phone.open} done={w.phone.close}>
          <Card title={w.autopilot.title} description={settings.on ? w.autopilot.on : w.autopilot.off}>
            <ActionForm action={incidentAction} className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="on" defaultChecked={settings.on} />
                {w.autopilot.turnOn}
              </label>
              <Field label={w.autopilot.gap}>
                {(control) => (
                  <Select {...control} name="gap" defaultValue={String(settings.gapHours)}>
                    {AUTOPILOT_GAPS.map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? w.autopilot.gapHour : fillWords(w.autopilot.gapHours, { n })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <p className="text-sm text-muted">{w.autopilot.nightly}</p>
              <p className="text-sm text-muted">{w.autopilot.setup}</p>
              <div>
                <SubmitButton name="intent" value="settings" variant="secondary">
                  {w.autopilot.save}
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </PhoneRow>
      </PhoneRows>
    </div>
  );
}

/** An entry's title (a link to its page) and one line: what it is, where it came from and when it was seen. */
function EntryLead({ entry, w, lang, note }: { entry: IncidentEntry; w: W; lang: AdminLang; note?: string | null }) {
  const at = adminDate(PLATFORM_TIME_ZONE, entry.lastSeenAt, "dayTime", lang);
  const seen = entry.occurrences > 1 ? fillWords(w.seen, { n: entry.occurrences, at }) : fillWords(w.seenOnce, { at });
  const sub = [w.kinds[entry.kind], w.sources[entry.source as keyof W["sources"]] ?? entry.source, seen].join(" · ");
  const told = note ?? (entry.status === "needs_owner" ? entry.fixNote : null);
  return (
    <RowLead
      title={entry.title}
      href={`/admin/platform/incidents/${entry.id}`}
      sub={
        <>
          {sub}
          {told && <span className="block text-ink-2">{told}</span>}
        </>
      }
    />
  );
}
