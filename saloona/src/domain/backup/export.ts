/**
 * Builds a backup file. The format is a superset of the Salonbog prototype's
 * format, so the known fields stay readable by the prototype.
 */
import { todayISO } from '../dates';
import { kronerFromOre } from '../money';
import type { Client, Gender, PayMethod, Treatment, Visit } from '../types';

export const BACKUP_VERSION = 2;

export interface BackupClient {
  id: string;
  name: string;
  gender?: Gender;
  note: string;
  tag?: string;
  phone?: string;
}

export interface BackupVisit {
  id: string;
  clientId: string;
  /** "HH:MM", only when set. */
  time?: string;
  treatment: string;
  date: string;
  note: string;
  amount?: number;
  pay?: PayMethod;
}

export interface BackupTreatment {
  name: string;
  /** Kroner. */
  price?: number;
  /** Minutes. */
  duration?: number;
}

export interface BackupFile {
  app: 'saloona';
  version: number;
  exported: string;
  clients: BackupClient[];
  visits: BackupVisit[];
  prices: Record<string, number>;
  treatments: BackupTreatment[];
}

export function buildBackup(
  clients: readonly Client[],
  visits: readonly Visit[],
  defaults: ReadonlyMap<string, number>,
  now: Date,
  catalog: ReadonlyMap<string, Treatment> = new Map()
): BackupFile {
  // `prices` = latest paid amount per treatment, falling back to stored defaults.
  const today = todayISO(now);
  const latest = new Map<string, { date: string; ore: number }>();
  for (const v of visits) {
    if (v.amountOre === null || v.date > today) continue;
    const cur = latest.get(v.treatmentKey);
    if (!cur || v.date >= cur.date) latest.set(v.treatmentKey, { date: v.date, ore: v.amountOre });
  }
  const prices: Record<string, number> = Object.create(null) as Record<string, number>;
  // The prototype reads `prices` as "the price to suggest": price list first,
  // otherwise the latest amount paid.
  for (const [k, { ore }] of latest) prices[k] = kronerFromOre(ore);
  for (const [k, ore] of defaults) prices[k] = kronerFromOre(ore);

  return {
    app: 'saloona',
    version: BACKUP_VERSION,
    exported: now.toISOString(),
    clients: clients.map((c) => {
      const out: BackupClient = { id: c.id, name: c.name, note: c.note };
      if (c.gender) out.gender = c.gender;
      if (c.tag) out.tag = c.tag;
      if (c.phone) out.phone = c.phone;
      return out;
    }),
    visits: visits.map((v) => {
      const out: BackupVisit = { id: v.id, clientId: v.clientId, treatment: v.treatment, date: v.date, note: v.note };
      if (v.amountOre !== null) out.amount = kronerFromOre(v.amountOre);
      if (v.pay) out.pay = v.pay;
      if (v.time) out.time = v.time;
      return out;
    }),
    prices: { ...prices },
    treatments: [...catalog.values()].map((t) => {
      const out: BackupTreatment = { name: t.label };
      if (t.priceOre !== null) out.price = kronerFromOre(t.priceOre);
      if (t.durationMin !== null) out.duration = t.durationMin;
      return out;
    })
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 1);
}

export function backupFileName(today: string, encrypted: boolean): string {
  return `saloona-backup-${today}${encrypted ? '-beskyttet' : ''}.json`;
}
