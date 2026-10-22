"use client";

import { useId, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import {
  DAYS,
  defaultHours,
  MAX_EXCEPTIONS,
  type DayHours,
  type HoursException,
  type OpeningHours,
  type WeekHours,
} from "@/lib/opening-hours";

import { useAdminText } from "./admin-text";

const control = "min-h-10 rounded-md border border-line bg-card px-2 text-sm";
const small = "min-h-10 rounded-pill border border-edge px-3 text-sm hover:bg-sunken";
const OPEN: NonNullable<DayHours> = { open: "09:00", close: "17:00" };

/**
 * Opening hours (D40): the usual week, and exceptions to it, seasons with
 * their own week and single dates, closed or with their own hours. The
 * form gets them as JSON in one field; with `optional`, the place can show
 * no hours at all.
 */
export function HoursEditor({
  name,
  initial,
  optional = false,
}: {
  name: string;
  initial: OpeningHours | null;
  optional?: boolean;
}) {
  const w = useAdminText("settings").hours;
  const [hours, setHours] = useState<OpeningHours>(initial ?? defaultHours());
  const [shown, setShown] = useState(!optional || initial !== null);
  const id = useId();

  const setException = (index: number, change: HoursException) =>
    setHours((h) => ({ ...h, exceptions: h.exceptions.map((e, i) => (i === index ? change : e)) }));
  const removeException = (index: number) =>
    setHours((h) => ({ ...h, exceptions: h.exceptions.filter((_, i) => i !== index) }));
  const add = (exception: HoursException) => setHours((h) => ({ ...h, exceptions: [...h.exceptions, exception] }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name={name} value={shown ? JSON.stringify(hours) : ""} />
      {optional && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} className="size-4" />
          {w.show}
        </label>
      )}
      {shown && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{w.week}</legend>
            <WeekGrid week={hours.week} onChange={(week) => setHours((h) => ({ ...h, week }))} idPrefix={`${id}-week`} />
          </fieldset>

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-body-strong text-ink">{w.other}</h3>
              <p className="text-xs text-muted">{w.otherText}</p>
            </div>
            {hours.exceptions.map((exception, index) => (
              <ExceptionEditor
                key={index}
                exception={exception}
                idPrefix={`${id}-x${index}`}
                onChange={(change) => setException(index, change)}
                onRemove={() => removeException(index)}
              />
            ))}
            {hours.exceptions.length < MAX_EXCEPTIONS && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={small}
                  onClick={() => add({ kind: "season", label: "", from: today, to: today, week: { ...hours.week } })}
                >
                  {w.addSeason}
                </button>
                <button type="button" className={small} onClick={() => add({ kind: "date", label: "", date: today, hours: null })}>
                  {w.addDate}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExceptionEditor({
  exception,
  idPrefix,
  onChange,
  onRemove,
}: {
  exception: HoursException;
  idPrefix: string;
  onChange: (change: HoursException) => void;
  onRemove: () => void;
}) {
  const w = useAdminText("settings").hours;
  const what = exception.kind === "season" ? "season" : "date";
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
      <legend className="px-1 text-eyebrow text-muted uppercase">
        {exception.kind === "season" ? w.season : w.singleDate}
      </legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          {w.name} <span className="sr-only">{w.nameOf[what]}</span>
          <input
            value={exception.label}
            maxLength={60}
            placeholder={exception.kind === "season" ? w.seasonPlaceholder : w.datePlaceholder}
            onChange={(e) => onChange({ ...exception, label: e.target.value })}
            className={control}
          />
        </label>
        {exception.kind === "season" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              {w.from}
              <input type="date" required value={exception.from} onChange={(e) => onChange({ ...exception, from: e.target.value })} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {w.to}
              <input type="date" required value={exception.to} min={exception.from} onChange={(e) => onChange({ ...exception, to: e.target.value })} className={control} />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            {w.date}
            <input type="date" required value={exception.date} onChange={(e) => onChange({ ...exception, date: e.target.value })} className={control} />
          </label>
        )}
        <button type="button" onClick={onRemove} className="min-h-10 px-2 text-sm underline">
          {w.remove} <span className="sr-only">{w.removeWhat[what]}</span>
        </button>
      </div>
      {exception.kind === "season" ? (
        <WeekGrid week={exception.week} onChange={(week) => onChange({ ...exception, week })} idPrefix={idPrefix} />
      ) : (
        <DayRow
          label={w.thatDay}
          hours={exception.hours}
          onChange={(hours) => onChange({ ...exception, hours })}
          idPrefix={idPrefix}
        />
      )}
    </fieldset>
  );
}

function WeekGrid({ week, onChange, idPrefix }: { week: WeekHours; onChange: (week: WeekHours) => void; idPrefix: string }) {
  const w = useAdminText("settings").hours;
  return (
    <div className="flex flex-col gap-1">
      {DAYS.map((day) => (
        <DayRow
          key={day}
          label={w.days[day]}
          hours={week[day]}
          onChange={(hours) => onChange({ ...week, [day]: hours })}
          idPrefix={`${idPrefix}-${day}`}
        />
      ))}
      <div>
        <button
          type="button"
          className="min-h-10 text-sm underline"
          onClick={() => onChange({ ...week, tue: week.mon, wed: week.mon, thu: week.mon, fri: week.mon })}
        >
          {w.sameWeekdays}
        </button>
      </div>
    </div>
  );
}

function DayRow({
  label,
  hours,
  onChange,
  idPrefix,
}: {
  label: string;
  hours: DayHours;
  onChange: (hours: DayHours) => void;
  idPrefix: string;
}) {
  const w = useAdminText("settings").hours;
  const open = hours !== null;
  const backwards = hours !== null && hours.open >= hours.close;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex w-36 items-center gap-2 text-sm">
        <input type="checkbox" checked={open} onChange={(e) => onChange(e.target.checked ? OPEN : null)} className="size-4" />
        {label}
      </label>
      {open ? (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={`${idPrefix}-open`} className="sr-only">
            {fillWords(w.opens, { day: label })}
          </label>
          <input
            id={`${idPrefix}-open`}
            type="time"
            step={900}
            required
            value={hours.open}
            onChange={(e) => onChange({ ...hours, open: e.target.value })}
            className={control}
          />
          <span aria-hidden="true">–</span>
          <label htmlFor={`${idPrefix}-close`} className="sr-only">
            {fillWords(w.closes, { day: label })}
          </label>
          <input
            id={`${idPrefix}-close`}
            type="time"
            step={900}
            required
            value={hours.close}
            aria-invalid={backwards || undefined}
            onChange={(e) => onChange({ ...hours, close: e.target.value })}
            className={control}
          />
          {backwards && <span className="text-xs text-danger-text">{w.backwards}</span>}
        </div>
      ) : (
        <span className="text-sm text-muted">{w.closed}</span>
      )}
    </div>
  );
}
