import type { Migration } from './index';

/**
 * 003: price list. `treatments` replaces `treatment_prices` and adds a display name
 * and a duration. Existing standard prices are carried over, named with the
 * spelling used most recently in visits. Released – never edit, add a new migration.
 */
export const m003: Migration = {
  version: 3,
  name: 'treatments',
  statements: [
    `CREATE TABLE treatments (
      key TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
      price_ore INTEGER CHECK (price_ore IS NULL OR (price_ore >= 0 AND price_ore <= 100000000)),
      duration_min INTEGER CHECK (duration_min IS NULL OR (duration_min BETWEEN 5 AND 600)),
      updated_at TEXT NOT NULL
    )`,
    `INSERT INTO treatments (key, label, price_ore, duration_min, updated_at)
      SELECT p.treatment_key,
             COALESCE(
               (SELECT v.treatment FROM visits v WHERE v.treatment_key = p.treatment_key ORDER BY v.date DESC, v.created_at DESC LIMIT 1),
               p.treatment_key
             ),
             p.amount_ore,
             NULL,
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM treatment_prices p`,
    'DROP TABLE treatment_prices'
  ]
};
