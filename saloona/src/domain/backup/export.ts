/**
 * Builds a backup file. The format is a superset of the Salonbog prototype's
 * format, so the known fields stay readable by the prototype.
 */
import { kronerFromOre } from '../money';
import type { Client, Gender, PayMethod, Visit } from '../types';

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
  treatment: string;
  date: string;
  note: string;
  amount?: number;
  pay?: PayMethod;
}

export interface BackupFile {
  app: 'saloona';
  version: number;
  exported: string;
  clients: BackupClient[];
  visits: BackupVisit[];
  prices: Record<string, number>;
}

export function buildBackup(
  clients: readonly Client[],
  visits: readonly Visit[],
  defaults: ReadonlyMap<string, number>,
  now: Date
): BackupFile {
  // `prices` = latest paid amount per treatment, falling back to stored defaults.
  const latest = new Map<string, { date: string; ore: number }>();
  for (const v of visits) {
    if (v.amountOre === null) continue;
    const cur = latest.get(v.treatmentKey);
    if (!cur || v.date >= cur.date) latest.set(v.treatmentKey, { date: v.date, ore: v.amountOre });
  }
  const prices: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [k, ore] of defaults) prices[k] = kronerFromOre(ore);
  for (const [k, { ore }] of latest) prices[k] = kronerFromOre(ore);

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
      return out;
    }),
    prices: { ...prices }
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 1);
}

export function backupFileName(today: string, encrypted: boolean): string {
  return `saloona-backup-${today}${encrypted ? '-beskyttet' : ''}.json`;
}
