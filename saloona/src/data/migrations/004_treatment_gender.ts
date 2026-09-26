import type { Migration } from './index';

/**
 * 004: who a treatment is for (dame, herre or null for both). Existing entries get it
 * from their name, like genderFromName(): "Herreklip" → herre, "Dameklip" → dame.
 * Released – never edit, add a new migration.
 */
export const m004: Migration = {
  version: 4,
  name: 'treatment_gender',
  statements: [
    "ALTER TABLE treatments ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('dame', 'herre'))",
    `UPDATE treatments SET gender = CASE
      WHEN (label LIKE '%herre%' OR label LIKE '%drenge%') AND NOT (label LIKE '%dame%' OR label LIKE '%pige%') THEN 'herre'
      WHEN (label LIKE '%dame%' OR label LIKE '%pige%') AND NOT (label LIKE '%herre%' OR label LIKE '%drenge%') THEN 'dame'
    END`
  ]
};
