import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, backupFileName, buildBackup, serializeBackup } from './export';
import { planImport } from './merge';
import { readBackupText, type ParsedBackup } from './validate';
import { MAX_AMOUNT_ORE } from '../money';
import type { Client, Visit } from '../types';
import { client, fixtureText, paid, visit } from '../../../tests/helpers/factories';

const NOW = new Date('2026-09-26T10:00:00.000Z');

function reread(text: string): ParsedBackup {
  const r = readBackupText(text);
  if (r.kind !== 'plain') throw new Error(`expected plain, got ${JSON.stringify(r)}`);
  return r.backup;
}

const clients: Client[] = [
  client('c1', 'Morten', { gender: 'herre', phone: '+4512345678', note: 'Kort i siderne\nIkke for kort foran' }),
  client('c2', 'Sirius', { gender: 'herre', tag: 'Barn' }),
  client('c3', 'Familie Køge', { note: 'Barn' }), // short note stays a note in Saloona files
  client('c4', 'Søren Ærø-Åberg', { gender: 'dame', tag: 'Nabo', phone: '12345678' })
];

const visits: Visit[] = [
  paid('c1', 'Klip', '2026-06-13', 400, 'kontant'),
  paid('c1', 'Klip', '2026-09-26', 450, 'mp_mig', { note: 'Lidt kortere' }),
  paid('c4', 'Farve', '2026-09-04', 1250.5, 'mp_noah'),
  visit('c2', 'Børneklip', '2026-08-29'), // no amount, no pay
  paid('c3', 'Klip', '2026-09-05', 0.01, null), // 1 øre, no pay
  paid('c4', 'Permanent', '2026-10-02', 999_999.99, null) // booked, maximum-ish amount
];

describe('buildBackup', () => {
  const file = buildBackup(clients, visits, new Map([['klip', 45_000], ['hårkur', 30_000]]), NOW);

  it('writes the Saloona header', () => {
    expect(file.app).toBe('saloona');
    expect(file.version).toBe(BACKUP_VERSION);
    expect(BACKUP_VERSION).toBe(2);
    expect(file.exported).toBe('2026-09-26T10:00:00.000Z');
  });

  it('writes clients in the prototype-compatible shape, optional fields only when set', () => {
    expect(file.clients).toEqual([
      { id: 'c1', name: 'Morten', gender: 'herre', phone: '+4512345678', note: 'Kort i siderne\nIkke for kort foran' },
      { id: 'c2', name: 'Sirius', gender: 'herre', tag: 'Barn', note: '' },
      { id: 'c3', name: 'Familie Køge', note: 'Barn' },
      { id: 'c4', name: 'Søren Ærø-Åberg', gender: 'dame', tag: 'Nabo', phone: '12345678', note: '' }
    ]);
  });

  it('writes visits with amounts in kroner and no internal fields', () => {
    expect(file.visits[1]).toEqual({ id: visits[1]!.id, clientId: 'c1', treatment: 'Klip', date: '2026-09-26', note: 'Lidt kortere', amount: 450, pay: 'mp_mig' });
    expect(file.visits[2]!.amount).toBe(1250.5);
    expect(file.visits[3]).toEqual({ id: visits[3]!.id, clientId: 'c2', treatment: 'Børneklip', date: '2026-08-29', note: '' });
    expect(file.visits[4]).toEqual(expect.objectContaining({ amount: 0.01 }));
    expect(file.visits[4]).not.toHaveProperty('pay');
    for (const v of file.visits) {
      expect(v).not.toHaveProperty('treatmentKey');
      expect(v).not.toHaveProperty('createdAt');
      expect(v).not.toHaveProperty('amountOre');
    }
  });

  it('prices = latest amount per treatment, over the stored defaults', () => {
    expect(file.prices).toEqual({
      klip: 450, // 2026-09-26 (450) beats 2026-06-13 (400); the default is overridden
      farve: 1250.5,
      permanent: 999_999.99, // note: includes the amount of a booked visit
      hårkur: 300 // only a default
    });
    expect(Object.getPrototypeOf(file.prices)).toBe(Object.prototype);
  });

  it('prices: the newest date wins regardless of order; on the same date the last one wins', () => {
    const p = buildBackup([], [paid('a', 'Klip', '2026-09-01', 500), paid('a', 'Klip', '2026-01-01', 300)], new Map(), NOW).prices;
    expect(p).toEqual({ klip: 500 });
    const same = buildBackup([], [paid('a', 'Klip', '2026-09-01', 500), paid('b', 'Klip', '2026-09-01', 550)], new Map(), NOW).prices;
    expect(same).toEqual({ klip: 550 });
  });

  it('an empty app gives an empty, valid file', () => {
    const empty = buildBackup([], [], new Map(), NOW);
    expect(empty).toEqual({ app: 'saloona', version: 2, exported: NOW.toISOString(), clients: [], visits: [], prices: {} });
    expect(reread(serializeBackup(empty))).toMatchObject({ clients: [], visits: [], warnings: [] });
  });

  it('a treatment called "__proto__" or "constructor" does not pollute anything', () => {
    const f = buildBackup([client('a', 'A')], [paid('a', '__proto__', '2026-09-01', 1), paid('a', 'constructor', '2026-09-01', 2)], new Map(), NOW);
    expect(({} as Record<string, unknown>).klip).toBeUndefined();
    expect(Object.getPrototypeOf(f.prices)).toBe(Object.prototype);
    const back = reread(serializeBackup(f));
    expect(back.visits).toHaveLength(2);
    expect(back.prices.size).toBe(0); // skipped on import – the visits keep their amounts
  });
});

