/**
 * sql.js adapter. Used by unit tests (Node) and by the browser preview.
 * Never part of the Android build.
 */
import type { Database, SqlJsStatic } from 'sql.js';
import type { Db, Row, SqlValue, Statement } from './db';

export class SqlJsDb implements Db {
  constructor(
    readonly raw: Database,
    private readonly onChange: () => void = () => {}
  ) {
    raw.run('PRAGMA foreign_keys = ON');
  }

  async query(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    this.raw.run(sql, params);
    this.onChange();
  }

  async batch(statements: Statement[]): Promise<void> {
    this.raw.run('BEGIN');
    try {
      for (const s of statements) this.raw.run(s.sql, s.params ?? []);
      this.raw.run('COMMIT');
    } catch (e) {
      this.raw.run('ROLLBACK');
      throw e;
    }
    this.onChange();
  }
}

export function createSqlJsDb(SQL: SqlJsStatic, data?: Uint8Array, onChange?: () => void): SqlJsDb {
  return new SqlJsDb(new SQL.Database(data), onChange);
}
