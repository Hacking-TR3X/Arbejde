import { describe, expect, it } from 'vitest';
import { planImport, type ExistingData, type ImportPlan } from './merge';
import { readBackupText, type ImportClient, type ImportVisit, type ParsedBackup } from './validate';
import { treatmentKey } from '../text';
import type { Client, Visit } from '../types';
import { client, fixtureText, visit } from '../../../tests/helpers/factories';

const NOW = '2026-09-26T10:00:00.000Z';
const EMPTY: ExistingData = { clients: [], visits: [], prices: new Map() };

function parse(text: string): ParsedBackup {
  const r = readBackupText(text);
  if (r.kind !== 'plain') throw new Error(`fixture did not parse: ${JSON.stringify(r)}`);
  return r.backup;
}

function ic(id: string, name: string, extra: Partial<ImportClient> = {}): ImportClient {
  return { id, name, gender: null, tag: null, phone: null, note: '', ...extra };
}

function iv(id: string, clientId: string, treatment: string, date: string, extra: Partial<ImportVisit> = {}): ImportVisit {
  return { id, clientId, treatment, treatmentKey: treatmentKey(treatment), date, amountOre: null, pay: null, note: '', ...extra };
}

function backup(clients: ImportClient[], visits: ImportVisit[] = [], prices: [string, number][] = []): ParsedBackup {
  return { source: 'saloona', exported: null, clients, visits, prices: new Map(prices), warnings: [] };
}

/** Applies a plan the way the data layer is expected to (one transaction). */
function apply(existing: ExistingData, plan: ImportPlan): ExistingData {
  if (plan.mode === 'replace') {
    return { clients: plan.insertClients, visits: plan.insertVisits, prices: new Map(plan.prices) };
  }
  const updated = new Map(plan.updateClients.map((c) => [c.id, c]));
  return {
    clients: [...existing.clients.map((c) => updated.get(c.id) ?? c), ...plan.insertClients],
    visits: [...existing.visits, ...plan.insertVisits],
    prices: new Map([...existing.prices, ...plan.prices])
  };
}

/** Referential integrity and primary keys, as the database would enforce them. */
function assertConsistent(data: ExistingData) {
  const clientIds = new Set(data.clients.map((c) => c.id));
  expect(clientIds.size).toBe(data.clients.length);
  const visitIds = new Set(data.visits.map((v) => v.id));
  expect(visitIds.size).toBe(data.visits.length);
  for (const v of data.visits) expect(clientIds.has(v.clientId)).toBe(true);
}

let idSeq = 0;
const makeId = () => `new${++idSeq}`;

