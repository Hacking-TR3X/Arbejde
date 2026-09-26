/**
 * Browser preview database (development and end-to-end tests only).
 * Persists to localStorage so reloads keep data. The Android build never includes
 * this file: it is only imported behind `__WEB_PREVIEW__`.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Db } from './db';
import { createSqlJsDb, type SqlJsDb } from './sqljs';

const KEY = 'saloona.preview.db';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let db: SqlJsDb | null = null;

export async function openPreviewDb(): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let data: Uint8Array | undefined;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) data = fromB64(saved);
  } catch {
    data = undefined;
  }
  const save = () => {
    try {
      if (db) localStorage.setItem(KEY, toB64(db.raw.export()));
    } catch {
      // storage full or unavailable – preview only
    }
  };
  db = createSqlJsDb(SQL, data, save);
  return db;
}

export async function destroyPreviewDb(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  db?.raw.close();
  db = null;
}
