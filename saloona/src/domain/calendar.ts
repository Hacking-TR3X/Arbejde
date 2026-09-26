/**
 * Day calendar: appointments with a time get an end time from the price list's
 * duration, so overlaps (double bookings) can be spotted.
 */
import { addDays, weekday, type ISODate } from './dates';
import type { Client, Treatment, Visit } from './types';

/** Assumed length of an appointment whose treatment has no duration in the price list. */
export const DEFAULT_DURATION = 30;

export function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes after midnight → "HH:MM", clamped to the same day. */
export function fromMinutes(min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function durationFor(treatmentKey: string, catalog: ReadonlyMap<string, Treatment>): number | null {
  return catalog.get(treatmentKey)?.durationMin ?? null;
}

/** "kl. 14.30–15.15", or "kl. 14.30" without an end. */
export function formatTimeRange(start: string, end: string | null): string {
  const s = start.replace(':', '.');
  return end ? `kl. ${s}–${end.replace(':', '.')}` : `kl. ${s}`;
}

/** The seven days (Monday first) of the week containing `day`. */
export function weekOf(day: ISODate): ISODate[] {
  const monday = addDays(day, -weekday(day));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export interface AgendaItem {
  visit: Visit;
  client: Client | undefined;
  /** "HH:MM" or null. */
  start: string | null;
  end: string | null;
  /** Duration from the price list, or null when unknown (the default is used for overlaps). */
  durationMin: number | null;
  /** Ids of other visits the same day whose time overlaps this one. */
  overlapsWith: string[];
}

interface Span {
  id: string;
  from: number;
  to: number;
}

function span(v: Visit, catalog: ReadonlyMap<string, Treatment>): Span | null {
  if (!v.time) return null;
  const from = toMinutes(v.time);
  return { id: v.id, from, to: from + (durationFor(v.treatmentKey, catalog) ?? DEFAULT_DURATION) };
}

function overlap(a: Span, b: Span): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Everything on one day: timed items by start time, then those without a time. */
export function dayAgenda(
  visits: readonly Visit[],
  clients: ReadonlyMap<string, Client>,
  catalog: ReadonlyMap<string, Treatment>,
  day: ISODate
): { timed: AgendaItem[]; untimed: AgendaItem[] } {
  const onDay = visits.filter((v) => v.date === day && clients.has(v.clientId));
  const spans = new Map<string, Span>();
  for (const v of onDay) {
    const s = span(v, catalog);
    if (s) spans.set(v.id, s);
  }
  const items = onDay.map((visit): AgendaItem => {
    const s = spans.get(visit.id);
    const durationMin = durationFor(visit.treatmentKey, catalog);
    const overlapsWith = s ? [...spans.values()].filter((o) => o.id !== s.id && overlap(s, o)).map((o) => o.id) : [];
    return {
      visit,
      client: clients.get(visit.clientId),
      start: visit.time ?? null,
      end: s && durationMin !== null ? fromMinutes(s.to) : null,
      durationMin,
      overlapsWith
    };
  });
  const byCreated = (a: AgendaItem, b: AgendaItem) => a.visit.createdAt.localeCompare(b.visit.createdAt);
  return {
    timed: items.filter((i) => i.start !== null).sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : byCreated(a, b))),
    untimed: items.filter((i) => i.start === null).sort(byCreated)
  };
}

/** Other visits that day whose time overlaps a candidate appointment (used while booking). */
export function findOverlaps(
  visits: readonly Visit[],
  catalog: ReadonlyMap<string, Treatment>,
  candidate: { id?: string; date: ISODate; time: string; treatmentKey: string }
): Visit[] {
  if (!candidate.time) return [];
  const from = toMinutes(candidate.time);
  const me: Span = { id: candidate.id ?? '', from, to: from + (durationFor(candidate.treatmentKey, catalog) ?? DEFAULT_DURATION) };
  return visits
    .filter((v) => v.date === candidate.date && v.id !== candidate.id)
    .filter((v) => {
      const s = span(v, catalog);
      return s !== null && overlap(me, s);
    })
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
}

/** Number of visits per day, for dots in the week strip. */
export function countByDay(visits: readonly Visit[], days: readonly ISODate[]): Map<ISODate, number> {
  const set = new Set(days);
  const out = new Map<ISODate, number>(days.map((d) => [d, 0]));
  for (const v of visits) if (set.has(v.date)) out.set(v.date, (out.get(v.date) ?? 0) + 1);
  return out;
}

/** ISO 8601 week number (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeek(day: ISODate): number {
  const thursday = addDays(day, 3 - weekday(day));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((toDayNumberSafe(thursday) - toDayNumberSafe(jan1)) / 7) + 1;
}

function toDayNumberSafe(iso: ISODate): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
}