describe('serializeBackup → readBackupText round trip', () => {
  const text = serializeBackup(buildBackup(clients, visits, new Map([['hårkur', 30_000]]), NOW));
  const back = reread(text);

  it('is valid JSON with a Saloona header and no warnings', () => {
    expect(() => JSON.parse(text)).not.toThrow();
    expect(back.source).toBe('saloona');
    expect(back.exported).toBe(NOW.toISOString());
    expect(back.warnings).toEqual([]);
  });

  it('keeps clients including tag, phone, gender and multi-line notes', () => {
    expect(back.clients).toEqual(
      clients.map(({ id, name, gender, tag, phone, note }) => ({ id, name, gender, tag, phone, note }))
    );
  });

  it('keeps visits including amounts (øre ↔ kroner) and payment methods', () => {
    expect(back.visits).toEqual(
      visits.map(({ id, clientId, treatment, treatmentKey, date, amountOre, pay, note }) => ({
        id,
        clientId,
        treatment,
        treatmentKey,
        date,
        amountOre,
        pay,
        note
      }))
    );
  });

  it('keeps prices', () => {
    expect(Object.fromEntries(back.prices)).toEqual({ klip: 45_000, farve: 125_050, permanent: 99_999_999, hårkur: 30_000 });
  });

  it('replace-import of the export restores the same data', () => {
    const plan = planImport({ clients: [], visits: [], prices: new Map() }, back, 'replace', 'T');
    const strip = <T extends { createdAt: string; updatedAt: string }>(x: T) => ({ ...x, createdAt: '', updatedAt: '' });
    expect(plan.insertClients.map(strip)).toEqual(clients.map(strip));
    expect(plan.insertVisits.map(strip)).toEqual(visits.map(strip));
  });

  it('every amount from 0 to the maximum survives the kroner conversion', () => {
    const amounts = [0, 1, 7, 29, 57, 99, 101, 1_005, 45_000, 125_050, 99_999_999, MAX_AMOUNT_ORE];
    const vs = amounts.map((a, i) => visit('c1', 'Klip', '2026-01-01', { id: `a${i}`, amountOre: a }));
    const again = reread(serializeBackup(buildBackup([client('c1', 'A')], vs, new Map(), NOW)));
    expect(again.visits.map((v) => v.amountOre)).toEqual(amounts);
  });

  it('the prototype fixture survives import → export → import unchanged', () => {
    const first = reread(fixtureText('salonbog-backup.json'));
    const plan = planImport({ clients: [], visits: [], prices: new Map() }, first, 'replace', 'T');
    const exported = serializeBackup(buildBackup(plan.insertClients, plan.insertVisits, new Map(plan.prices), NOW));
    const second = reread(exported);
    expect(second.clients).toEqual(first.clients);
    expect(second.visits).toEqual(first.visits);
    expect(second.warnings).toEqual([]);
  });
});

describe('backupFileName', () => {
  it('includes the date and marks protected files', () => {
    expect(backupFileName('2026-09-26', false)).toBe('saloona-backup-2026-09-26.json');
    expect(backupFileName('2026-09-26', true)).toBe('saloona-backup-2026-09-26-beskyttet.json');
  });
});
