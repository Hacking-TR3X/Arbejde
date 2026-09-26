/**
 * Repository: the only place that knows SQL. Every statement is parameterised.
 */
import type { ImportPlan } from '../domain/backup/merge';
import { genderFromName } from '../domain/gender';
import { LIMITS, capitalizeFirst, truncate } from '../domain/text';
import { isGender, isPayMethod, type Client, type Gender, type Treatment, type Visit } from '../domain/types';
import type { Db, Row, Statement } from './db';

export interface Settings {
  lastBackupAt: string | null;
  lockEnabled: boolean;
  /** Seconds in the background before the app locks again. */
  lockAfterSeconds: number;
  remindersEnabled: boolean;
  theme: 'system' | 'light' | 'dark';
  onboarded: boolean;
  /** Clients already in the app when genders came in (version with migration 004) have been filled in once. */
  gendersFilled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lastBackupAt: null,
  lockEnabled: false,
  lockAfterSeconds: 60,
  remindersEnabled: false,
  theme: 'system',
  onboarded: false,
  gendersFilled: false
};

export interface Snapshot {
  clients: Client[];
  visits: Visit[];
  /** Price list, by treatment key. */
  treatments: Map<string, Treatment>;
  /** Standard prices from the price list (key → øre), for price suggestions. */
  prices: Map<string, number>;
  settings: Settings;
}

const str = (v: Row[string] | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const strOrNull = (v: Row[string] | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: Row[string] | undefined): number | null => (typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v));

function toClient(r: Row): Client {
  return {
    id: str(r.id),
    name: str(r.name),
    gender: isGender(r.gender) ? r.gender : null,
    tag: strOrNull(r.tag),
    phone: strOrNull(r.phone),
    note: str(r.note),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at)
  };
}

function toVisit(r: Row): Visit {
  return {
    id: str(r.id),
    clientId: str(r.client_id),
    treatment: str(r.treatment),
    treatmentKey: str(r.treatment_key),
    date: str(r.date),
    time: strOrNull(r.time),
    amountOre: numOrNull(r.amount_ore),
    pay: isPayMethod(r.pay) ? r.pay : null,
    note: str(r.note),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at)
  };
}

const INSERT_CLIENT =
  'INSERT INTO clients (id, name, gender, tag, phone, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const INSERT_VISIT =
  'INSERT INTO visits (id, client_id, treatment, treatment_key, date, time, amount_ore, pay, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

function insertClient(c: Client): Statement {
  return { sql: INSERT_CLIENT, params: [c.id, c.name, c.gender, c.tag, c.phone, c.note, c.createdAt, c.updatedAt] };
}

function insertVisit(v: Visit): Statement {
  return {
    sql: INSERT_VISIT,
    params: [v.id, v.clientId, v.treatment, v.treatmentKey, v.date, v.time ?? null, v.amountOre, v.pay, v.note, v.createdAt, v.updatedAt]
  };
}

function toTreatment(r: Row): Treatment {
  return {
    key: str(r.key),
    label: str(r.label),
    priceOre: numOrNull(r.price_ore),
    durationMin: numOrNull(r.duration_min),
    gender: isGender(r.gender) ? r.gender : null,
    updatedAt: str(r.updated_at)
  };
}

function upsertTreatment(t: Treatment): Statement {
  return {
    sql: 'INSERT INTO treatments (key, label, price_ore, duration_min, gender, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label, price_ore = excluded.price_ore, duration_min = excluded.duration_min, gender = excluded.gender, updated_at = excluded.updated_at',
    params: [t.key, t.label, t.priceOre, t.durationMin, t.gender, t.updatedAt]
  };
}

function updateClient(c: Client): Statement {
  return {
    sql: 'UPDATE clients SET name = ?, gender = ?, tag = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?',
    params: [c.name, c.gender, c.tag, c.phone, c.note, c.updatedAt, c.id]
  };
}

export class Repo {
  constructor(private readonly db: Db) {}

  async load(): Promise<Snapshot> {
    const [clients, visits, prices, settings] = await Promise.all([
      this.db.query('SELECT * FROM clients'),
      this.db.query("SELECT * FROM visits ORDER BY date DESC, COALESCE(time, '') DESC, created_at DESC"),
      this.db.query('SELECT key, label, price_ore, duration_min, gender, updated_at FROM treatments'),
      this.db.query('SELECT key, value FROM settings')
    ]);
    return {
      clients: clients.map(toClient),
      visits: visits.map(toVisit),
      treatments: new Map(prices.map((r) => [str(r.key), toTreatment(r)])),
      prices: new Map(prices.filter((r) => typeof r.price_ore === 'number').map((r) => [str(r.key), Number(r.price_ore)])),
      settings: parseSettings(settings)
    };
  }

  // ---------- clients ----------

  addClient(c: Client): Promise<void> {
    return this.db.batch([insertClient(c)]);
  }

  saveClient(c: Client): Promise<void> {
    return this.db.batch([updateClient(c)]);
  }

  /** Deletes the client and (by cascade, and explicitly) all of the client's visits. */
  deleteClient(id: string): Promise<void> {
    return this.db.batch([
      { sql: 'DELETE FROM visits WHERE client_id = ?', params: [id] },
      { sql: 'DELETE FROM clients WHERE id = ?', params: [id] }
    ]);
  }