describe('replace', () => {
  it('takes everything from the file and nothing from the app', () => {
    const existing: ExistingData = {
      clients: [client('old', 'Gammel')],
      visits: [visit('old', 'Klip', '2026-01-01')],
      prices: new Map([['klip', 40_000]])
    };
    const incoming = backup([ic('c1', 'Morten', { gender: 'herre' })], [iv('v1', 'c1', 'Klip', '2026-09-26', { amountOre: 45_000 })], [['klip', 45_000]]);
    const plan = planImport(existing, incoming, 'replace', NOW, makeId);
    expect(plan.mode).toBe('replace');
    expect(plan.insertClients).toEqual([
      { id: 'c1', name: 'Morten', gender: 'herre', tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW }
    ]);
    expect(plan.insertVisits).toEqual([
      {
        id: 'v1',
        clientId: 'c1',
        treatment: 'Klip',
        treatmentKey: 'klip',
        date: '2026-09-26',
        amountOre: 45_000,
        pay: null,
        note: '',
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
    expect(plan.updateClients).toEqual([]);
    expect(plan.prices).toEqual([['klip', 45_000]]);
    expect(plan.stats).toEqual({ clientsInFile: 1, visitsInFile: 1, newClients: 1, matchedClients: 0, newVisits: 1, duplicateVisits: 0 });
  });
});

describe('merge – prototype fixture', () => {
  const file = parse(fixtureText('salonbog-backup.json'));

  it('into an empty app: everything is new', () => {
    const plan = planImport(EMPTY, file, 'merge', NOW, makeId);
    expect(plan.stats).toEqual({ clientsInFile: 13, visitsInFile: 28, newClients: 13, matchedClients: 0, newVisits: 28, duplicateVisits: 0 });
    expect(plan.insertClients.map((c) => c.id)).toEqual(file.clients.map((c) => c.id));
    expect(plan.prices).toEqual([
      ['klip', 45_000],
      ['farve', 90_000]
    ]);
    assertConsistent(apply(EMPTY, plan));
  });

  it('merging the same file twice adds nothing the second time', () => {
    const once = apply(EMPTY, planImport(EMPTY, file, 'merge', NOW, makeId));
    const second = planImport(once, file, 'merge', NOW, makeId);
    expect(second.stats).toEqual({ clientsInFile: 13, visitsInFile: 28, newClients: 0, matchedClients: 13, newVisits: 0, duplicateVisits: 28 });
    expect(second.insertClients).toEqual([]);
    expect(second.insertVisits).toEqual([]);
    expect(second.updateClients).toEqual([]);
    expect(second.prices).toEqual([]);
    const twice = apply(once, second);
    expect(twice.clients).toHaveLength(13);
    expect(twice.visits).toHaveLength(28);
  });

  it('replace followed by merge of the same file adds nothing', () => {
    const replaced = apply(EMPTY, planImport(EMPTY, file, 'replace', NOW, makeId));
    const plan = planImport(replaced, file, 'merge', NOW, makeId);
    expect(plan.stats.newClients).toBe(0);
    expect(plan.stats.newVisits).toBe(0);
  });

  it('a re-export from Saloona with other visit ids still does not duplicate visits', () => {
    const once = apply(EMPTY, planImport(EMPTY, file, 'merge', NOW, makeId));
    const renamed: ParsedBackup = { ...file, visits: file.visits.map((v) => ({ ...v, id: `x${v.id}` })) };
    const plan = planImport(once, renamed, 'merge', NOW, makeId);
    expect(plan.stats.newVisits).toBe(0);
    expect(plan.stats.duplicateVisits).toBe(28);
  });

  it('old file merged into new: no new clients, old visits added, existing values win', () => {
    const now = apply(EMPTY, planImport(EMPTY, file, 'replace', NOW, makeId));
    const old = parse(fixtureText('salonbog-backup-old.json'));
    const plan = planImport(now, old, 'merge', NOW, makeId);
    expect(plan.stats).toMatchObject({ newClients: 0, matchedClients: 4, newVisits: 5, duplicateVisits: 0 });
    expect(plan.updateClients).toEqual([]); // Familie Køge keeps her note
    assertConsistent(apply(now, plan));
  });

  it('new file merged into old: blank note is filled in', () => {
    const before = apply(EMPTY, planImport(EMPTY, parse(fixtureText('salonbog-backup-old.json')), 'replace', NOW, makeId));
    const plan = planImport(before, file, 'merge', NOW, makeId);
    expect(plan.stats).toMatchObject({ newClients: 9, matchedClients: 4, newVisits: 28 });
    expect(plan.updateClients.map((c) => [c.name, c.note])).toEqual([['Familie Køge', 'Mor, far og de to drenge']]);
  });
});

describe('merge – matching clients', () => {
  it('matches on id first', () => {
    const existing: ExistingData = {
      clients: [client('c1', 'Morten Hansen'), client('e2', 'Morten')],
      visits: [],
      prices: new Map()
    };
    const plan = planImport(existing, backup([ic('c1', 'Morten')], [iv('v1', 'c1', 'Klip', '2026-09-01')]), 'merge', NOW, makeId);
    expect(plan.stats.matchedClients).toBe(1);
    expect(plan.insertVisits[0]!.clientId).toBe('c1');
  });

  it('same id with a different name is the same client (renamed in the app); the name is kept', () => {
    const existing: ExistingData = { clients: [client('c1', 'Morten Hansen', { gender: 'herre' })], visits: [], prices: new Map() };
    const plan = planImport(existing, backup([ic('c1', 'Morten', { gender: 'dame' })]), 'merge', NOW, makeId);
    expect(plan.insertClients).toEqual([]);
    expect(plan.updateClients).toEqual([]);
  });

  it('then on name, ignoring case (also æøå)', () => {
    const existing: ExistingData = { clients: [client('e1', 'Morten'), client('e2', 'Åse Ærø')], visits: [], prices: new Map() };
    const incoming = backup(
      [ic('c1', 'MORTEN'), ic('c2', 'åse ærø')],
      [iv('v1', 'c1', 'Klip', '2026-09-01'), iv('v2', 'c2', 'Farve', '2026-09-02')]
    );
    const plan = planImport(existing, incoming, 'merge', NOW, makeId);
    expect(plan.stats).toMatchObject({ matchedClients: 2, newClients: 0, newVisits: 2 });
    // The visits follow the matched client.
    expect(plan.insertVisits.map((v) => v.clientId)).toEqual(['e1', 'e2']);
  });

  it('when two existing clients share a name, a name match goes to the first of them', () => {
    // Documented behaviour: name matching cannot tell two existing "Anne"s apart.
    const existing: ExistingData = { clients: [client('e1', 'Anne'), client('e2', 'anne')], visits: [], prices: new Map() };
    const plan = planImport(existing, backup([ic('c1', 'ANNE')], [iv('v1', 'c1', 'Klip', '2026-09-01')]), 'merge', NOW, makeId);
    expect(plan.insertVisits.map((v) => v.clientId)).toEqual(['e1']);
  });

  it('a new client keeps its id from the file', () => {
    const plan = planImport({ clients: [client('e1', 'Hanne')], visits: [], prices: new Map() }, backup([ic('c9', 'Laura')]), 'merge', NOW, makeId);
    expect(plan.insertClients.map((c) => c.id)).toEqual(['c9']);
    expect(plan.insertClients[0]).toMatchObject({ createdAt: NOW, updatedAt: NOW });
  });

  it('an id that is already taken inside the same plan gets a new id (only reachable without the validator)', () => {
    // The validator removes duplicate ids, so this guards the database primary key only.
    const incoming = backup([ic('x', 'Anne'), ic('x', 'Bente')], [iv('v1', 'x', 'Klip', '2026-09-01')]);
    const plan = planImport(EMPTY, incoming, 'merge', NOW, () => 'fresh-id');
    expect(plan.insertClients.map((c) => [c.id, c.name])).toEqual([
      ['x', 'Anne'],
      ['fresh-id', 'Bente']
    ]);
    assertConsistent(apply(EMPTY, plan));
  });

  // BUG (Middel): a client inserted earlier in the same merge is added to the
  // name index (merge.ts:412), so two *different* clients in the file that share
  // a name (two customers called "Anne", with different ids) are collapsed into
  // one when merging into an app where neither exists yet. All of the second
  // Anne's visits move to the first Anne, and visits on the same date and
  // treatment are dropped as duplicates. "Erstat" keeps them apart, so "Flet"
  // into an empty app gives a different – and wrong – result. The plan only
  // matches the file against *existing* data by name.
  it.fails('two different clients with the same name in one file are not merged into one (merge.ts:412)', () => {
    const incoming = backup(
      [ic('a1', 'Anne', { gender: 'dame' }), ic('a2', 'Anne', { gender: 'dame' })],
      [iv('v1', 'a1', 'Klip', '2026-09-01'), iv('v2', 'a2', 'Klip', '2026-09-01')]
    );
    const merged = planImport(EMPTY, incoming, 'merge', NOW, makeId);
    const replaced = planImport(EMPTY, incoming, 'replace', NOW, makeId);
    expect(merged.insertClients.map((c) => c.id)).toEqual(replaced.insertClients.map((c) => c.id));
    expect(merged.insertVisits.map((v) => v.clientId)).toEqual(['a1', 'a2']);
  });
});

describe('merge – existing values win, blanks are filled', () => {
  const existing: ExistingData = {
    clients: [
      client('e1', 'Morten', { gender: 'herre', tag: 'Fast', phone: '12345678', note: 'Kort i siderne', createdAt: '2026-01-01T00:00:00.000Z' }),
      client('e2', 'Hanne', { createdAt: '2026-02-02T00:00:00.000Z' })
    ],
    visits: [],
    prices: new Map()
  };

  it('does not overwrite anything that is already filled in', () => {
    const plan = planImport(
      existing,
      backup([ic('c1', 'Morten', { gender: 'dame', tag: 'Barn', phone: '87654321', note: 'Anden note' })]),
      'merge',
      NOW,
      makeId
    );
    expect(plan.updateClients).toEqual([]);
    expect(plan.stats.matchedClients).toBe(1);
  });

  it('fills in empty gender, tag, phone and note, and keeps name and createdAt', () => {
    const plan = planImport(
      existing,
      backup([ic('c2', 'HANNE', { gender: 'dame', tag: 'Farmor', phone: '+4512345678', note: 'Kaffe med mælk' })]),
      'merge',
      NOW,
      makeId
    );
    expect(plan.updateClients).toEqual([
      {
        id: 'e2',
        name: 'Hanne',
        gender: 'dame',
        tag: 'Farmor',
        phone: '+4512345678',
        note: 'Kaffe med mælk',
        createdAt: '2026-02-02T00:00:00.000Z',
        updatedAt: NOW
      }
    ]);
  });

  it('two file entries matching the same client end up in one update', () => {
    const plan = planImport(
      existing,
      backup([ic('e2', 'Hanne', { gender: 'dame' }), ic('c7', 'hanne', { phone: '12345678' })]),
      'merge',
      NOW,
      makeId
    );
    expect(plan.updateClients).toHaveLength(1);
    expect(plan.updateClients[0]).toMatchObject({ id: 'e2', gender: 'dame', phone: '12345678' });
  });
});

describe('merge – matching visits', () => {
  const existing: ExistingData = {
    clients: [client('e1', 'Morten')],
    visits: [visit('e1', 'Klip', '2026-09-01', { id: 'ev1', amountOre: 40_000, pay: 'kontant', note: 'Eksisterende' })],
    prices: new Map()
  };

  it('same id → duplicate, even when the content differs (existing wins)', () => {
    const plan = planImport(existing, backup([ic('e1', 'Morten')], [iv('ev1', 'e1', 'Farve', '2026-09-05', { amountOre: 99_900 })]), 'merge', NOW, makeId);
    expect(plan.insertVisits).toEqual([]);
    expect(plan.stats.duplicateVisits).toBe(1);
  });

  it('same client + date + treatment (any spelling) → duplicate', () => {
    const plan = planImport(existing, backup([ic('c1', 'morten')], [iv('v9', 'c1', ' KLIP ', '2026-09-01', { amountOre: 45_000 })]), 'merge', NOW, makeId);
    expect(plan.insertVisits).toEqual([]);
    expect(plan.stats).toMatchObject({ matchedClients: 1, newVisits: 0, duplicateVisits: 1 });
  });

  it('another date, treatment or client → new visit', () => {
    const plan = planImport(
      existing,
      backup(
        [ic('e1', 'Morten'), ic('c2', 'Hanne')],
        [iv('v1', 'e1', 'Klip', '2026-09-02'), iv('v2', 'e1', 'Skæg', '2026-09-01'), iv('v3', 'c2', 'Klip', '2026-09-01')]
      ),
      'merge',
      NOW,
      makeId
    );
    expect(plan.insertVisits.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(plan.stats).toMatchObject({ newVisits: 3, duplicateVisits: 0, newClients: 1 });
  });

  it('new visits get createdAt/updatedAt = now and a recomputed treatment key', () => {
    const plan = planImport(existing, backup([ic('e1', 'Morten')], [iv('v1', 'e1', 'Farve', '2026-09-10', { treatmentKey: 'WRONG' })]), 'merge', NOW, makeId);
    expect(plan.insertVisits[0]).toMatchObject({ treatmentKey: 'farve', createdAt: NOW, updatedAt: NOW });
  });

  it('a visit for a client that is not in the file is skipped defensively', () => {
    const plan = planImport(EMPTY, backup([ic('c1', 'A')], [iv('v1', 'ghost', 'Klip', '2026-09-01')]), 'merge', NOW, makeId);
    expect(plan.insertVisits).toEqual([]);
    expect(plan.stats).toMatchObject({ visitsInFile: 1, newVisits: 0, duplicateVisits: 0 });
  });

  it('duplicate signatures inside the file itself are imported once', () => {
    const plan = planImport(
      EMPTY,
      backup([ic('c1', 'A')], [iv('v1', 'c1', 'Klip', '2026-09-01'), iv('v2', 'c1', 'klip', '2026-09-01')]),
      'merge',
      NOW,
      makeId
    );
    expect(plan.insertVisits.map((v) => v.id)).toEqual(['v1']);
    expect(plan.stats.duplicateVisits).toBe(1);
  });
});

describe('merge – prices', () => {
  it('adds only prices the app does not have', () => {
    const existing: ExistingData = { clients: [], visits: [], prices: new Map([['klip', 40_000]]) };
    const plan = planImport(existing, backup([], [], [['klip', 45_000], ['farve', 90_000]]), 'merge', NOW, makeId);
    expect(plan.prices).toEqual([['farve', 90_000]]);
  });

  it('replace takes all prices from the file', () => {
    const existing: ExistingData = { clients: [], visits: [], prices: new Map([['klip', 40_000]]) };
    const plan = planImport(existing, backup([], [], [['klip', 45_000]]), 'replace', NOW, makeId);
    expect(plan.prices).toEqual([['klip', 45_000]]);
  });
});

describe('merge – preview numbers', () => {
  it('"12 kunder, 40 besøg – 3 nye kunder, 5 nye besøg" can be built from stats', () => {
    const existingClients: Client[] = Array.from({ length: 9 }, (_, i) => client(`e${i}`, `Kunde ${i}`));
    const existingVisits: Visit[] = Array.from({ length: 35 }, (_, i) => visit(`e${i % 9}`, 'Klip', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, { id: `ev${i}` }));
    const incomingClients = [...existingClients.map((c) => ic(c.id, c.name)), ic('n1', 'Ny 1'), ic('n2', 'Ny 2'), ic('n3', 'Ny 3')];
    const incomingVisits = [
      ...existingVisits.map((v) => iv(v.id, v.clientId, v.treatment, v.date)),
      iv('nv1', 'n1', 'Klip', '2026-09-01'),
      iv('nv2', 'n2', 'Klip', '2026-09-01'),
      iv('nv3', 'n3', 'Klip', '2026-09-01'),
      iv('nv4', 'e1', 'Farve', '2026-09-02'),
      iv('nv5', 'e2', 'Farve', '2026-09-03')
    ];
    const plan = planImport({ clients: existingClients, visits: existingVisits, prices: new Map() }, backup(incomingClients, incomingVisits), 'merge', NOW, makeId);
    expect(plan.stats).toEqual({ clientsInFile: 12, visitsInFile: 40, newClients: 3, matchedClients: 9, newVisits: 5, duplicateVisits: 35 });
  });
});
