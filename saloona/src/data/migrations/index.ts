/**
 * Versioned, append-only migrations.
 * The applied version is recorded in `schema_migrations` in the same transaction
 * as the migration itself, so a crash never leaves a half-migrated database.
 */
import { DbTooNewError, type Db } from '../db';
import { m001 } from './001_initial';
import { m002 } from './002_visit_time';
import { m003 } from './003_treatments';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [m001, m002, m003];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export async function currentVersion(db: Db): Promise<number> {
  const t = await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  if (t.length === 0) return 0;
  const rows = await db.query('SELECT MAX(version) AS v FROM schema_migrations');
  return Number(rows[0]?.v ?? 0);
}

export async function migrate(db: Db, now: () => string = () => new Date().toISOString()): Promise<number> {
  await db.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  );
  let version = await currentVersion(db);
  if (version > LATEST_VERSION) throw new DbTooNewError();
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    await db.batch([
      ...m.statements.map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', params: [m.version, m.name, now()] }
    ]);
    version = m.version;
  }
  return version;
}
