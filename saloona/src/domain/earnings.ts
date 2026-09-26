/** Earnings for a period. Only completed visits (date ≤ today) count. */
import {
  addMonthsToKey,
  firstOfMonth,
  lastOfMonth,
  monthKey,
  monthNameLong,
  monthNameShort,
  type ISODate,
  type MonthKey
} from './dates';
import type { Client, PayMethod, Visit } from './types';

export type PeriodId = 'month' | 'lastMonth' | 'year' | 'all';

export const PERIODS: readonly { id: PeriodId; label: string }[] = [
  { id: 'month', label: 'Denne måned' },
  { id: 'lastMonth', label: 'Sidste måned' },
  { id: 'year', label: 'I år' },
  { id: 'all', label: 'Alt' }
];

export interface Range {
  from: ISODate | null;
  /** Inclusive upper bound, never after today. */
  to: ISODate;
}

export function periodRange(period: PeriodId, today: ISODate): Range {
  const thisMonth = monthKey(today);
  switch (period) {
    case 'month':
      return { from: firstOfMonth(thisMonth), to: today };
    case 'lastMonth': {
      const prev = addMonthsToKey(thisMonth, -1);
      return { from: firstOfMonth(prev), to: lastOfMonth(prev) };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'all':
      return { from: null, to: today };
  }
}

/** Heading for a period, e.g. "September 2026", "August 2026", "2026", "Alle besøg". */
export function periodTitle(period: PeriodId, today: ISODate): string {
  const r = periodRange(period, today);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (period === 'month' || period === 'lastMonth') {
    const from = r.from ?? today;
    return `${cap(monthNameLong(Number(from.slice(5, 7))))} ${from.slice(0, 4)}`;
  }
  if (period === 'year') return today.slice(0, 4);
  return 'Alle besøg';
}

export interface Slice {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface MonthBar {
  key: MonthKey;
  label: string;
  total: number;
  current: boolean;
}

export interface Earnings {
  total: number;
  /** Completed visits in the period. */
  count: number;
  /** Visits in the period with an amount. */
  paidCount: number;
  average: number | null;
  missing: Visit[];
  byPay: Slice[];
  byTreatment: Slice[];
  topClients: Slice[];
}

const PAY_ORDER: readonly (PayMethod | 'none')[] = ['kontant', 'mp_mig', 'mp_noah', 'none'];

export function computeEarnings(
  visits: readonly Visit[],
  clients: ReadonlyMap<string, Client>,
  period: PeriodId,
  today: ISODate
): Earnings {
  const { from, to } = periodRange(period, today);
  const inRange = visits.filter((v) => v.date <= to && (from === null || v.date >= from));

  let total = 0;
  let paidCount = 0;
  const missing: Visit[] = [];
  const pay = new Map<string, Slice>();
  const treat = new Map<string, Slice>();
  const cli = new Map<string, Slice>();

  const add = (map: Map<string, Slice>, key: string, label: string, amount: number) => {
    const s = map.get(key) ?? { key, label, total: 0, count: 0 };
    s.total += amount;
    s.count += 1;
    map.set(key, s);
  };

  for (const v of inRange) {
    if (v.amountOre === null) {
      missing.push(v);
      continue;
    }
    total += v.amountOre;
    paidCount += 1;
    add(pay, v.pay ?? 'none', v.pay ?? 'none', v.amountOre);
    add(treat, v.treatmentKey, v.treatment, v.amountOre);
    add(cli, v.clientId, clients.get(v.clientId)?.name ?? 'Slettet kunde', v.amountOre);
  }

  const byTotal = (a: Slice, b: Slice) => b.total - a.total || b.count - a.count;
  missing.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    total,
    count: inRange.length,
    paidCount,
    average: paidCount ? Math.round(total / paidCount) : null,
    missing,
    byPay: PAY_ORDER.map((k) => pay.get(k)).filter((s): s is Slice => !!s && s.total > 0),
    byTreatment: [...treat.values()].sort(byTotal),
    topClients: [...cli.values()].sort(byTotal).slice(0, 5)
  };
}

/** Totals for the last `n` months ending with the current month. */
export function monthBars(visits: readonly Visit[], today: ISODate, n = 6): MonthBar[] {
  const current = monthKey(today);
  const keys: MonthKey[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addMonthsToKey(current, -i));
  const totals = new Map<MonthKey, number>(keys.map((k) => [k, 0]));
  for (const v of visits) {
    if (v.amountOre === null || v.date > today) continue;
    const k = monthKey(v.date);
    const t = totals.get(k);
    if (t !== undefined) totals.set(k, t + v.amountOre);
  }
  return keys.map((key) => ({
    key,
    label: monthNameShort(Number(key.slice(5, 7))).replace('.', ''),
    total: totals.get(key) ?? 0,
    current: key === current
  }));
}
