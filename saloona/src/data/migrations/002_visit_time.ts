import type { Migration } from './index';

/** 002: optional time of day on visits and appointments. Released – never edit, add a new migration. */
export const m002: Migration = {
  version: 2,
  name: 'visit_time',
  statements: [
    "ALTER TABLE visits ADD COLUMN time TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]')"
  ]
};
