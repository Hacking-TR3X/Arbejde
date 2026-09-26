import { describe, expect, it } from 'vitest';
import { PERIODS, computeEarnings, monthBars, periodRange, periodTitle } from './earnings';
import { client, clientMap, paid, visit } from '../../tests/helpers/factories';

describe('PERIODS', () => {
  it('has the four periods in UI order with Danish labels', () => {
    expect(PERIODS).toEqual([
      { id: 'month', label: 'Denne måned' },
      { id: 'lastMonth', label: 'Sidste måned' },
      { id: 'year', label: 'I år' },
      { id: 'all', label: 'Alt' }
    ]);
  });
});

describe('periodRange', () => {
  it('this month: from the 1st up to and including today', () => {
    expect(periodRange('month', '2026-09-26')).toEqual({ from: '2026-09-01', to: '2026-09-26' });
    expect(periodRange('month', '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-01' });
    expect(periodRange('month', '2027-01-01')).toEqual({ from: '2027-01-01', to: '2027-01-01' });
  });

  it('last month: the whole previous month', () => {
    expect(periodRange('lastMonth', '2026-09-26')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(periodRange('lastMonth', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('last month in January is December the year before', () => {
    expect(periodRange('lastMonth', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodRange('lastMonth', '2027-01-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('last month in March covers the leap day', () => {
    expect(periodRange('lastMonth', '2028-03-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('this year and all', () => {
    expect(periodRange('year', '2026-09-26')).toEqual({ from: '2026-01-01', to: '2026-09-26' });
    expect(periodRange('year', '2027-01-01')).toEqual({ from: '2027-01-01', to: '2027-01-01' });
    expect(periodRange('all', '2026-09-26')).toEqual({ from: null, to: '2026-09-26' });
  });
});

describe('periodTitle', () => {
  it.each([
    ['month', '2026-09-26', 'September 2026'],
    ['lastMonth', '2026-09-26', 'August 2026'],
    ['lastMonth', '2027-01-15', 'December 2026'],
    ['month', '2026-03-01', 'Marts 2026'],
    ['year', '2026-09-26', '2026'],
    ['all', '2026-09-26', 'Alle besøg']
  ] as const)('%s on %s → %s', (p, today, title) => {
    expect(periodTitle(p, today)).toBe(title);
  });
});

describe('computeEarnings', () => {
  const today = '2026-09-26';
  const clients = clientMap(
    client('morten', 'Holger'),
    client('hanne', 'Grete'),
    client('laura', 'Ingrid'),
    client('sophie', 'Vera'),
    client('jan', 'Kaj'),
    client('arne', 'Poul')
  );
  const visits = [
    paid('morten', 'Klip', '2026-09-26', 450, 'kontant'), // today
    paid('hanne', 'Farve', '2026-09-04', 1250.5, 'mp_mig'),
    paid('laura', 'Farve + klip', '2026-09-12', 1100, 'mp_noah'),
    paid('sophie', 'klip', '2026-09-19', 450, 'mp_mig'),
    paid('jan', 'Klip', '2026-09-01', 450, null), // amount but no pay method
    visit('arne', 'Klip', '2026-09-10'), // no amount
    visit('arne', 'Skæg', '2026-09-15'), // no amount
    paid('hanne', 'Farve', '2026-10-02', 999, 'mp_mig'), // booked – must not count
    paid('morten', 'Klip', '2026-08-31', 450, 'kontant'), // last month
    paid('gone', 'Klip', '2026-09-05', 300, 'kontant') // deleted client
  ];

  it('this month: totals, counts, average and visits without an amount', () => {
    const e = computeEarnings(visits, clients, 'month', today);
    // 450 + 1250,50 + 1100 + 450 + 450 + 300 = 4000,50 kr.
    expect(e.total).toBe(400_050);
    expect(e.count).toBe(8); // completed visits in the period, with or without an amount
    expect(e.paidCount).toBe(6);
    expect(e.average).toBe(Math.round(400_050 / 6));
    expect(e.missing.map((v) => v.date)).toEqual(['2026-09-15', '2026-09-10']); // newest first
  });

  it('only completed visits count – a booking with an amount is left out', () => {
    for (const p of ['month', 'year', 'all'] as const) {
      const e = computeEarnings(visits, clients, p, today);
      expect(e.missing.concat().every((v) => v.date <= today)).toBe(true);
      expect(e.byTreatment.find((s) => s.key === 'farve')?.total).toBe(125_050);
    }
  });

  it('byPay: fixed order kontant, MobilePay mig, MobilePay Noah, none', () => {
    const e = computeEarnings(visits, clients, 'month', today);
    expect(e.byPay).toEqual([
      { key: 'kontant', label: 'kontant', total: 75_000, count: 2 },
      { key: 'mp_mig', label: 'mp_mig', total: 170_050, count: 2 },
      { key: 'mp_noah', label: 'mp_noah', total: 110_000, count: 1 },
      { key: 'none', label: 'none', total: 45_000, count: 1 }
    ]);
  });

  it('byPay leaves out methods without money', () => {
    const e = computeEarnings([paid('a', 'Klip', '2026-09-01', 450, 'mp_noah'), paid('a', 'Klip', '2026-09-02', 0, 'kontant')], clients, 'month', today);
    expect(e.byPay.map((s) => s.key)).toEqual(['mp_noah']);
  });

  it('byTreatment groups spellings and sorts by total', () => {
    const e = computeEarnings(visits, clients, 'month', today);
    expect(e.byTreatment.map((s) => [s.key, s.label, s.total, s.count])).toEqual([
      ['klip', 'Klip', 165_000, 4], // "Klip" on 26/9 is newer than "klip" on 19/9
      ['farve', 'Farve', 125_050, 1],
      ['farve + klip', 'Farve + klip', 110_000, 1]
    ]);
  });

  it('byTreatment label is the most recent spelling, whatever the input order', () => {
    const v = [paid('a', 'KLIP', '2026-09-20', 100), paid('a', 'klip', '2026-09-01', 100), paid('a', 'Klip', '2026-09-10', 100)];
    for (const order of [v, [...v].reverse(), [v[1]!, v[0]!, v[2]!]]) {
      expect(computeEarnings(order, clients, 'month', today).byTreatment[0]!.label).toBe('KLIP');
    }
    // Same date: the one that comes last wins.
    const same = [paid('a', 'klip', '2026-09-20', 100), paid('a', 'Klip', '2026-09-20', 100)];
    expect(computeEarnings(same, clients, 'month', today).byTreatment[0]!.label).toBe('Klip');
  });

  it('topClients: at most 5, highest first, deleted clients labelled "Slettet kunde"', () => {
    const e = computeEarnings(visits, clients, 'month', today);
    expect(e.topClients).toHaveLength(5);
    expect(e.topClients.map((s) => s.label)).toEqual(['Grete', 'Ingrid', 'Holger', 'Vera', 'Kaj']);
    const withGone = computeEarnings([paid('gone', 'Klip', '2026-09-05', 5000, 'kontant')], clients, 'month', today);
    expect(withGone.topClients).toEqual([{ key: 'gone', label: 'Slettet kunde', total: 500_000, count: 1 }]);
  });

  it('topClients: ties are broken by number of visits', () => {
    const v = [paid('morten', 'Klip', '2026-09-01', 450), paid('hanne', 'Klip', '2026-09-02', 225), paid('hanne', 'Klip', '2026-09-03', 225)];
    expect(computeEarnings(v, clients, 'month', today).topClients.map((s) => s.label)).toEqual(['Grete', 'Holger']);
  });

  it('last month, year and all', () => {
    expect(computeEarnings(visits, clients, 'lastMonth', today).total).toBe(45_000);
    expect(computeEarnings(visits, clients, 'year', today).total).toBe(445_050);
    expect(computeEarnings(visits, clients, 'all', today).count).toBe(9);
  });

  it('last month in January reads December the year before', () => {
    const v = [paid('a', 'Klip', '2026-12-31', 450), paid('a', 'Klip', '2026-12-01', 400), paid('a', 'Klip', '2026-11-30', 999), paid('a', 'Klip', '2027-01-02', 999)];
    const e = computeEarnings(v, clients, 'lastMonth', '2027-01-15');
    expect(e.total).toBe(85_000);
    expect(e.count).toBe(2);
  });

  it('an empty period', () => {
    const e = computeEarnings([], clients, 'month', today);
    expect(e).toEqual({ total: 0, count: 0, paidCount: 0, average: null, missing: [], byPay: [], byTreatment: [], topClients: [] });
  });

  it('only unpaid visits → average is null, all of them missing', () => {
    const e = computeEarnings([visit('a', 'Klip', '2026-09-01')], clients, 'month', today);
    expect(e.average).toBeNull();
    expect(e.count).toBe(1);
    expect(e.missing).toHaveLength(1);
  });

  it('average rounds to whole øre', () => {
    const e = computeEarnings([paid('a', 'Klip', '2026-09-01', 1), paid('a', 'Klip', '2026-09-02', 0), paid('a', 'Klip', '2026-09-03', 0)], clients, 'month', today);
    expect(e.average).toBe(33);
  });
});

describe('monthBars', () => {
  it('six months ending with the current month, across a year end', () => {
    const v = [
      paid('a', 'Klip', '2026-08-31', 100), // outside the window
      paid('a', 'Klip', '2026-09-01', 450),
      paid('a', 'Klip', '2026-12-24', 500),
      paid('a', 'Klip', '2026-12-31', 250),
      paid('a', 'Klip', '2027-01-01', 300),
      visit('a', 'Klip', '2027-01-15'), // no amount
      paid('a', 'Klip', '2027-02-10', 200), // today
      paid('a', 'Klip', '2027-02-11', 999) // booked
    ];
    const bars = monthBars(v, '2027-02-10');
    expect(bars).toEqual([
      { key: '2026-09', label: 'sep', total: 45_000, current: false },
      { key: '2026-10', label: 'okt', total: 0, current: false },
      { key: '2026-11', label: 'nov', total: 0, current: false },
      { key: '2026-12', label: 'dec', total: 75_000, current: false },
      { key: '2027-01', label: 'jan', total: 30_000, current: false },
      { key: '2027-02', label: 'feb', total: 20_000, current: true }
    ]);
  });

  it('labels have no trailing dot, and "maj" stays "maj"', () => {
    expect(monthBars([], '2026-07-15').map((b) => b.label)).toEqual(['feb', 'mar', 'apr', 'maj', 'jun', 'jul']);
  });

  it('respects n', () => {
    expect(monthBars([], '2026-01-15', 12).map((b) => b.key)).toEqual([
      '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07',
      '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'
    ]);
    expect(monthBars([], '2026-01-15', 1)).toEqual([{ key: '2026-01', label: 'jan', total: 0, current: true }]);
  });
});
