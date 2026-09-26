import { describe, expect, it } from 'vitest';
import { lastTreatmentFor, suggestPay, suggestPrice, treatmentOptions } from './pricing';
import { paid, visit } from '../../tests/helpers/factories';
import type { Visit } from './types';

const today = '2026-09-26';
const NO_DEFAULTS = new Map<string, number>();
const DEFAULTS = new Map([
  ['klip', 45_000],
  ['farve', 90_000],
  ['hårkur', 30_000]
]);

describe('suggestPrice', () => {
  const visits: Visit[] = [
    paid('morten', 'Klip', '2026-06-13', 400),
    paid('morten', 'Klip', '2026-08-08', 425),
    paid('hanne', 'Klip', '2026-09-20', 500),
    paid('hanne', 'Farve', '2026-09-04', 1250.5),
    visit('morten', 'Klip', '2026-09-24') // newest Morten visit, but no amount
  ];

  it('1. the client’s own latest amount for the same treatment', () => {
    // Hanne paid 500 more recently, and Morten’s newest visit has no amount – his own 425 wins.
    expect(suggestPrice(visits, 'morten', 'klip', DEFAULTS, today)).toBe(42_500);
  });

  it('2. otherwise the latest amount anyone paid for the treatment', () => {
    expect(suggestPrice(visits, 'laura', 'klip', DEFAULTS, today)).toBe(50_000);
    expect(suggestPrice(visits, 'morten', 'farve', DEFAULTS, today)).toBe(125_050);
    expect(suggestPrice(visits, null, 'klip', DEFAULTS, today)).toBe(50_000);
  });

  it('3. otherwise the imported default price', () => {
    expect(suggestPrice(visits, 'morten', 'hårkur', DEFAULTS, today)).toBe(30_000);
    expect(suggestPrice([], null, 'klip', DEFAULTS, today)).toBe(45_000);
  });

  it('4. otherwise nothing', () => {
    expect(suggestPrice(visits, 'morten', 'permanent', DEFAULTS, today)).toBeNull();
    expect(suggestPrice([], 'morten', 'klip', NO_DEFAULTS, today)).toBeNull();
    expect(suggestPrice(visits, 'morten', '', DEFAULTS, today)).toBeNull();
  });

  it('skips visits without an amount all the way down to the defaults', () => {
    const unpaid = [visit('morten', 'Klip', '2026-09-01'), visit('hanne', 'Klip', '2026-09-20')];
    expect(suggestPrice(unpaid, 'morten', 'klip', DEFAULTS, today)).toBe(45_000);
    expect(suggestPrice(unpaid, 'morten', 'klip', NO_DEFAULTS, today)).toBeNull();
  });

  it('ignores booked (future) visits, even with an amount', () => {
    const v = [paid('morten', 'Klip', '2026-08-08', 425), paid('morten', 'Klip', '2026-10-10', 999)];
    expect(suggestPrice(v, 'morten', 'klip', DEFAULTS, today)).toBe(42_500);
    expect(suggestPrice([paid('x', 'Klip', '2026-10-10', 999)], 'morten', 'klip', DEFAULTS, today)).toBe(45_000);
  });

  it('a visit today counts', () => {
    expect(suggestPrice([paid('morten', 'Klip', today, 475)], 'morten', 'klip', DEFAULTS, today)).toBe(47_500);
  });

  it('keeps a price of 0 kr. (e.g. family) instead of falling through', () => {
    expect(suggestPrice([paid('mor', 'Klip', '2026-09-01', 0)], 'mor', 'klip', DEFAULTS, today)).toBe(0);
  });

  it('same date: the visit entered last wins', () => {
    const v = [
      paid('morten', 'Klip', '2026-09-20', 400, null, { id: 'a', createdAt: '2026-09-20T10:00:00.000Z' }),
      paid('morten', 'Klip', '2026-09-20', 450, null, { id: 'b', createdAt: '2026-09-20T15:00:00.000Z' })
    ];
    expect(suggestPrice(v, 'morten', 'klip', NO_DEFAULTS, today)).toBe(45_000);
    expect(suggestPrice([...v].reverse(), 'morten', 'klip', NO_DEFAULTS, today)).toBe(45_000);
  });

  it('matches on the normalised treatment key (caller passes treatmentKey)', () => {
    const v = [paid('morten', ' KLIP ', '2026-09-01', 450)];
    expect(suggestPrice(v, 'morten', 'klip', NO_DEFAULTS, today)).toBe(45_000);
  });
});

