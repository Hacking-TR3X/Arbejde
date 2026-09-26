import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CLIENTS,
  MAX_FILE_CHARS,
  MAX_PRICES,
  MAX_VISITS,
  readBackupText,
  type ParsedBackup,
  type ReadResult
} from './validate';
import { isValidISODate } from '../dates';
import { MAX_AMOUNT_ORE } from '../money';
import { LIMITS, treatmentKey } from '../text';
import { isGender, isPayMethod, isValidId } from '../types';
import { fixtureText, rng } from '../../../tests/helpers/factories';

const NOT_A_BACKUP = 'Filen er ikke en backup fra Saloona eller Salonbog.';
const TOO_BIG = 'Filen er for stor til at være en backup.';
const TOO_MANY = 'Filen indeholder flere kunder eller besøg, end appen kan håndtere.';
const BROKEN_ENVELOPE = 'Den krypterede backup er beskadiget.';

function read(input: unknown): ReadResult {
  return readBackupText(typeof input === 'string' ? input : JSON.stringify(input));
}

function plain(input: unknown): ParsedBackup {
  const r = read(input);
  if (r.kind !== 'plain') throw new Error(`expected plain, got ${JSON.stringify(r).slice(0, 200)}`);
  return r.backup;
}

function error(input: unknown): string {
  const r = read(input);
  if (r.kind !== 'error') throw new Error(`expected error, got ${r.kind}`);
  return r.error;
}

type Json = Record<string, unknown>;

