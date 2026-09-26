/** Suggestions that make entering a visit fast: price, payment method, treatments. */
import type { ISODate } from './dates';
import type { PayMethod, Treatment, Visit } from './types';

/** Newest first: by date, then by when it was entered. */
function newestFirst(a: Visit, b: Visit): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Price suggestion, in order:
 * 1. what this client paid last time for this treatment (personal prices, e.g. a child),
 * 2. the price in the price list (`defaults`; also holds the prototype's `prices`),
 * 3. the latest price anyone paid for this treatment,
 * 4. nothing.
 * Only completed visits with an amount are used.
 */
export function suggestPrice(
  visits: readonly Visit[],
  clientId: string | null,
  treatmentKey: string,
  defaults: ReadonlyMap<string, number>,
  today: ISODate
): number | null {
  if (!treatmentKey) return null;
  const paid = visits
    .filter((v) => v.treatmentKey === treatmentKey && v.amountOre !== null && v.date <= today)
    .sort(newestFirst);
  if (clientId) {
    const own = paid.find((v) => v.clientId === clientId);
    if (own) return own.amountOre;
  }
  const listed = defaults.get(treatmentKey);
  if (listed !== undefined) return listed;
  return paid[0]?.amountOre ?? null;
}

/**
 * The client's most recent payment method, else the most used one overall.
 * With `today`, booked (future) appointments are ignored.
 */
export function suggestPay(visits: readonly Visit[], clientId: string | null, today?: ISODate): PayMethod | null {
  const withPay = visits.filter((v) => v.pay !== null && (today === undefined || v.date <= today)).sort(newestFirst);
  if (clientId) {
    const own = withPay.find((v) => v.clientId === clientId);
    if (own) return own.pay;
  }
  const counts = new Map<PayMethod, number>();
  for (const v of withPay.slice(0, 200)) {
    if (v.pay) counts.set(v.pay, (counts.get(v.pay) ?? 0) + 1);
  }
  let best: PayMethod | null = null;
  let bestCount = 0;
  for (const [pay, n] of counts) {
    if (n > bestCount) {
      best = pay;
      bestCount = n;
    }
  }
  return best;
}

export interface TreatmentOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Treatments sorted by how often they are used (ties: most recent first).
 * When a client is given, that client's own treatments come first. Price-list
 * entries that were never used come last, and the price list's name wins.
 */
export function treatmentOptions(
  visits: readonly Visit[],
  clientId: string | null = null,
  catalog: ReadonlyMap<string, Treatment> = new Map()
): TreatmentOption[] {
  const map = new Map<string, TreatmentOption & { last: string; own: number }>();
  for (const v of visits) {
    let o = map.get(v.treatmentKey);
    if (!o) {
      o = { key: v.treatmentKey, label: v.treatment, count: 0, last: v.date, own: 0 };
      map.set(v.treatmentKey, o);
    }
    o.count += 1;
    if (clientId && v.clientId === clientId) o.own += 1;
    if (v.date >= o.last) {
      o.last = v.date;
      o.label = v.treatment;
    }
  }
  for (const t of catalog.values()) {
    const o = map.get(t.key);
    if (o) o.label = t.label;
    else map.set(t.key, { key: t.key, label: t.label, count: 0, last: '', own: 0 });
  }
  return [...map.values()]
    .sort((a, b) => b.own - a.own || b.count - a.count || b.last.localeCompare(a.last) || a.label.localeCompare(b.label, 'da'))
    .map(({ key, label, count }) => ({ key, label, count }));
}

/** The treatment this client had most recently, used to preselect a chip. */
export function lastTreatmentFor(visits: readonly Visit[], clientId: string, today: ISODate): Visit | null {
  const own = visits.filter((v) => v.clientId === clientId && v.date <= today).sort(newestFirst);
  return own[0] ?? null;
}