describe('suggestPay', () => {
  it('the client’s latest payment method', () => {
    const v = [
      paid('morten', 'Klip', '2026-06-01', 450, 'kontant'),
      paid('morten', 'Klip', '2026-08-01', 450, 'mp_mig'),
      paid('hanne', 'Klip', '2026-09-01', 450, 'mp_noah'),
      visit('morten', 'Klip', '2026-09-10') // no pay → skipped
    ];
    expect(suggestPay(v, 'morten')).toBe('mp_mig');
    expect(suggestPay(v, 'hanne')).toBe('mp_noah');
  });

  it('otherwise the most used method overall', () => {
    const v = [
      paid('a', 'Klip', '2026-01-01', 450, 'kontant'),
      paid('b', 'Klip', '2026-02-01', 450, 'mp_mig'),
      paid('c', 'Klip', '2026-03-01', 450, 'mp_mig'),
      paid('d', 'Klip', '2026-09-01', 450, 'kontant'),
      paid('e', 'Klip', '2026-09-02', 450, 'mp_mig')
    ];
    expect(suggestPay(v, 'new-client')).toBe('mp_mig');
    expect(suggestPay(v, null)).toBe('mp_mig');
  });

  it('a tie goes to the method used most recently', () => {
    const v = [paid('a', 'Klip', '2026-01-01', 450, 'kontant'), paid('b', 'Klip', '2026-02-01', 450, 'mp_noah')];
    expect(suggestPay(v, null)).toBe('mp_noah');
  });

  it('nothing when no visit has a payment method', () => {
    expect(suggestPay([], null)).toBeNull();
    expect(suggestPay([visit('a', 'Klip', '2026-01-01')], 'a')).toBeNull();
  });

  it('with today given, booked (future) appointments are ignored', () => {
    const v = [
      paid('morten', 'Klip', '2026-08-01', 450, 'kontant'),
      visit('morten', 'Klip', '2026-10-10', { pay: 'mp_noah' }), // booked with a pay method
      visit('x', 'Klip', '2026-10-11', { pay: 'mp_noah' }),
      visit('y', 'Klip', '2026-10-12', { pay: 'mp_noah' })
    ];
    expect(suggestPay(v, 'morten', today)).toBe('kontant');
    expect(suggestPay(v, 'new-client', today)).toBe('kontant'); // overall favourite also ignores bookings
    expect(suggestPay(v, 'morten', '2026-10-10')).toBe('mp_noah'); // the day has come
    // Without today the old behaviour is kept (all visits).
    expect(suggestPay(v, 'morten')).toBe('mp_noah');
  });

  it('with today given and only future pay methods → null', () => {
    expect(suggestPay([visit('a', 'Klip', '2026-10-10', { pay: 'kontant' })], 'a', today)).toBeNull();
  });

  it('only the latest 200 visits decide the overall favourite', () => {
    const old = Array.from({ length: 300 }, (_, i) => paid(`o${i}`, 'Klip', '2025-01-01', 450, 'kontant', { id: `o${i}` }));
    const recent = Array.from({ length: 200 }, (_, i) => paid(`r${i}`, 'Klip', '2026-06-01', 450, 'mp_mig', { id: `r${i}` }));
    expect(suggestPay([...old, ...recent], null)).toBe('mp_mig');
  });
});

describe('treatmentOptions', () => {
  const v = [
    visit('a', 'Klip', '2026-01-01'),
    visit('b', 'Klip', '2026-02-01'),
    visit('c', 'klip', '2026-09-01'),
    visit('a', 'Farve', '2026-03-01'),
    visit('b', 'Farve', '2026-04-01'),
    visit('morten', 'Skæg', '2026-05-01'),
    visit('d', 'Permanent', '2026-08-01')
  ];

  it('sorts by use, ties by most recent, and labels with the latest spelling', () => {
    expect(treatmentOptions(v)).toEqual([
      { key: 'klip', label: 'klip', count: 3 },
      { key: 'farve', label: 'Farve', count: 2 },
      { key: 'permanent', label: 'Permanent', count: 1 },
      { key: 'skæg', label: 'Skæg', count: 1 }
    ]);
  });

  it('puts the client’s own treatments first', () => {
    expect(treatmentOptions(v, 'morten').map((o) => o.key)).toEqual(['skæg', 'klip', 'farve', 'permanent']);
    expect(treatmentOptions(v, 'a').map((o) => o.key)).toEqual(['klip', 'farve', 'permanent', 'skæg']);
  });

  it('own treatments are ordered by how often the client had them', () => {
    const own = [...v, visit('d', 'Permanent', '2026-08-15'), visit('d', 'Klip', '2026-09-10')];
    expect(treatmentOptions(own, 'd').map((o) => o.key)).toEqual(['permanent', 'klip', 'farve', 'skæg']);
  });

  it('is empty without visits', () => {
    expect(treatmentOptions([])).toEqual([]);
    expect(treatmentOptions([], 'x')).toEqual([]);
  });
});

describe('lastTreatmentFor', () => {
  it('returns the client’s most recent completed visit', () => {
    const v = [
      visit('morten', 'Klip', '2026-08-08'),
      visit('morten', 'Skæg', '2026-09-20'),
      visit('morten', 'Farve', '2026-10-01'), // booked
      visit('hanne', 'Farve', '2026-09-25')
    ];
    expect(lastTreatmentFor(v, 'morten', today)?.treatment).toBe('Skæg');
    expect(lastTreatmentFor(v, 'hanne', today)?.treatment).toBe('Farve');
    expect(lastTreatmentFor(v, 'nobody', today)).toBeNull();
    expect(lastTreatmentFor([visit('x', 'Klip', '2026-10-01')], 'x', today)).toBeNull();
  });

  it('same day: the one entered last', () => {
    const v = [
      visit('m', 'Klip', today, { id: '1', createdAt: '2026-09-26T09:00:00.000Z' }),
      visit('m', 'Skæg', today, { id: '2', createdAt: '2026-09-26T09:05:00.000Z' })
    ];
    expect(lastTreatmentFor(v, 'm', today)?.treatment).toBe('Skæg');
  });
});