/** A minimal, valid prototype file; override parts per test. */
function file(over: Json = {}): Json {
  return {
    app: 'salonbog',
    version: 1,
    exported: '2026-09-26T08:15:00.000Z',
    clients: [{ id: 'c1', name: 'Morgan', gender: 'herre', note: '' }],
    visits: [{ id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-09-26', note: '' }],
    prices: {},
    ...over
  };
}

function withVisit(v: Json): Json {
  return file({ visits: [{ id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-09-26', note: '', ...v }] });
}

function withClient(c: Json, source: 'salonbog' | 'saloona' = 'salonbog'): Json {
  return file({ app: source, clients: [{ id: 'c1', name: 'Morgan', note: '', ...c }] });
}

function assertNotPolluted() {
  const probe: Record<string, unknown> = {};
  expect(probe.polluted).toBeUndefined();
  expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect(({} as Record<string, unknown>).name).toBeUndefined();
  expect(({} as Record<string, unknown>).amount).toBeUndefined();
}

afterEach(() => {
  // Safety net: if a test ever pollutes the prototype, clean up so other tests are not affected.
  delete (Object.prototype as Record<string, unknown>).polluted;
});

describe('prototype backup (tests/fixtures/salonbog-backup.json)', () => {
  const b = plain(fixtureText('salonbog-backup.json'));

  it('is read as a Salonbog file without warnings', () => {
    expect(b.source).toBe('salonbog');
    expect(b.exported).toBe('2026-09-26T08:15:00.000Z');
    expect(b.clients).toHaveLength(13);
    expect(b.visits).toHaveLength(28);
    expect(b.warnings).toEqual([]);
  });

  it('keeps names, genders and the prototype’s short note as a tag', () => {
    const byName = new Map(b.clients.map((c) => [c.name, c]));
    expect(byName.get('Holger')).toEqual({ id: 'c01', name: 'Holger', gender: 'herre', tag: null, phone: null, note: '' });
    expect(byName.get('Theo')).toMatchObject({ gender: 'herre', tag: 'Barn', note: '' });
    expect(byName.get('Grete')?.gender).toBe('dame');
    expect(byName.get('Oldemor')).toMatchObject({
      tag: null,
      note: 'Vil helst have tid om formiddagen. Tåler ikke parfumeret shampoo.'
    });
    expect(byName.get('Gammel nabo')?.gender).toBe('dame');
    expect(byName.get('Familie Søby')).toMatchObject({ gender: null, tag: null, note: 'Mor, far og de to drenge' });
  });

  it('converts amounts to øre and keeps payment methods', () => {
    const byId = new Map(b.visits.map((v) => [v.id, v]));
    expect(byId.get('v21')).toEqual({
      id: 'v21',
      clientId: 'c08',
      treatment: 'Farve',
      treatmentKey: 'farve',
      time: null,
      date: '2026-06-26',
      amountOre: 125_050,
      pay: 'mp_mig',
      note: 'Lidt mørkere end sidst'
    });
    expect(byId.get('v05')).toMatchObject({ amountOre: 45_000, pay: 'kontant' });
    expect(byId.get('v01')).toMatchObject({ amountOre: null, pay: null });
    expect(byId.get('v22')).toMatchObject({ date: '2026-10-02', amountOre: null }); // booked
  });

  it('cleans treatment spellings but keeps them grouped', () => {
    const v11 = b.visits.find((v) => v.id === 'v11')!;
    expect(v11.treatment).toBe('klip'); // "klip " trimmed
    expect(v11.treatmentKey).toBe('klip');
    expect(new Set(b.visits.filter((v) => v.clientId === 'c04').map((v) => v.treatmentKey))).toEqual(new Set(['klip']));
  });

  it('reads the default prices', () => {
    expect([...b.prices]).toEqual([
      ['klip', 45_000],
      ['farve', 90_000]
    ]);
  });
});

describe('older prototype file without app, amount, pay and prices', () => {
  const b = plain(fixtureText('salonbog-backup-old.json'));

  it('is accepted without warnings', () => {
    expect(b.source).toBe('salonbog');
    expect(b.clients).toHaveLength(4);
    expect(b.visits).toHaveLength(5);
    expect(b.prices.size).toBe(0);
    expect(b.warnings).toEqual([]);
    expect(b.visits.every((v) => v.amountOre === null && v.pay === null)).toBe(true);
    expect(b.clients.find((c) => c.name === 'Theo')?.tag).toBe('Barn');
  });

  it('accepts a file without version and exported', () => {
    const r = plain({ clients: [{ id: 'a', name: 'A' }], visits: [] });
    expect(r.exported).toBeNull();
    expect(r.clients).toEqual([{ id: 'a', name: 'A', gender: null, tag: null, phone: null, note: '' }]);
  });
});

describe('prototype note → tag', () => {
  it.each([
    ['Barn', 'Barn', ''],
    ['  Barn  ', 'Barn', ''],
    ['Barn.', 'Barn.', ''],
    ['Ærø-pige', 'Ærø-pige', ''],
    ['x'.repeat(16), 'x'.repeat(16), ''],
    ['x'.repeat(17), null, 'x'.repeat(17)],
    ['Kort hår', null, 'Kort hår'], // two words stay a note
    ['Ikke parfume', null, 'Ikke parfume'],
    ['Barn\tx', null, 'Barn\tx'],
    ['Barn af Grete', null, 'Barn af Grete'],
    ['Barn\nallergisk', null, 'Barn\nallergisk'],
    ['', null, '']
  ])('%j → tag %j, note %j', (note, tag, rest) => {
    const c = plain(withClient({ note })).clients[0]!;
    expect(c.tag).toBe(tag);
    expect(c.note).toBe(rest);
  });

  it('a Saloona file keeps a short note as a note', () => {
    const c = plain(withClient({ note: 'Barn' }, 'saloona')).clients[0]!;
    expect(c.tag).toBeNull();
    expect(c.note).toBe('Barn');
  });
});

describe('Saloona-only fields', () => {
  it('reads tag and phone from a Saloona file', () => {
    const c = plain(withClient({ tag: '  Barn ', phone: '+45 12 34 56 78' }, 'saloona')).clients[0]!;
    expect(c.tag).toBe('Barn');
    expect(c.phone).toBe('+4512345678');
  });

  it('cuts a long tag and drops an empty one', () => {
    expect(plain(withClient({ tag: 'x'.repeat(100) }, 'saloona')).clients[0]!.tag).toHaveLength(LIMITS.tag);
    expect(plain(withClient({ tag: '   ' }, 'saloona')).clients[0]!.tag).toBeNull();
    expect(plain(withClient({ tag: 42 }, 'saloona')).clients[0]!.tag).toBeNull();
  });

  it('drops an invalid phone number with a warning', () => {
    for (const phone of ['javascript:alert(1)', 'tel:12345678', '12345678?body=x', '1'.repeat(100)]) {
      const b = plain(withClient({ phone }, 'saloona'));
      expect(b.clients[0]!.phone).toBeNull();
      expect(b.warnings).toEqual(['1 telefonnummer var ugyldigt og blev fjernet']);
    }
  });

  it('accepts a phone number stored as a whole number', () => {
    expect(plain(withClient({ phone: 12345678 }, 'saloona')).clients[0]!.phone).toBe('12345678');
    expect(plain(withClient({ phone: 4512345678 }, 'saloona')).clients[0]!.phone).toBe('4512345678');
    const short = plain(withClient({ phone: 12 }, 'saloona'));
    expect(short.clients[0]!.phone).toBeNull();
    expect(short.warnings).toEqual(['1 telefonnummer var ugyldigt og blev fjernet']);
  });

  it('drops other phone types silently (documented)', () => {
    for (const phone of [12345678.5, 2 ** 53, true, {}, ['12345678']]) {
      const b = plain(withClient({ phone }, 'saloona'));
      expect(b.clients[0]!.phone).toBeNull();
      expect(b.warnings).toEqual([]);
    }
  });

  it('ignores tag and phone in a prototype file', () => {
    const c = plain(withClient({ tag: 'VIP', phone: '12345678' }, 'salonbog')).clients[0]!;
    expect(c.tag).toBeNull();
    expect(c.phone).toBeNull();
  });
});

describe('structural errors reject the whole file', () => {
  it.each(['', 'not json', '{', '{"clients": [}', '{"clients": [], "visits": [], }', "{'clients': []}", '{"visits":[{"amount": NaN}], "clients": []}'])(
    'invalid JSON %j',
    (text) => {
      expect(error(text)).toBe(NOT_A_BACKUP);
    }
  );

  it.each(['[]', '[{"app":"salonbog","clients":[],"visits":[]}]', 'null', '42', '"hello"', 'true'])('root is not an object: %s', (text) => {
    expect(error(text)).toBe(NOT_A_BACKUP);
  });

  it.each(['loopcast', 'SALONBOG', 'Saloona', 1, null, true, ['salonbog']])('wrong app %j', (app) => {
    expect(error(file({ app }))).toBe(NOT_A_BACKUP);
  });

  it('missing or wrongly typed clients/visits', () => {
    expect(error({ app: 'salonbog', visits: [] })).toBe(NOT_A_BACKUP);
    expect(error({ app: 'salonbog', clients: [] })).toBe(NOT_A_BACKUP);
    expect(error(file({ clients: {} }))).toBe(NOT_A_BACKUP);
    expect(error(file({ visits: 'none' }))).toBe(NOT_A_BACKUP);
    expect(error(file({ clients: null }))).toBe(NOT_A_BACKUP);
  });

  it('clients/visits hidden behind __proto__ are not found', () => {
    expect(error('{"__proto__": {"clients": [], "visits": []}}')).toBe(NOT_A_BACKUP);
  });

  it('accepts a UTF-8 BOM and surrounding whitespace', () => {
    const text = JSON.stringify(file());
    expect(plain(`﻿${text}`).clients).toHaveLength(1);
    expect(plain(`\n  ${text}  \n`).clients).toHaveLength(1);
  });
});

describe('size limits', () => {
  it('rejects a file longer than MAX_FILE_CHARS before parsing', () => {
    const text = JSON.stringify(file({ pad: 'x'.repeat(MAX_FILE_CHARS) }));
    expect(text.length).toBeGreaterThan(MAX_FILE_CHARS);
    expect(error(text)).toBe(TOO_BIG);
  });

  it('accepts a valid file of exactly MAX_FILE_CHARS', () => {
    const base = JSON.stringify(file({ pad: '' }));
    const text = base.replace('"pad":""', `"pad":"${'x'.repeat(MAX_FILE_CHARS - base.length)}"`);
    expect(text.length).toBe(MAX_FILE_CHARS);
    expect(plain(text).clients).toHaveLength(1);
  });

  it('rejects more than MAX_CLIENTS clients', () => {
    const text = `{"app":"salonbog","clients":[${Array(MAX_CLIENTS + 1).fill('{}').join(',')}],"visits":[]}`;
    expect(error(text)).toBe(TOO_MANY);
  });

  it('rejects more than MAX_VISITS visits', () => {
    const text = `{"app":"salonbog","clients":[],"visits":[${Array(MAX_VISITS + 1).fill('0').join(',')}]}`;
    expect(error(text)).toBe(TOO_MANY);
  });

  it('accepts exactly MAX_CLIENTS clients', () => {
    const clients = Array.from({ length: MAX_CLIENTS }, (_, i) => ({ id: `c${i}`, name: `Kunde ${i}` }));
    const b = plain({ app: 'salonbog', clients, visits: [] });
    expect(b.clients).toHaveLength(MAX_CLIENTS);
  });

  it('cuts huge strings to the field limits', () => {
    const b = plain(
      file({
        clients: [{ id: 'c1', name: 'N'.repeat(100_000), note: 'n'.repeat(1_000_000) }],
        visits: [{ id: 'v1', clientId: 'c1', treatment: 'T'.repeat(100_000), date: '2026-09-26', note: 'x'.repeat(1_000_000) }],
        exported: 'e'.repeat(1000)
      })
    );
    expect(b.clients[0]!.name).toHaveLength(LIMITS.name);
    expect(b.clients[0]!.note).toHaveLength(LIMITS.note);
    expect(b.visits[0]!.treatment).toHaveLength(LIMITS.treatment);
    expect(b.visits[0]!.treatmentKey).toBe(treatmentKey(b.visits[0]!.treatment));
    expect(b.visits[0]!.note).toHaveLength(LIMITS.note);
    expect(b.exported).toBeNull();
  });

  it('ids of 65–128 characters get a derived safe id; longer ids are rejected', () => {
    const b = plain(
      file({
        clients: [
          { id: 'x'.repeat(65), name: 'A' },
          { id: 'y'.repeat(128), name: 'B' },
          { id: 'z'.repeat(129), name: 'C' }
        ],
        visits: [{ id: 'v1', clientId: 'y'.repeat(128), treatment: 'Klip', date: '2026-09-26' }]
      })
    );
    expect(b.clients.map((c) => c.name)).toEqual(['A', 'B']);
    for (const c of b.clients) expect(c.id).toMatch(/^k[0-9a-z]+(_\d+)?$/);
    expect(b.visits[0]!.clientId).toBe(b.clients[1]!.id);
    expect(b.warnings).toEqual(['1 kunde uden gyldigt id eller navn blev sprunget over']);
  });

  it('survives very deep nesting without a stack overflow', () => {
    const depth = 100_000;
    const text = `{"app":"salonbog","clients":[],"visits":[],"prices":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    expect(() => readBackupText(text)).not.toThrow();
    expect(plain(text).warnings).toEqual(['1 standardpris var ugyldig og blev sprunget over']);
  });
});

describe('bad clients are skipped with a Danish warning', () => {
  it('entries that are not objects, have no valid id or no name', () => {
    const b = plain(
      file({
        clients: [
          { id: 'c1', name: 'Morgan' },
          null,
          'Grete',
          42,
          ['c9', 'Ingrid'],
          { name: 'Uden id' },
          { id: '', name: 'Tomt id' },
          { id: null, name: 'Null-id' },
          { id: 1.5, name: 'Brøk-id' },
          { id: 2 ** 53, name: 'For stort tal-id' },
          { id: true, name: 'Bool-id' },
          { id: {}, name: 'Objekt-id' },
          { id: 'z'.repeat(129), name: 'Langt id' },
          { id: 'c2', name: '' },
          { id: 'c3', name: '   ' },
          { id: 'c4', name: 42 },
          { id: 'c5' }
        ],
        visits: []
      })
    );
    expect(b.clients.map((c) => c.id)).toEqual(['c1']);
    expect(b.warnings).toEqual(['16 kunder uden gyldigt id eller navn blev sprunget over']);
  });

  it('a duplicated id: the first one is kept', () => {
    const b = plain(file({ clients: [{ id: 'c1', name: 'Morgan' }, { id: 'c1', name: 'Anden Morgan' }], visits: [] }));
    expect(b.clients.map((c) => c.name)).toEqual(['Morgan']);
    expect(b.warnings).toEqual(['1 kunde stod der to gange og blev kun taget med én gang']);
  });

  it('an unknown gender is removed', () => {
    const b = plain(withClient({ gender: 'mand' }));
    expect(b.clients[0]!.gender).toBeNull();
    expect(b.warnings).toEqual(['1 kunde havde et ukendt køn, som blev fjernet']);
    for (const g of ['', null, undefined]) {
      const ok = plain(withClient({ gender: g }));
      expect(ok.clients[0]!.gender).toBeNull();
      expect(ok.warnings).toEqual([]);
    }
    expect(plain(withClient({ gender: 'Dame' })).warnings).toEqual(['1 kunde havde et ukendt køn, som blev fjernet']);
  });

  it('control and bidi characters are removed from names and notes', () => {
    const c = plain(withClient({ name: 'Mor\u202egan\u0000', note: 'Linje 1\r\nLinje 2⁦' })).clients[0]!;
    expect(c.name).toBe('Morgan');
    expect(c.note).toBe('Linje 1\nLinje 2');
  });

  it('ignores unknown fields', () => {
    const b = plain(file({ clients: [{ id: 'c1', name: 'Morgan', color: '#f00', created: 1 }], extra: { a: 1 } }));
    expect(b.clients[0]).toEqual({ id: 'c1', name: 'Morgan', gender: null, tag: null, phone: null, note: '' });
    expect(b.warnings).toEqual([]);
  });
});

describe('bad visits are skipped with a Danish warning', () => {
  it.each(['2026-02-30', '2026-02-29', '2100-02-29', '2026-9-1', '26-09-2026', '2026-09-26T10:00:00Z', '', 20260926, null])(
    'invalid date %j',
    (date) => {
      const b = plain(withVisit({ date }));
      expect(b.visits).toEqual([]);
      expect(b.warnings).toEqual(['1 besøg med ugyldig dato blev sprunget over']);
    }
  );

  it('missing date', () => {
    const b = plain(file({ visits: [{ id: 'v1', clientId: 'c1', treatment: 'Klip' }] }));
    expect(b.warnings).toEqual(['1 besøg med ugyldig dato blev sprunget over']);
  });

  it('accepts 2028-02-29', () => {
    expect(plain(withVisit({ date: '2028-02-29' })).visits[0]!.date).toBe('2028-02-29');
  });

  it('missing or invalid id, clientId or treatment', () => {
    const b = plain(
      file({
        visits: [
          null,
          'v1',
          { clientId: 'c1', treatment: 'Klip', date: '2026-09-26' },
          { id: '', clientId: 'c1', treatment: 'Klip', date: '2026-09-26' },
          { id: 1.5, clientId: 'c1', treatment: 'Klip', date: '2026-09-26' },
          { id: 'v2', clientId: {}, treatment: 'Klip', date: '2026-09-26' },
          { id: 'v2b', treatment: 'Klip', date: '2026-09-26' },
          { id: 'v3', clientId: 'c1', treatment: '', date: '2026-09-26' },
          { id: 'v4', clientId: 'c1', treatment: '   ', date: '2026-09-26' },
          { id: 'v5', clientId: 'c1', treatment: 42, date: '2026-09-26' },
          { id: 'v6', clientId: 'c1', date: '2026-09-26' }
        ]
      })
    );
    expect(b.visits).toEqual([]);
    expect(b.warnings).toEqual(['11 besøg med manglende eller ugyldige felter blev sprunget over']);
  });

  it('a visit whose clientId has an unusual format but matches no client is an orphan', () => {
    const b = plain(withVisit({ clientId: 'c 1' }));
    expect(b.visits).toEqual([]);
    expect(b.warnings).toEqual(['1 besøg hørte ikke til nogen kunde og blev sprunget over']);
  });

  it('a visit for an unknown client', () => {
    const b = plain(withVisit({ clientId: 'ghost' }));
    expect(b.visits).toEqual([]);
    expect(b.warnings).toEqual(['1 besøg hørte ikke til nogen kunde og blev sprunget over']);
  });

  it('a visit for a client that was itself skipped is an orphan', () => {
    const b = plain(file({ clients: [{ id: 'c1', name: '' }] }));
    expect(b.visits).toEqual([]);
    expect(b.warnings).toEqual([
      '1 kunde uden gyldigt id eller navn blev sprunget over',
      '1 besøg hørte ikke til nogen kunde og blev sprunget over'
    ]);
  });

  it('a duplicated visit id: the first one is kept', () => {
    const b = plain(
      file({
        visits: [
          { id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-09-01' },
          { id: 'v1', clientId: 'c1', treatment: 'Farve', date: '2026-09-02' }
        ]
      })
    );
    expect(b.visits.map((v) => v.treatment)).toEqual(['Klip']);
    expect(b.warnings).toEqual(['1 besøg stod der to gange og blev kun taget med én gang']);
  });

  it('counts warnings per kind', () => {
    const b = plain(
      file({
        visits: [
          { id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-02-30' },
          { id: 'v2', clientId: 'c1', treatment: 'Klip', date: '2026-02-31' },
          { id: 'v3', clientId: 'c1', treatment: 'Klip', date: '2026-13-01' },
          { id: 'v4', clientId: 'x', treatment: 'Klip', date: '2026-09-01' },
          { id: 'v5', clientId: 'c1', treatment: 'Klip', date: '2026-09-01', pay: 'kort' },
          { id: 'v6', clientId: 'c1', treatment: 'Klip', date: '2026-09-02', pay: 'visa' }
        ]
      })
    );
    expect(b.visits.map((v) => v.id)).toEqual(['v5', 'v6']);
    expect(b.warnings).toEqual([
      '3 besøg med ugyldig dato blev sprunget over',
      '1 besøg hørte ikke til nogen kunde og blev sprunget over',
      '2 betalingsmåder var ukendte og blev fjernet'
    ]);
  });
});

describe('amounts', () => {
  it.each([
    [450, 45_000],
    [1250.5, 125_050],
    [0, 0],
    [1_000_000, MAX_AMOUNT_ORE],
    [null, null],
    [undefined, null]
  ])('amount %j → %j øre, no warning', (amount, ore) => {
    const b = plain(withVisit({ amount }));
    expect(b.visits[0]!.amountOre).toBe(ore);
    expect(b.warnings).toEqual([]);
  });

  it('accepts a numeric string such as "450" or "1.250,50" (lenient on purpose)', () => {
    // The prototype read amounts from text fields; a string that parses as a Danish
    // amount is kept. Only strings that do not parse are dropped.
    expect(plain(withVisit({ amount: '450' })).visits[0]!.amountOre).toBe(45_000);
    expect(plain(withVisit({ amount: '1.250,50' })).visits[0]!.amountOre).toBe(125_050);
    expect(plain(withVisit({ amount: '450 kr.' })).visits[0]!.amountOre).toBe(45_000);
    expect(plain(withVisit({ amount: '' })).visits[0]!.amountOre).toBeNull();
  });

  it.each([-50, -0.01, 1_000_000.01, 1e12, '-50', 'abc', 'NaN', 'Infinity', '12,345', '1'.repeat(21), true, {}, [450]])(
    'invalid amount %j is removed, the visit is kept',
    (amount) => {
      const b = plain(withVisit({ amount }));
      expect(b.visits).toHaveLength(1);
      expect(b.visits[0]!.amountOre).toBeNull();
      expect(b.warnings).toEqual(['1 beløb var ugyldigt og blev fjernet']);
    }
  );

  it('1e400 in the file (Infinity after parsing) is removed', () => {
    const text =
      '{"app":"salonbog","clients":[{"id":"c1","name":"Morgan"}],' +
      '"visits":[{"id":"v1","clientId":"c1","treatment":"Klip","date":"2026-09-26","amount":1e400}]}';
    const b = plain(text);
    expect(b.visits[0]!.amountOre).toBeNull();
    expect(b.warnings).toEqual(['1 beløb var ugyldigt og blev fjernet']);
  });

  it('unknown pay is removed, known pay is kept', () => {
    for (const pay of ['kontant', 'mp_mig', 'mp_noah'] as const) {
      expect(plain(withVisit({ pay })).visits[0]!.pay).toBe(pay);
    }
    for (const pay of ['kort', 'Kontant', 'MobilePay', 1, true]) {
      const b = plain(withVisit({ pay }));
      expect(b.visits[0]!.pay).toBeNull();
      expect(b.warnings).toEqual(['1 betalingsmåde var ukendt og blev fjernet']);
    }
    for (const pay of ['', null, undefined]) {
      expect(plain(withVisit({ pay })).warnings).toEqual([]);
    }
  });
});

describe('prices', () => {
  it('normalises keys and converts to øre', () => {
    const b = plain(file({ prices: { 'Klip ': 450, FARVE: 900.5, 'Farve + klip': 1100 } }));
    expect([...b.prices]).toEqual([
      ['klip', 45_000],
      ['farve', 90_050],
      ['farve + klip', 110_000]
    ]);
  });

  it('accepts amounts written as text', () => {
    const b = plain(file({ prices: { klip: '450', farve: '1.250,50', permanent: '700 kr.', skæg: ' 99,95 ' } }));
    expect(Object.fromEntries(b.prices)).toEqual({ klip: 45_000, farve: 125_050, permanent: 70_000, skæg: 9_995 });
    expect(b.warnings).toEqual([]);
  });

  it.each([
    [{ klip: -1 }],
    [{ klip: 'abc' }],
    [{ klip: '-50' }],
    [{ klip: '' }],
    [{ klip: '12,345' }],
    [{ klip: '1'.repeat(21) }],
    [{ klip: '1.250.000' }],
    [{ klip: null }],
    [{ klip: {} }],
    [{ klip: 2_000_000 }],
    [{ '': 450 }],
    [{ '   ': 450 }]
  ])('invalid entry %j is skipped with a warning', (prices) => {
    const b = plain(file({ prices }));
    expect(b.prices.size).toBe(0);
    expect(b.warnings).toEqual(['1 standardpris var ugyldig og blev sprunget over']);
  });

  it.each([[['klip', 450]], ['klip'], [42], [true]])('prices of the wrong type (%j) give one warning', (prices) => {
    const b = plain(file({ prices }));
    expect(b.prices.size).toBe(0);
    expect(b.warnings).toEqual(['1 standardpris var ugyldig og blev sprunget over']);
  });

  it('missing or null prices are fine', () => {
    expect(plain(file({ prices: null })).warnings).toEqual([]);
    const { prices: _drop, ...noPrices } = file();
    expect(plain(noPrices).prices.size).toBe(0);
  });

  it(`reads at most MAX_PRICES (${MAX_PRICES}) entries and says how many were skipped`, () => {
    const prices = Object.fromEntries(Array.from({ length: MAX_PRICES + 500 }, (_, i) => [`behandling ${i}`, 100]));
    const b = plain(file({ prices }));
    expect(b.prices.size).toBe(MAX_PRICES);
    expect(b.prices.has('behandling 0')).toBe(true);
    expect(b.prices.has(`behandling ${MAX_PRICES}`)).toBe(false);
    expect(b.warnings).toEqual([`500 standardpriser ud over de første ${MAX_PRICES} blev sprunget over`]);
  });

  it('one price too many gives a singular warning; exactly MAX_PRICES gives none', () => {
    const make = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${i}`, 100]));
    expect(plain(file({ prices: make(MAX_PRICES + 1) })).warnings).toEqual([`1 standardpris ud over de første ${MAX_PRICES} blev sprunget over`]);
    expect(plain(file({ prices: make(MAX_PRICES) })).warnings).toEqual([]);
  });
});

describe('prototype pollution', () => {
  const HOSTILE = `{
    "__proto__": { "polluted": true, "clients": [], "name": "Hacker" },
    "constructor": { "prototype": { "polluted": true } },
    "app": "salonbog",
    "clients": [
      { "id": "c1", "name": "Morgan", "__proto__": { "polluted": true, "gender": "dame", "tag": "x" } },
      { "id": "c2", "__proto__": { "name": "Uden navn" } },
      { "id": "__proto__", "name": "Proto" },
      { "id": "constructor", "name": "Constructor" }
    ],
    "visits": [
      { "id": "v1", "clientId": "c1", "treatment": "Klip", "date": "2026-09-26", "__proto__": { "amount": 999, "pay": "kontant" } },
      { "id": "v2", "clientId": "__proto__", "treatment": "Klip", "date": "2026-09-26", "constructor": { "prototype": { "polluted": true } } }
    ],
    "prices": {
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "prototype": 100,
      "klip": 450
    }
  }`;

  it('does not pollute Object.prototype at any level', () => {
    const b = plain(HOSTILE);
    assertNotPolluted();
    expect(b.clients.map((c) => c.name)).toEqual(['Morgan', 'Proto', 'Constructor']);
  });

  it('never reads inherited values', () => {
    const b = plain(HOSTILE);
    const morgan = b.clients.find((c) => c.id === 'c1')!;
    expect(morgan.gender).toBeNull();
    expect(morgan.tag).toBeNull();
    const v1 = b.visits.find((v) => v.id === 'v1')!;
    expect(v1.amountOre).toBeNull();
    expect(v1.pay).toBeNull();
    expect(b.warnings).toEqual(['1 kunde uden gyldigt id eller navn blev sprunget over']);
  });

  it('skips __proto__ / constructor / prototype price keys silently', () => {
    const b = plain(HOSTILE);
    expect([...b.prices]).toEqual([['klip', 45_000]]);
    expect(b.prices instanceof Map).toBe(true);
  });

  it('client ids "__proto__" and "constructor" are replaced by derived ids, links kept', () => {
    const b = plain(HOSTILE);
    const proto = b.clients.find((c) => c.name === 'Proto')!;
    const ctor = b.clients.find((c) => c.name === 'Constructor')!;
    for (const c of [proto, ctor]) {
      expect(c.id).toMatch(/^k[0-9a-z]+(_\d+)?$/);
      expect(isValidId(c.id)).toBe(true);
    }
    expect(proto.id).not.toBe(ctor.id);
    expect(b.visits.find((v) => v.id === 'v2')?.clientId).toBe(proto.id);
  });
});

describe('encrypted envelope', () => {
  const env = (over: Json = {}, kdf: Json = {}, cipher: Json = {}): Json => ({
    app: 'saloona',
    format: 'encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', ...kdf },
    cipher: { name: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', ...cipher },
    data: 'SGVsbG8gd29ybGQ=',
    ...over
  });

  it('a valid envelope is recognised', () => {
    const r = read(env());
    expect(r.kind).toBe('encrypted');
    if (r.kind === 'encrypted') {
      expect(r.envelope).toEqual(env());
    }
  });

  it('extra fields are not copied into the envelope', () => {
    const r = read(env({ extra: 1 }, { extra: 2 }));
    expect(r.kind).toBe('encrypted');
    if (r.kind === 'encrypted') expect(r.envelope).toEqual(env());
  });

  it.each([
    ['iterations too low', env({}, { iterations: 99_999 })],
    ['iterations too high', env({}, { iterations: 5_000_001 })],
    ['iterations not an integer', env({}, { iterations: 600_000.5 })],
    ['iterations as string', env({}, { iterations: '600000' })],
    ['iterations missing', env({}, { iterations: undefined })],
    ['wrong kdf', env({}, { name: 'scrypt' })],
    ['wrong hash', env({}, { hash: 'SHA-1' })],
    ['salt not base64', env({}, { salt: 'not base64!' })],
    ['salt too long', env({}, { salt: 'A'.repeat(65) })],
    ['salt empty', env({}, { salt: '' })],
    ['wrong cipher', env({}, {}, { name: 'AES-CBC' })],
    ['iv not base64', env({}, {}, { iv: '<script>' })],
    ['iv too long', env({}, {}, { iv: 'A'.repeat(33) })],
    ['data not base64', env({ data: 'hello world' })],
    ['data empty', env({ data: '' })],
    ['data missing', env({ data: undefined })],
    ['kdf is an array', env({ kdf: [] })],
    ['cipher missing', env({ cipher: undefined })],
    ['version 2', env({ version: 2 })],
    ['app salonbog', env({ app: 'salonbog' })],
    ['app missing', env({ app: undefined })]
  ])('%s → rejected', (_label, e) => {
    const r = read(e);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect([BROKEN_ENVELOPE, NOT_A_BACKUP]).toContain(r.error);
  });

  it('a damaged envelope gives the Danish "beskadiget" message', () => {
    expect(error(env({}, { iterations: 1 }))).toBe(BROKEN_ENVELOPE);
  });
});

describe('fuzz: any mutation of a valid file is handled without throwing', () => {
  const junk: unknown[] = [
    '',
    ' ',
    'x'.repeat(300),
    null,
    0,
    -1,
    1.5,
    1e15,
    true,
    [],
    {},
    [1, 2],
    { a: 1 },
    '__proto__',
    'constructor',
    '2026-02-30',
    '2028-02-29',
    'kontant',
    'dame',
    'c1',
    'v1',
    '‮\u0000',
    '450',
    '-50',
    'Barn'
  ];
  const base = JSON.parse(fixtureText('salonbog-backup.json')) as {
    clients: Json[];
    visits: Json[];
    prices: Json;
  };

  it('keeps every invariant over 400 random files', () => {
    const rand = rng(20260926);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    for (let round = 0; round < 400; round++) {
      const f = structuredClone(base) as { clients: Json[]; visits: Json[]; prices: Json; app?: unknown };
      const mutations = 1 + Math.floor(rand() * 8);
      for (let m = 0; m < mutations; m++) {
        const target = rand();
        if (target < 0.4) {
          const c = pick(f.clients);
          c[pick(['id', 'name', 'gender', 'note', 'tag', 'phone'])] = pick(junk);
        } else if (target < 0.85) {
          const v = pick(f.visits);
          v[pick(['id', 'clientId', 'treatment', 'date', 'note', 'amount', 'pay'])] = pick(junk);
        } else if (target < 0.95) {
          f.prices[String(pick(junk))] = pick(junk);
        } else {
          f.app = pick(['salonbog', 'saloona', undefined]);
        }
      }
      let r: ReadResult;
      expect(() => (r = readBackupText(JSON.stringify(f)))).not.toThrow();
      r = readBackupText(JSON.stringify(f));
      expect(r.kind).toBe('plain');
      if (r.kind !== 'plain') continue;
      const b = r.backup;
      const ids = new Set<string>();
      for (const c of b.clients) {
        expect(isValidId(c.id)).toBe(true);
        expect(ids.has(c.id)).toBe(false);
        ids.add(c.id);
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.name.length).toBeLessThanOrEqual(LIMITS.name);
        expect(c.gender === null || isGender(c.gender)).toBe(true);
        expect(c.tag === null || (c.tag.length > 0 && c.tag.length <= LIMITS.tag)).toBe(true);
        expect(c.note.length).toBeLessThanOrEqual(LIMITS.note);
        expect(c.phone === null || /^\+?\d{3,15}$/.test(c.phone)).toBe(true);
      }
      const visitIds = new Set<string>();
      for (const v of b.visits) {
        expect(isValidId(v.id)).toBe(true);
        expect(visitIds.has(v.id)).toBe(false);
        visitIds.add(v.id);
        expect(ids.has(v.clientId)).toBe(true);
        expect(isValidISODate(v.date)).toBe(true);
        expect(v.treatment.length).toBeGreaterThan(0);
        expect(v.treatment.length).toBeLessThanOrEqual(LIMITS.treatment);
        expect(v.treatmentKey).toBe(treatmentKey(v.treatment));
        expect(v.amountOre === null || (Number.isSafeInteger(v.amountOre) && v.amountOre >= 0 && v.amountOre <= MAX_AMOUNT_ORE)).toBe(true);
        expect(v.pay === null || isPayMethod(v.pay)).toBe(true);
        expect(v.note.length).toBeLessThanOrEqual(LIMITS.note);
      }
      for (const [k, ore] of b.prices) {
        expect(k.length).toBeGreaterThan(0);
        expect(['__proto__', 'constructor', 'prototype']).not.toContain(k);
        expect(Number.isSafeInteger(ore) && ore >= 0 && ore <= MAX_AMOUNT_ORE).toBe(true);
      }
      for (const w of b.warnings) expect(w).toMatch(/^\d+ \S/);
      assertNotPolluted();
    }
  });
});

describe('Danish grammar in warnings', () => {
  // Fixed (was BUG Lav): singular warnings now use the singular adjective.
  it('singular warnings use the singular adjective', () => {
    const b = plain(
      file({
        app: 'saloona',
        clients: [{ id: 'c1', name: 'Morgan', phone: 'abc' }],
        visits: [{ id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-09-26', amount: -1, pay: 'kort' }],
        prices: { klip: -1 }
      })
    );
    expect(b.warnings).toEqual([
      '1 telefonnummer var ugyldigt og blev fjernet',
      '1 beløb var ugyldigt og blev fjernet',
      '1 betalingsmåde var ukendt og blev fjernet',
      '1 standardpris var ugyldig og blev sprunget over'
    ]);
  });

  it('plural warnings keep the plural adjective', () => {
    const b = plain(
      file({
        app: 'saloona',
        clients: [
          { id: 'c1', name: 'Morgan', phone: 'abc' },
          { id: 'c2', name: 'Grete', phone: 'tel:1' }
        ],
        visits: [
          { id: 'v1', clientId: 'c1', treatment: 'Klip', date: '2026-09-26', amount: -1, pay: 'kort' },
          { id: 'v2', clientId: 'c2', treatment: 'Klip', date: '2026-09-26', amount: 'abc', pay: 'visa' }
        ],
        prices: { klip: -1, farve: 'x' }
      })
    );
    expect(b.warnings).toEqual([
      '2 telefonnumre var ugyldige og blev fjernet',
      '2 beløb var ugyldige og blev fjernet',
      '2 betalingsmåder var ukendte og blev fjernet',
      '2 standardpriser var ugyldige og blev sprunget over'
    ]);
  });
});

describe('ids from other apps', () => {
  it('safe-format ids are kept exactly', () => {
    const b = plain(fixtureText('salonbog-backup.json'));
    expect(b.clients.map((c) => c.id)).toEqual(Array.from({ length: 13 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`));
    expect(b.visits.every((v) => /^v\d\d$/.test(v.id))).toBe(true);
  });

  it('whole-number ids (e.g. Date.now()) are kept as strings, and links work with number or string', () => {
    const b = plain({
      app: 'salonbog',
      clients: [
        { id: 1718000000000, name: 'Morgan' },
        { id: 1718000000001, name: 'Grete' }
      ],
      visits: [
        { id: 1718000000100, clientId: 1718000000000, treatment: 'Klip', date: '2026-09-01' },
        { id: 1718000000101, clientId: '1718000000001', treatment: 'Farve', date: '2026-09-02' },
        { id: -5, clientId: 1718000000000, treatment: 'Skæg', date: '2026-09-03' }
      ]
    });
    expect(b.clients.map((c) => c.id)).toEqual(['1718000000000', '1718000000001']);
    expect(b.visits.map((v) => [v.id, v.clientId])).toEqual([
      ['1718000000100', '1718000000000'],
      ['1718000000101', '1718000000001'],
      ['-5', '1718000000000']
    ]);
    expect(b.warnings).toEqual([]);
  });

  it('other string ids get a derived safe id; client–visit links are kept', () => {
    const odd = ['1.5', 'a b', 'æøå', 'id/with/slash', '__proto__', 'constructor', 'prototype', 'x'.repeat(65)];
    const b = plain({
      app: 'salonbog',
      clients: odd.map((id, i) => ({ id, name: `Kunde ${i}` })),
      visits: odd.map((clientId, i) => ({ id: `v.${i}`, clientId, treatment: 'Klip', date: '2026-09-01' }))
    });
    expect(b.warnings).toEqual([]);
    expect(b.clients).toHaveLength(odd.length);
    expect(new Set(b.clients.map((c) => c.id)).size).toBe(odd.length);
    for (const c of b.clients) {
      expect(c.id).toMatch(/^k[0-9a-z]+(_\d+)?$/);
      expect(isValidId(c.id)).toBe(true);
    }
    // Visit i belongs to client i.
    b.visits.forEach((v, i) => {
      expect(v.clientId).toBe(b.clients[i]!.id);
      expect(v.id).toMatch(/^b[0-9a-z]+(_\d+)?$/); // "v.0" is not a safe id either
    });
  });

  it('derived ids are the same on every read of the same file, so merging it again recognises it', () => {
    const text = JSON.stringify({
      app: 'salonbog',
      clients: [{ id: 'a b', name: 'A' }],
      visits: [{ id: 'v 1', clientId: 'a b', treatment: 'Klip', date: '2026-09-01' }]
    });
    expect(plain(text).clients[0]!.id).toBe(plain(text).clients[0]!.id);
    expect(plain(text).visits[0]!.id).toBe(plain(text).visits[0]!.id);
  });

  it('a derived id never collides with a safe id already in the file', () => {
    const first = plain({ app: 'salonbog', clients: [{ id: 'a b', name: 'A' }], visits: [] }).clients[0]!.id;
    const b = plain({ app: 'salonbog', clients: [{ id: first, name: 'Safe' }, { id: 'a b', name: 'A' }], visits: [] });
    expect(new Set(b.clients.map((c) => c.id)).size).toBe(2);
    expect(b.clients[0]!.id).toBe(first);
  });

  it('a number id and the same digits as a string are the same id (duplicate)', () => {
    const b = plain({ app: 'salonbog', clients: [{ id: 42, name: 'A' }, { id: '42', name: 'B' }], visits: [] });
    expect(b.clients.map((c) => [c.id, c.name])).toEqual([['42', 'A']]);
    expect(b.warnings).toEqual(['1 kunde stod der to gange og blev kun taget med én gang']);
  });

  it('a repeated non-safe id is a duplicate too (clients and visits)', () => {
    const b = plain({
      app: 'salonbog',
      clients: [{ id: 'a b', name: 'A' }, { id: 'a b', name: 'B' }],
      visits: [
        { id: 'v 1', clientId: 'a b', treatment: 'Klip', date: '2026-09-01' },
        { id: 'v 1', clientId: 'a b', treatment: 'Farve', date: '2026-09-02' }
      ]
    });
    expect(b.clients.map((c) => c.name)).toEqual(['A']);
    expect(b.visits.map((v) => v.treatment)).toEqual(['Klip']);
    expect(b.warnings).toEqual([
      '1 kunde stod der to gange og blev kun taget med én gang',
      '1 besøg stod der to gange og blev kun taget med én gang'
    ]);
  });

  it('fresh ids never collide with kept ids in a large file', () => {
    const clients = Array.from({ length: 2000 }, (_, i) => ({ id: i % 2 ? `k${i}` : `k ${i}`, name: `Kunde ${i}` }));
    const b = plain({ app: 'salonbog', clients, visits: [] });
    expect(new Set(b.clients.map((c) => c.id)).size).toBe(2000);
  });
});
