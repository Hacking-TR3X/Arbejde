import type { Migration } from './index';

/** 001: clients, visits, default prices and settings. Released – never edit, add a new migration. */
export const m001: Migration = {
  version: 1,
  name: 'initial',
  statements: [
    `CREATE TABLE clients (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      gender TEXT CHECK (gender IN ('dame', 'herre')),
      tag TEXT CHECK (tag IS NULL OR length(tag) <= 24),
      phone TEXT CHECK (phone IS NULL OR length(phone) <= 24),
      note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE visits (
      id TEXT PRIMARY KEY NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      treatment TEXT NOT NULL CHECK (length(treatment) BETWEEN 1 AND 60),
      treatment_key TEXT NOT NULL,
      date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
      amount_ore INTEGER CHECK (amount_ore IS NULL OR (amount_ore >= 0 AND amount_ore <= 100000000)),
      pay TEXT CHECK (pay IN ('kontant', 'mp_mig', 'mp_noah')),
      note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX visits_by_client ON visits (client_id, treatment_key, date)',
    'CREATE INDEX visits_by_date ON visits (date)',
    `CREATE TABLE treatment_prices (
      treatment_key TEXT PRIMARY KEY NOT NULL,
      amount_ore INTEGER NOT NULL CHECK (amount_ore >= 0 AND amount_ore <= 100000000)
    )`,
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`
  ]
};
