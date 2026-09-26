/**
 * Android database: @capacitor-community/sqlite with SQLCipher.
 *
 * The passphrase is 32 random bytes (hex), generated on first start and handed to
 * the plugin once. The plugin keeps it in EncryptedSharedPreferences, protected by
 * an AES-256-GCM master key in the Android Keystore. It never leaves native storage
 * afterwards and is not part of any backup (allowBackup=false).
 */
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { SaloonaNative } from '../platform/native';
import { DbKeyLostError, type Db, type Row, type SqlValue, type Statement } from './db';

const DB_NAME = 'saloona';

function randomPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class NativeDb implements Db {
  constructor(private readonly conn: SQLiteDBConnection) {}

  async query(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    const res = await this.conn.query(sql, params);
    return (res.values ?? []) as Row[];
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    await this.conn.run(sql, params, true);
  }

  async batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.conn.executeSet(
      statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })),
      true
    );
  }
}

let sqlite: SQLiteConnection | null = null;
let connection: SQLiteDBConnection | null = null;

export async function openNativeDb(): Promise<Db> {
  sqlite ??= new SQLiteConnection(CapacitorSQLite);
  const secretStored = (await sqlite.isSecretStored()).result === true;
  if (!secretStored) {
    const exists = (await sqlite.isDatabase(DB_NAME)).result === true;
    if (exists) throw new DbKeyLostError();
    await sqlite.setEncryptionSecret(randomPassphrase());
  }
  const consistent = (await sqlite.checkConnectionsConsistency()).result === true;
  const hasConn = (await sqlite.isConnection(DB_NAME, false)).result === true;
  connection =
    consistent && hasConn
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, true, 'secret', 1, false);
  await connection.open();
  // Overwrite deleted content inside the (encrypted) pages as well.
  await connection.query('PRAGMA secure_delete = ON').catch(() => undefined);
  return new NativeDb(connection);
}

/** Deletes the database file and forgets the key. Used by "Slet alle data". */
export async function destroyNativeDb(): Promise<void> {
  sqlite ??= new SQLiteConnection(CapacitorSQLite);
  try {
    if (connection) await connection.delete();
  } catch {
    // fall through to the file-level delete below
  }
  try {
    await sqlite.closeConnection(DB_NAME, false);
  } catch {
    // already closed
  }
  connection = null;
  // Make sure the file is gone (also covers a connection that could not be opened).
  await SaloonaNative.deleteDatabaseFiles();
  // Forget the key only once the data it protects is gone.
  if (!(await sqlite.isDatabase(DB_NAME)).result && (await sqlite.isSecretStored()).result) {
    await sqlite.clearEncryptionSecret();
  }
}

/** Last resort when the key is lost: remove the unreadable file so the app can start fresh. */
export async function discardUnreadableNativeDb(): Promise<void> {
  await SaloonaNative.deleteDatabaseFiles();
}
