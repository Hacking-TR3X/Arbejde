import { describe, expect, it } from 'vitest';
import type { Client, Treatment } from '../types';
import { buildBackup } from './export';
import { planImport } from './merge';
import { readBackupText, type ParsedBackup } from './validate';

const NOW = '2026-09-26T10:00:00.000Z';
const client: Client = { id: 'c1', name: 'Maria', gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
const tr = (key: string, label: string, priceOre: number | null, durationMin: number | null): Treatment => ({ key, label, priceOre, durationMin, updatedAt: NOW });

function plain(file: unknown): ParsedBackup {
  const r = readBackupText(JSON.stringify(file));
  if (r.kind !== 'plain') throw new Error(JSON.stringify(r));
  return r.backup;
}

describe('price list in backups', () => {
  it('exports the price list and reads it back', () => {
    const catalog = new Map([['klip', tr('klip', 'Klip', 45000, 45)], ['striber', tr('striber', 'Striber', null, 120)]]);
    const file = buildBackup([client], [], new Map([['klip', 45000]]), new Date(NOW), catalog);
    expect(file.treatments).toEqual([{ name: 'Klip', price: 450, duration: 45 }, { name: 'Striber', duration: 120 }]);
    expect(file.prices).toEqual({ klip: 450 });
    const back = plain(file);
    expect(back.treatments).toEqual([
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 45 },
      { key: 'striber', label: 'Striber', priceOre: null, durationMin: 120 }
    ]);
  });

  it('the price list wins over the latest amount paid in the exported "prices"', () => {
    const visit = { id: 'v1', clientId: 'c1', treatment: 'Klip', treatmentKey: 'klip', date: '2026-09-01', amountOre: 40000, pay: null, note: '', createdAt: NOW, updatedAt: NOW };
    expect(buildBackup([client], [visit], new Map([['klip', 45000]]), new Date(NOW)).prices).toEqual({ klip: 450 });
    expect(buildBackup([client], [visit], new Map(), new Date(NOW)).prices).toEqual({ klip: 400 });
  });

  it('treats the price list as untrusted input', () => {
    const b = plain({
      app: 'saloona',
      clients: [],
      visits: [],
      treatments: [
        { name: '  Klip ', price: 450, duration: 45 },
        { name: 'klip', price: 999 }, // duplicate key: first wins
        { name: '', price: 100 },
        { name: 'Farve', price: -5, duration: 4 },
        { name: 'Permanent', duration: 45.5 },
        'nonsense',
        { name: { a: 1 } }
      ]
    });
    expect(b.treatments).toEqual([
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 45 },
      { key: 'farve', label: 'Farve', priceOre: null, durationMin: null },
      { key: 'permanent', label: 'Permanent', priceOre: null, durationMin: null }
    ]);
    expect(b.warnings).toEqual(['6 punkter i prislisten var ugyldige og blev sprunget over eller rettet']);
  });

  it('ignores a price list in a Salonbog file and rejects a non-array', () => {
    expect(plain({ app: 'salonbog', clients: [], visits: [], treatments: [{ name: 'Klip' }] }).treatments).toEqual([]);
    const b = plain({ app: 'saloona', clients: [], visits: [], treatments: { klip: 1 } });
    expect(b.treatments).toEqual([]);
    expect(b.warnings).toEqual(['1 punkt i prislisten var ugyldigt og blev sprunget over eller rettet']);
  });

  it('merge adds new treatments and only fills blanks in existing ones; replace takes all', () => {
    const incoming = plain({
      app: 'saloona',
      clients: [],
      visits: [],
      treatments: [{ name: 'Klip', price: 500, duration: 30 }, { name: 'Striber', price: 900, duration: 120 }]
    });
    const existing = { clients: [], visits: [], prices: new Map([['klip', 45000]]), treatments: new Map([['klip', tr('klip', 'Klip', 45000, null)]]) };
    const merged = planImport(existing, incoming, 'merge', NOW);
    expect(merged.treatments).toEqual([
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 30, updatedAt: NOW },
      { key: 'striber', label: 'Striber', priceOre: 90000, durationMin: 120, updatedAt: NOW }
    ]);
    const replaced = planImport(existing, incoming, 'replace', NOW);
    expect(replaced.treatments.map((t) => [t.key, t.priceOre, t.durationMin])).toEqual([['klip', 50000, 30], ['striber', 90000, 120]]);
  });
});
