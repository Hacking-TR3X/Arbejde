/** Minimal database interface shared by the Android (SQLCipher) and test/preview (sql.js) adapters. */

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface Db {
  query(sql: string, params?: SqlValue[]): Promise<Row[]>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  /** Runs every statement in one transaction: all or nothing. */
  batch(statements: Statement[]): Promise<void>;
}

/** Thrown when the encrypted database exists but its key is gone (e.g. after a Keystore reset). */
export class DbKeyLostError extends Error {
  constructor() {
    super('Databasens nøgle findes ikke længere');
    this.name = 'DbKeyLostError';
  }
}

/** Thrown when the database was written by a newer app version. */
export class DbTooNewError extends Error {
  constructor() {
    super('Databasen er fra en nyere version af Saloona');
    this.name = 'DbTooNewError';
  }
}
