import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { planImport } from '../domain/backup/merge';
import { readBackupText } from '../domain/backup/validate';
import type { Client, Visit } from '../domain/types';
import { LATEST_VERSION, currentVersion, migrate } from './migrations';
import { Repo } from './repo';
import { createSqlJsDb, type SqlJsDb } from './sqljs';

const NOW = '2026-09-26T10:00:00.000Z';

function client(id: string, name: string): Client {
  return { id, name, gender: 'dame', tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
}

function visit(id: string, clientId: string, date: string, amountOre: number | null = 45000): Visit {
  return {
    id,
    clientId,
    treatment: 'Klip',
    treatmentKey: 'klip',
    date,
    amountOre,
    pay: 'kontant',
    note: '',
    createdAt: NOW,
    updatedAt: NOW
  };
}

let db: SqlJsDb;
let repo: Repo;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = createSqlJsDb(SQL);
  await migrate(db, () => NOW);
  repo = new Repo(db);
});

describe('migrations', () => {
  it('migrates an empty database to the latest version and is idempotent', async () => {
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    expect(await migrate(db)).toBe(LATEST_VERSION);
  });

  it('refuses a database from a newer app version', async () => {
    await db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [999, 'future', NOW]);
    await expect(migrate(db)).rejects.toThrow(/nyere version/);
  });
});

describe('repo', () => {
  it('round-trips clients, visits and settings', async () => {
    await repo.addClient(client('c1', 'Maria'));
    await repo.addVisit(visit('v1', 'c1', '2026-09-01'));
    await repo.saveSettings({ lockEnabled: true, theme: 'dark' });
    const s = await repo.load();
    expect(s.clients).toHaveLength(1);
    expect(s.visits[0]).toMatchObject({ id: 'v1', amountOre: 45000, pay: 'kontant' });
    expect(s.settings).toMatchObject({ lockEnabled: true, theme: 'dark', onboarded: false });
  });

  it('creates a new client and its visit atomically', async () => {
    await repo.addVisit(visit('v1', 'c9', '2026-09-01'), client('c9', 'Ny'));
    expect((await repo.load()).clients.map((c) => c.id)).toEqual(['c9']);
    // Failing visit (duplicate id) must not leave the client behind
    await expect(repo.addVisit(visit('v1', 'c10', '2026-09-02'), client('c10', 'Anden'))).rejects.toThrow();
    expect((await repo.load()).clients.map((c) => c.id)).toEqual(['c9']);
  });

  it('deleting a client removes all visits and can be undone', async () => {
    await repo.addClient(client('c1', 'Maria'));
    await repo.addVisit(visit('v1', 'c1', '2026-09-01'));
    await repo.addVisit(visit('v2', 'c1', '2026-09-10'));
    const before = await repo.load();
    await repo.deleteClient('c1');
    const after = await repo.load();
    expect(after.clients).toHaveLength(0);
    expect(after.visits).toHaveLength(0);
    await repo.restoreClient(before.clients[0]!, before.visits);
    expect((await repo.load()).visits).toHaveLength(2);
  });

  it('rejects invalid rows at the database level', async () => {
    await repo.addClient(client('c1', 'Maria'));
    await expect(repo.addVisit({ ...visit('v1', 'c1', '2026-09-01'), amountOre: -5 })).rejects.toThrow();
    await expect(repo.addVisit(visit('v2', 'missing', '2026-09-01'))).rejects.toThrow();
  });

  it('applies an import plan in one transaction (replace and merge)', async () => {
    await repo.addClient(client('c1', 'Maria'));
    const file = JSON.stringify({
      app: 'salonbog',
      version: 1,
      clients: [{ id: 'a1', name: 'Holger', gender: 'herre' }, { id: 'a2', name: 'maria' }],
      visits: [{ id: 'x1', clientId: 'a1', treatment: 'Klip', date: '2026-06-13', note: '', amount: 350, pay: 'mp_mig' }],
      prices: { klip: 350 }
    });
    const read = readBackupText(file);
    if (read.kind !== 'plain') throw new Error('expected plain');
    const existing = await repo.load();
    await repo.applyImport(planImport(existing, read.backup, 'merge', NOW));
    const merged = await repo.load();
    expect(merged.clients.map((c) => c.name).sort()).toEqual(['Holger', 'Maria']);
    expect(merged.visits).toHaveLength(1);
    expect(merged.prices.get('klip')).toBe(35000);

    await repo.applyImport(planImport(merged, read.backup, 'replace', NOW));
    const replaced = await repo.load();
    expect(replaced.clients.map((c) => c.name).sort()).toEqual(['Holger', 'maria']);
  });
});
