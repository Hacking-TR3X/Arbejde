import { describe, expect, it } from 'vitest';
import type { Client, Treatment } from '../types';
import { buildBackup } from './export';
import { planImport } from './merge';
import { readBackupText, type ParsedBackup } from './validate';

const NOW = '2026-09-26T10:00:00.000Z';
const client: Client = { id: 'c1', name: 'Maria', gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
const tr = (key: string, label: string, priceOre: number | null, durationMin: number | null, gender: Treatment['gender'] = null): Treatment => ({ key, label, priceOre, durationMin, gender, updatedAt: NOW });

function plain(file: unknown): ParsedBackup {
  const r = readBackupText(JSON.stringify(file));
  if (r.kind !== 'plain') throw new Error(JSON.stringify(r));
  return r.backup;
}

describe('price list in backups', () => {
  it('exports the price list and reads it back', () => {
    const catalog = new Map([
      ['klip', tr('klip', 'Klip', 45000, 45)],
      ['striber', tr('striber', 'Striber', null, 120, 'dame')],
      ['herreklip', tr('herreklip', 'Herreklip', 30000, 30, null)] // explicitly for both, despite the name
    ]);
    const file = buildBackup([client], [], new Map([['klip', 45000]]), new Date(NOW), catalog);
    expect(file.treatments).toEqual([
      { name: 'Klip', gender: 'alle', price: 450, duration: 45 },
      { name: 'Striber', gender: 'dame', duration: 120 },
      { name: 'Herreklip', gender: 'alle', price: 300, duration: 30 }
    ]);
    expect(file.prices).toEqual({ klip: 450 });
    const back = plain(file);
    expect(back.treatments).toEqual([
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 45, gender: null },
      { key: 'striber', label: 'Striber', priceOre: null, durationMin: 120, gender: 'dame' },
      { key: 'herreklip', label: 'Herreklip', priceOre: 30000, durationMin: 30, gender: null }
    ]);
  });

  it('a file without gender on the price list reads it from the name; unknown values are reported', () => {
    const b = plain({
      app: 'saloona',
      clients: [],
      visits: [],
      treatments: [{ name: 'Herreklip' }, { name: 'Pigeklip', gender: null }, { name: 'Klip', gender: 'herre' }, { name: 'Farve', gender: 'x' }]
    });
    expect(b.treatments?.map((t) => [t.key, t.gender])).toEqual([['herreklip', 'herre'], ['pigeklip', 'dame'], ['klip', 'herre'], ['farve', null]]);
    expect(b.warnings).toEqual(['1 punkt i prislisten var ugyldigt og blev sprunget over eller rettet']);
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
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 45, gender: null },
      { key: 'farve', label: 'Farve', priceOre: null, durationMin: null, gender: null },
      { key: 'permanent', label: 'Permanent', priceOre: null, durationMin: null, gender: null }
    ]);
    expect(b.warnings).toEqual(['6 punkter i prislisten var ugyldige og blev sprunget over eller rettet']);
  });

  it('ignores a price list in a Salonbog file and rejects a non-array', () => {
    expect(plain({ app: 'salonbog', clients: [], visits: [], treatments: [{ name: 'Klip' }] }).treatments).toBeUndefined();
    const b = plain({ app: 'saloona', clients: [], visits: [], treatments: { klip: 1 } });
    expect(b.treatments).toEqual([]);
    expect(b.warnings).toEqual(['1 punkt i prislisten var ugyldigt og blev sprunget over eller rettet']);
  });

  it('a file with a price list does not turn its `prices` into price-list entries', () => {
    const b = plain({ app: 'saloona', clients: [], visits: [], prices: { klip: 450, farve: 900 }, treatments: [{ name: 'Klip', price: 500 }] });
    const none = { clients: [], visits: [], prices: new Map<string, number>(), treatments: new Map() };
    for (const mode of ['merge', 'replace'] as const) {
      const plan = planImport(none, b, mode, 'T');
      expect(plan.prices).toEqual([]);
      expect(plan.treatments.map((t) => [t.key, t.priceOre])).toEqual([['klip', 50_000]]);
    }
  });

  it('a Saloona file without a price list still fills the price list from `prices`', () => {
    const b = plain({ app: 'saloona', clients: [], visits: [], prices: { klip: 450 } });
    expect(b.treatments).toBeUndefined();
    const none = { clients: [], visits: [], prices: new Map<string, number>(), treatments: new Map() };
    expect(planImport(none, b, 'merge', 'T').prices).toEqual([['klip', 45_000]]);
    expect(planImport(none, b, 'replace', 'T').prices).toEqual([['klip', 45_000]]);
  });

  it('merge adds new treatments and only fills blanks in existing ones; replace takes all', () => {
    const incoming = plain({
      app: 'saloona',
      clients: [],
      visits: [],
      treatments: [{ name: 'Klip', price: 500, duration: 30, gender: 'dame' }, { name: 'Striber', price: 900, duration: 120, gender: 'dame' }]
    });
    const existing = { clients: [], visits: [], prices: new Map([['klip', 45000]]), treatments: new Map([['klip', tr('klip', 'Klip', 45000, null)]]) };
    const merged = planImport(existing, incoming, 'merge', NOW);
    // "Klip" keeps its gender (null = both is a choice, not a blank).
    expect(merged.treatments).toEqual([
      { key: 'klip', label: 'Klip', priceOre: 45000, durationMin: 30, gender: null, updatedAt: NOW },
      { key: 'striber', label: 'Striber', priceOre: 90000, durationMin: 120, gender: 'dame', updatedAt: NOW }
    ]);
    const replaced = planImport(existing, incoming, 'replace', NOW);
    expect(replaced.treatments.map((t) => [t.key, t.priceOre, t.durationMin])).toEqual([['klip', 50000, 30], ['striber', 90000, 120]]);
  });
});

describe('treatment gender in an untrusted file (security review 8eb4d91)', () => {
  it('only an own "dame", "herre" or "alle" counts; __proto__ and odd types fall back to the name', () => {
    const text = JSON.stringify({
      app: 'saloona',
      clients: [],
      visits: [],
      treatments: [
        { name: 'Klip', PROTO: { gender: 'herre' } },
        { name: 'Farve', gender: ['dame'] },
        { name: 'Vask', gender: { toString: 'dame' } },
        { name: 'Føn', gender: 'DAME' },
        { name: 'Striber', gender: 'dame ' },
        { name: 'Permanent', gender: 1 },
        { name: 'Herreklip', gender: 'alle' },
        { name: 'Dameklip', gender: 'herre' }
      ]
    }).replace('"PROTO"', '"__proto__"');
    const r = readBackupText(text);
    if (r.kind !== 'plain') throw new Error(r.kind);
    expect(r.backup.treatments?.map((t) => [t.key, t.gender])).toEqual([
      ['klip', null], ['farve', null], ['vask', null], ['føn', null], ['striber', null], ['permanent', null], ['herreklip', null], ['dameklip', 'herre']
    ]);
    expect(r.backup.warnings).toEqual(['5 punkter i prislisten var ugyldige og blev sprunget over eller rettet']);
    const plan = planImport({ clients: [], visits: [], prices: new Map(), treatments: new Map() }, r.backup, 'replace', NOW);
    for (const t of plan.treatments) expect(Object.getPrototypeOf(t)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).gender).toBeUndefined();
  });
});