  /** Undo for deleteClient. */
  restoreClient(c: Client, visits: readonly Visit[]): Promise<void> {
    return this.db.batch([insertClient(c), ...visits.map(insertVisit)]);
  }

  // ---------- visits ----------

  /** Adds a visit, optionally creating its (new) client in the same transaction. */
  addVisit(v: Visit, newClient?: Client): Promise<void> {
    return this.db.batch([...(newClient ? [insertClient(newClient)] : []), insertVisit(v)]);
  }

  saveVisit(v: Visit, newClient?: Client): Promise<void> {
    return this.db.batch([
      ...(newClient ? [insertClient(newClient)] : []),
      {
        sql: 'UPDATE visits SET client_id = ?, treatment = ?, treatment_key = ?, date = ?, time = ?, amount_ore = ?, pay = ?, note = ?, updated_at = ? WHERE id = ?',
        params: [v.clientId, v.treatment, v.treatmentKey, v.date, v.time ?? null, v.amountOre, v.pay, v.note, v.updatedAt, v.id]
      }
    ]);
  }

  deleteVisit(id: string): Promise<void> {
    return this.db.batch([{ sql: 'DELETE FROM visits WHERE id = ?', params: [id] }]);
  }

  restoreVisit(v: Visit): Promise<void> {
    return this.db.batch([insertVisit(v)]);
  }

  // ---------- price list ----------

  saveTreatment(t: Treatment, replacesKey?: string): Promise<void> {
    return this.db.batch([
      ...(replacesKey && replacesKey !== t.key ? [{ sql: 'DELETE FROM treatments WHERE key = ?', params: [replacesKey] }] : []),
      upsertTreatment(t)
    ]);
  }

  /** Sets the gender of clients that have none (read from their treatments). */
  fillClientGenders(list: readonly { id: string; gender: Gender }[], now: string): Promise<void> {
    return this.db.batch(
      list.map((x) => ({ sql: 'UPDATE clients SET gender = ?, updated_at = ? WHERE id = ? AND gender IS NULL', params: [x.gender, now, x.id] }))
    );
  }

  /** Undoes fillClientGenders, for clients that still have the gender it set. */
  unfillClientGenders(list: readonly { id: string; gender: Gender }[], now: string): Promise<void> {
    return this.db.batch(
      list.map((x) => ({ sql: 'UPDATE clients SET gender = NULL, updated_at = ? WHERE id = ? AND gender = ?', params: [now, x.id, x.gender] }))
    );
  }

  deleteTreatment(key: string): Promise<void> {
    return this.db.batch([{ sql: 'DELETE FROM treatments WHERE key = ?', params: [key] }]);
  }

  // ---------- settings ----------

  saveSettings(patch: Partial<Settings>): Promise<void> {
    const statements: Statement[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      statements.push({
        sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        params: [key, JSON.stringify(value)]
      });
    }
    return this.db.batch(statements);
  }

  // ---------- import / wipe ----------

  applyImport(plan: ImportPlan): Promise<void> {
    const statements: Statement[] = [];
    if (plan.mode === 'replace') {
      statements.push(
        { sql: 'DELETE FROM visits' },
        { sql: 'DELETE FROM clients' },
        { sql: 'DELETE FROM treatments' }
      );
    }
    statements.push(...plan.insertClients.map(insertClient));
    statements.push(...plan.updateClients.map(updateClient));
    statements.push(...plan.insertVisits.map(insertVisit));
    const now = new Date().toISOString();
    for (const [key, ore] of plan.prices) {
      // Prototype prices: add the treatment to the price list, or fill in a missing price.
      const label = truncate(capitalizeFirst(key), LIMITS.treatment);
      statements.push({
        sql: 'INSERT INTO treatments (key, label, price_ore, duration_min, gender, updated_at) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT(key) DO UPDATE SET price_ore = COALESCE(treatments.price_ore, excluded.price_ore)',
        params: [key, label, ore, genderFromName(label), now]
      });
    }
    statements.push(...plan.treatments.map(upsertTreatment));
    return this.db.batch(statements);
  }

  /** Removes all rows (used by the web preview; on Android the file itself is deleted). */
  wipe(): Promise<void> {
    return this.db.batch([
      { sql: 'DELETE FROM visits' },
      { sql: 'DELETE FROM clients' },
      { sql: 'DELETE FROM treatments' },
      { sql: 'DELETE FROM settings' }
    ]);
  }
}

function parseSettings(rows: Row[]): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const key = str(r.key);
    let value: unknown;
    try {
      value = JSON.parse(str(r.value));
    } catch {
      continue;
    }
    switch (key) {
      case 'lastBackupAt':
        s.lastBackupAt = typeof value === 'string' ? value : null;
        break;
      case 'lockEnabled':
        s.lockEnabled = value === true;
        break;
      case 'lockAfterSeconds':
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3600) s.lockAfterSeconds = value;
        break;
      case 'remindersEnabled':
        s.remindersEnabled = value === true;
        break;
      case 'theme':
        if (value === 'system' || value === 'light' || value === 'dark') s.theme = value;
        break;
      case 'onboarded':
        s.onboarded = value === true;
        break;
      case 'gendersFilled':
        s.gendersFilled = value === true;
        break;
    }
  }
  return s;
}
