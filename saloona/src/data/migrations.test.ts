import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { m001 } from './migrations/001_initial';
import { LATEST_VERSION, currentVersion, migrate } from './migrations';
import { Repo } from './repo';
import { createSqlJsDb } from './sqljs';

const NOW = '2026-09-26T10:00:00.000Z';

describe('migration 002 (visit time)', () => {
  it('upgrades a version-1 database with data and keeps every row', async () => {
    const SQL = await initSqlJs();
    const db = createSqlJsDb(SQL);
    // Simulate an app that only had migration 001.
    await db.run('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    await db.batch([...m001.statements.map((sql) => ({ sql })), { sql: 'INSERT INTO schema_migrations VALUES (1, ?, ?)', params: ['initial', NOW] }]);
    await db.run('INSERT INTO clients (id, name, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['c1', 'Maria', '', NOW, NOW]);
    await db.run(
      'INSERT INTO visits (id, client_id, treatment, treatment_key, date, amount_ore, pay, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['v1', 'c1', 'Klip', 'klip', '2026-09-01', 45000, 'kontant', '', NOW, NOW]
    );
    expect(await currentVersion(db)).toBe(1);

    expect(await migrate(db, () => NOW)).toBe(LATEST_VERSION);
    const s = await new Repo(db).load();
    expect(s.visits).toEqual([expect.objectContaining({ id: 'v1', time: null, amountOre: 45000 })]);
  });

  it('stores, updates and clears a time, and rejects a malformed one', async () => {
    const SQL = await initSqlJs();
    const db = createSqlJsDb(SQL);
    await migrate(db, () => NOW);
    const repo = new Repo(db);
    const c = { id: 'c1', name: 'Maria', gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
    const v = { id: 'v1', clientId: 'c1', treatment: 'Klip', treatmentKey: 'klip', date: '2026-10-02', time: '14:30', amountOre: null, pay: null, note: '', createdAt: NOW, updatedAt: NOW };
    await repo.addVisit(v, c);
    expect((await repo.load()).visits[0]?.time).toBe('14:30');
    await repo.saveVisit({ ...v, time: null });
    expect((await repo.load()).visits[0]?.time).toBeNull();
    await expect(repo.saveVisit({ ...v, time: '1430' })).rejects.toThrow();
  });
});
