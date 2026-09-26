/**
 * Rhythm: how often a client comes back for a given treatment.
 *
 * - Only completed visits count (date ≤ today). A booked appointment counts
 *   once its day has come.
 * - Each date counts once, even with several visits the same day.
 * - With at least MIN_DATES dates the average interval is
 *   (last − first) / (dates − 1), and the next visit is expected
 *   at last + round(interval).
 * - A client with a booked appointment for the treatment is never "late".
 */
import { diffDays, addDays, type ISODate } from './dates';
import type { Client, Visit } from './types';

export const MIN_DATES = 3;
export const SOON_DAYS = 14;

export type RhythmStatus = 'late' | 'soon' | 'later' | 'booked' | 'collecting';

export interface Rhythm {
  clientId: string;
  treatmentKey: string;
  /** Display label: the spelling used most recently. */
  treatment: string;
  /** Unique completed dates, ascending. */
  dates: ISODate[];
  lastDate: ISODate | null;
  intervalDays: number | null;
  expected: ISODate | null;
  /** expected − today (negative when late). */
  daysUntil: number | null;
  /** Earliest future appointment for the same client and treatment. */
  booked: ISODate | null;
  status: RhythmStatus;
  /** 0–1: how far into the interval we are (for the progress bar). */
  progress: number;
}

interface Group {
  clientId: string;
  treatmentKey: string;
  treatment: string;
  labelDate: ISODate;
  dates: Set<ISODate>;
  booked: ISODate | null;
}

export function computeRhythms(visits: readonly Visit[], today: ISODate): Rhythm[] {
  const groups = new Map<string, Group>();
  for (const v of visits) {
    const key = `${v.clientId}\u0000${v.treatmentKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { clientId: v.clientId, treatmentKey: v.treatmentKey, treatment: v.treatment, labelDate: v.date, dates: new Set(), booked: null };
      groups.set(key, g);
    }
    if (v.date >= g.labelDate) {
      g.labelDate = v.date;
      g.treatment = v.treatment;
    }
    if (v.date <= today) g.dates.add(v.date);
    else if (g.booked === null || v.date < g.booked) g.booked = v.date;
  }

  const out: Rhythm[] = [];
  for (const g of groups.values()) out.push(rhythmFor(g, today));
  return out;
}

function rhythmFor(g: Group, today: ISODate): Rhythm {
  const dates = [...g.dates].sort();
  const first = dates[0] ?? null;
  const last = dates[dates.length - 1] ?? null;
  const base = {
    clientId: g.clientId,
    treatmentKey: g.treatmentKey,
    treatment: g.treatment,
    dates,
    lastDate: last,
    booked: g.booked
  };

  if (dates.length < MIN_DATES || first === null || last === null) {
    return { ...base, intervalDays: null, expected: null, daysUntil: null, status: 'collecting', progress: 0 };
  }

  const avg = diffDays(first, last) / (dates.length - 1);
  const interval = Math.max(1, Math.round(avg));
  const expected = addDays(last, interval);
  const daysUntil = diffDays(today, expected);
  const progress = Math.min(1, Math.max(0, diffDays(last, today) / interval));

  let status: RhythmStatus;
  if (g.booked !== null) status = 'booked';
  else if (daysUntil < 0) status = 'late';
  else if (daysUntil <= SOON_DAYS) status = 'soon';
  else status = 'later';

  return { ...base, intervalDays: interval, expected, daysUntil, status, progress };
}

export interface Appointment {
  visit: Visit;
  client: Client | undefined;
}

export interface DueOverview {
  upcoming: Appointment[];
  late: Rhythm[];
  soon: Rhythm[];
  later: Rhythm[];
  collecting: Rhythm[];
}

/** Groups everything the front page shows. */
export function dueOverview(visits: readonly Visit[], clients: ReadonlyMap<string, Client>, today: ISODate): DueOverview {
  const rhythms = computeRhythms(visits, today).filter((r) => clients.has(r.clientId));
  const byDays = (a: Rhythm, b: Rhythm) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0);
  const upcoming = visits
    .filter((v) => v.date > today)
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date < b.date ? -1 : 1))
    .map((visit) => ({ visit, client: clients.get(visit.clientId) }));
  return {
    upcoming,
    late: rhythms.filter((r) => r.status === 'late').sort(byDays),
    soon: rhythms.filter((r) => r.status === 'soon').sort(byDays),
    later: rhythms.filter((r) => r.status === 'later').sort(byDays),
    collecting: rhythms
      .filter((r) => r.status === 'collecting' && r.dates.length > 0)
      .sort((a, b) => b.dates.length - a.dates.length || (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
  };
}
