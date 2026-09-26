import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { MIN_DATES, SOON_DAYS, computeRhythms, dueOverview, type Rhythm } from './rhythm';
import { client, clientMap, rng, visit } from '../../tests/helpers/factories';
import type { Visit } from './types';

const D = '2026-01-10';
const at = (n: number) => addDays(D, n);

/** Three visits 30 days apart: D, D+30, D+60 → expected D+90. */
function every30(clientId = 'c1', treatment = 'Klip'): Visit[] {
  return [visit(clientId, treatment, at(0)), visit(clientId, treatment, at(30)), visit(clientId, treatment, at(60))];
}

function only(rs: Rhythm[]): Rhythm {
  expect(rs).toHaveLength(1);
  return rs[0]!;
}

describe('constants', () => {
  it('match the plan', () => {
    expect(MIN_DATES).toBe(3);
    expect(SOON_DAYS).toBe(14);
  });
});

describe('computeRhythms – collecting', () => {
  it('returns nothing without visits', () => {
    expect(computeRhythms([], '2026-09-26')).toEqual([]);
  });

  it('fewer than 3 unique dates → collecting, no interval', () => {
    for (const n of [1, 2]) {
      const visits = every30().slice(0, n);
      const r = only(computeRhythms(visits, '2026-09-26'));
      expect(r.status).toBe('collecting');
      expect(r.dates).toHaveLength(n);
      expect(r.intervalDays).toBeNull();
      expect(r.expected).toBeNull();
      expect(r.daysUntil).toBeNull();
      expect(r.progress).toBe(0);
      expect(r.lastDate).toBe(visits[n - 1]!.date);
    }
  });

  it('two visits on the same day count as one date', () => {
    const visits = [
      visit('c1', 'Klip', at(0), { id: 'a' }),
      visit('c1', 'Klip', at(0), { id: 'b' }),
      visit('c1', 'Klip', at(30), { id: 'c' })
    ];
    const r = only(computeRhythms(visits, '2026-09-26'));
    expect(r.dates).toEqual([at(0), at(30)]);
    expect(r.status).toBe('collecting');
  });

  it('exactly 3 unique dates → rhythm', () => {
    const r = only(computeRhythms(every30(), at(60)));
    expect(r.status).not.toBe('collecting');
    expect(r.intervalDays).toBe(30);
    expect(r.expected).toBe(at(90));
  });
});

describe('computeRhythms – grouping', () => {
  it('different spellings of a treatment are one treatment', () => {
    const visits = [visit('c1', 'klip ', at(0)), visit('c1', ' KLIP', at(30)), visit('c1', 'Klip', at(60))];
    const r = only(computeRhythms(visits, at(60)));
    expect(r.treatmentKey).toBe('klip');
    expect(r.dates).toHaveLength(3);
    expect(r.treatment).toBe('Klip'); // most recent spelling
  });

  it('the label is the spelling used most recently, regardless of input order', () => {
    const visits = [visit('c1', 'Klip', at(60)), visit('c1', 'klip', at(0)), visit('c1', 'KLIP', at(30))];
    expect(only(computeRhythms(visits, at(60))).treatment).toBe('Klip');
  });

  it('keeps clients and treatments apart', () => {
    const visits = [...every30('c1', 'Klip'), ...every30('c2', 'Klip'), ...every30('c1', 'Farve')];
    const rs = computeRhythms(visits, at(60));
    expect(rs).toHaveLength(3);
    expect(rs.map((r) => `${r.clientId}/${r.treatmentKey}`).sort()).toEqual(['c1/farve', 'c1/klip', 'c2/klip']);
  });

  it('result does not depend on input order', () => {
    const visits = [
      ...every30('c1'),
      visit('c1', 'Klip', at(95)),
      ...every30('c2', 'Farve'),
      visit('c2', 'Farve', at(10)),
      visit('c3', 'Klip', at(5))
    ];
    const today = at(80);
    const sortKey = (r: Rhythm) => `${r.clientId}/${r.treatmentKey}`;
    const expected = computeRhythms(visits, today).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const rand = rng(7);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...visits].sort(() => rand() - 0.5);
      const got = computeRhythms(shuffled, today).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      expect(got).toEqual(expected);
    }
  });

  it('does not mutate its input', () => {
    const visits = [visit('c1', 'Klip', at(60)), visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(30))];
    const copy = structuredClone(visits);
    computeRhythms(visits, at(60));
    dueOverview(visits, clientMap(client('c1', 'A')), at(60));
    expect(visits).toEqual(copy);
  });
});

describe('computeRhythms – interval', () => {
  it('is (last − first) / (dates − 1)', () => {
    const visits = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(30)), visit('c1', 'Klip', at(60)), visit('c1', 'Klip', at(100))];
    const r = only(computeRhythms(visits, at(100)));
    expect(r.intervalDays).toBe(33); // 100 / 3 = 33.33
    expect(r.expected).toBe(at(133));
  });

  it('rounds .5 up and below .5 down', () => {
    const up = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(10)), visit('c1', 'Klip', at(21))]; // 10.5
    expect(only(computeRhythms(up, at(21))).intervalDays).toBe(11);
    const half = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(10)), visit('c1', 'Klip', at(19))]; // 9.5
    expect(only(computeRhythms(half, at(19))).intervalDays).toBe(10);
    const down = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(1)), visit('c1', 'Klip', at(20))]; // 10.0
    expect(only(computeRhythms(down, at(20))).intervalDays).toBe(10);
    const third = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(5)), visit('c1', 'Klip', at(13)), visit('c1', 'Klip', at(28))]; // 9.33
    expect(only(computeRhythms(third, at(28))).intervalDays).toBe(9);
  });

  it('is at least one day', () => {
    const daily = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(1)), visit('c1', 'Klip', at(2))];
    const r = only(computeRhythms(daily, at(2)));
    expect(r.intervalDays).toBe(1);
    expect(r.expected).toBe(at(3));
  });

  it('Holger from the prototype: every 35 days, next 2026-10-31', () => {
    const visits = ['2026-06-13', '2026-06-25', '2026-08-08', '2026-09-26'].map((d) => visit('morgan', 'Klip', d));
    const r = only(computeRhythms(visits, '2026-09-26'));
    expect(r.intervalDays).toBe(35);
    expect(r.expected).toBe('2026-10-31');
    expect(r.daysUntil).toBe(35);
    expect(r.status).toBe('later');
    expect(r.progress).toBe(0);
  });

  it('works across a year end and a leap day', () => {
    const visits = [visit('c1', 'Klip', '2027-12-15'), visit('c1', 'Klip', '2028-01-26'), visit('c1', 'Klip', '2028-03-08')];
    const r = only(computeRhythms(visits, '2028-03-08'));
    expect(r.intervalDays).toBe(42);
    expect(r.expected).toBe('2028-04-19');
  });
});

describe('computeRhythms – status boundaries', () => {
  // expected = D+90
  it.each([
    [at(91), -1, 'late'],
    [at(120), -30, 'late'],
    [at(90), 0, 'soon'],
    [at(76), 14, 'soon'],
    [at(75), 15, 'later'],
    [at(60), 30, 'later']
  ] as const)('today %s → daysUntil %d → %s', (today, days, status) => {
    const r = only(computeRhythms(every30(), today));
    expect(r.daysUntil).toBe(days);
    expect(r.status).toBe(status);
    expect(r.expected).toBe(at(90));
  });

  it('progress goes from 0 at the last visit to 1 at the expected date and stays at 1', () => {
    expect(only(computeRhythms(every30(), at(60))).progress).toBe(0);
    expect(only(computeRhythms(every30(), at(75))).progress).toBe(0.5);
    expect(only(computeRhythms(every30(), at(90))).progress).toBe(1);
    expect(only(computeRhythms(every30(), at(200))).progress).toBe(1);
  });
});

describe('computeRhythms – booked appointments', () => {
  it('a future visit does not count until its day has come', () => {
    const visits = [visit('c1', 'Klip', at(0)), visit('c1', 'Klip', at(30)), visit('c1', 'Klip', at(60))];
    const before = only(computeRhythms(visits, at(59)));
    expect(before.dates).toEqual([at(0), at(30)]);
    expect(before.status).toBe('collecting');
    expect(before.booked).toBe(at(60));

    const onTheDay = only(computeRhythms(visits, at(60)));
    expect(onTheDay.dates).toHaveLength(3);
    expect(onTheDay.booked).toBeNull();
    expect(onTheDay.status).toBe('later');
  });

  it('a booking for the same treatment removes "late"', () => {
    const late = only(computeRhythms(every30(), at(100)));
    expect(late.status).toBe('late');

    const booked = only(computeRhythms([...every30(), visit('c1', 'Klip', at(105))], at(100)));
    expect(booked.status).toBe('booked');
    expect(booked.booked).toBe(at(105));
    expect(booked.daysUntil).toBe(-10); // still reported, only the status changes
    expect(booked.dates).toHaveLength(3);
  });

  it('a booking with a different spelling of the same treatment also counts', () => {
    const r = only(computeRhythms([...every30('c1', 'Klip'), visit('c1', ' KLIP ', at(105))], at(100)));
    expect(r.status).toBe('booked');
  });

  it('a booking for another treatment does not hide "late"', () => {
    const rs = computeRhythms([...every30('c1', 'Klip'), visit('c1', 'Farve', at(105))], at(100));
    const klip = rs.find((r) => r.treatmentKey === 'klip')!;
    const farve = rs.find((r) => r.treatmentKey === 'farve')!;
    expect(klip.status).toBe('late');
    expect(farve.status).toBe('collecting');
    expect(farve.dates).toEqual([]);
    expect(farve.booked).toBe(at(105));
  });

  it('a booking by another client does not hide "late"', () => {
    const rs = computeRhythms([...every30('c1'), visit('c2', 'Klip', at(105))], at(100));
    expect(rs.find((r) => r.clientId === 'c1')!.status).toBe('late');
  });

  it('booked is the earliest future appointment, in any input order', () => {
    const r = only(computeRhythms([...every30(), visit('c1', 'Klip', at(130)), visit('c1', 'Klip', at(105))], at(100)));
    expect(r.booked).toBe(at(105));
    const r2 = only(computeRhythms([...every30(), visit('c1', 'Klip', at(105)), visit('c1', 'Klip', at(130))], at(100)));
    expect(r2.booked).toBe(at(105));
  });

  it('a booking also takes precedence over "soon" and "later"', () => {
    expect(only(computeRhythms([...every30(), visit('c1', 'Klip', at(95))], at(80))).status).toBe('booked');
    expect(only(computeRhythms([...every30(), visit('c1', 'Klip', at(95))], at(61))).status).toBe('booked');
  });
});

describe('dueOverview', () => {
  const today = '2026-09-26';
  const t = (n: number) => addDays(today, n);
  /** Three visits `interval` days apart, ending so that the rhythm is `daysUntil` from today. */
  function rhythmVisits(clientId: string, treatment: string, interval: number, daysUntil: number): Visit[] {
    const last = t(daysUntil - interval);
    return [addDays(last, -2 * interval), addDays(last, -interval), last].map((d) => visit(clientId, treatment, d));
  }

  it('sorts rhythms into late / soon / later, most urgent first', () => {
    const clients = clientMap(client('a', 'A'), client('b', 'B'), client('c', 'C'), client('d', 'D'), client('e', 'E'), client('f', 'F'));
    const visits = [
      ...rhythmVisits('a', 'Klip', 30, -1),
      ...rhythmVisits('b', 'Klip', 30, -20),
      ...rhythmVisits('c', 'Klip', 30, 14),
      ...rhythmVisits('d', 'Klip', 30, 0),
      ...rhythmVisits('e', 'Klip', 60, 40),
      ...rhythmVisits('f', 'Klip', 60, 15)
    ];
    const o = dueOverview(visits, clients, today);
    expect(o.late.map((r) => [r.clientId, r.daysUntil])).toEqual([
      ['b', -20],
      ['a', -1]
    ]);
    expect(o.soon.map((r) => [r.clientId, r.daysUntil])).toEqual([
      ['d', 0],
      ['c', 14]
    ]);
    expect(o.later.map((r) => [r.clientId, r.daysUntil])).toEqual([
      ['f', 15],
      ['e', 40]
    ]);
    expect(o.upcoming).toEqual([]);
    expect(o.collecting).toEqual([]);
  });

  it('hides rhythms of clients that are not in the map (e.g. deleted)', () => {
    const visits = [...rhythmVisits('a', 'Klip', 30, -5), ...rhythmVisits('gone', 'Klip', 30, -5), visit('gone', 'Farve', t(-3))];
    const o = dueOverview(visits, clientMap(client('a', 'A')), today);
    expect(o.late.map((r) => r.clientId)).toEqual(['a']);
    expect(o.collecting).toEqual([]);
  });

  it('a booked client appears under upcoming, not under late', () => {
    const visits = [...rhythmVisits('a', 'Klip', 30, -10), visit('a', 'Klip', t(3))];
    const o = dueOverview(visits, clientMap(client('a', 'Anne')), today);
    expect(o.late).toEqual([]);
    expect(o.soon).toEqual([]);
    expect(o.later).toEqual([]);
    expect(o.upcoming).toHaveLength(1);
    expect(o.upcoming[0]!.visit.date).toBe(t(3));
    expect(o.upcoming[0]!.client?.name).toBe('Anne');
  });

  it('upcoming: only future visits, sorted by date and then by entry time', () => {
    const visits = [
      visit('a', 'Klip', t(5), { id: 'late-entry', createdAt: '2026-09-20T12:00:00.000Z' }),
      visit('b', 'Farve', t(1), { id: 'tomorrow' }),
      visit('c', 'Klip', t(5), { id: 'early-entry', createdAt: '2026-09-01T08:00:00.000Z' }),
      visit('a', 'Klip', today, { id: 'today' }),
      visit('a', 'Klip', t(-1), { id: 'yesterday' }),
      visit('b', 'Klip', t(400), { id: 'next-year' })
    ];
    const o = dueOverview(visits, clientMap(client('a', 'A'), client('b', 'B'), client('c', 'C')), today);
    expect(o.upcoming.map((u) => u.visit.id)).toEqual(['tomorrow', 'early-entry', 'late-entry', 'next-year']);
  });

  it('upcoming leaves out appointments of clients that are not in the map', () => {
    const o = dueOverview([visit('ghost', 'Klip', t(2)), visit('a', 'Klip', t(3))], clientMap(client('a', 'Anne')), today);
    expect(o.upcoming.map((u) => u.visit.clientId)).toEqual(['a']);
    expect(o.upcoming.every((u) => u.client !== undefined)).toBe(true);
    expect(dueOverview([visit('ghost', 'Klip', t(2))], new Map(), today).upcoming).toEqual([]);
  });

  it('collecting: only groups with completed dates, most dates first, then most recent', () => {
    const clients = clientMap(client('a', 'A'), client('b', 'B'), client('c', 'C'), client('d', 'D'));
    const visits = [
      visit('a', 'Klip', t(-100)),
      visit('b', 'Klip', t(-50)),
      visit('b', 'Klip', t(-20)),
      visit('c', 'Klip', t(-10)),
      visit('d', 'Klip', t(5)) // only a booking: shown under upcoming, not collecting
    ];
    const o = dueOverview(visits, clients, today);
    expect(o.collecting.map((r) => [r.clientId, r.dates.length])).toEqual([
      ['b', 2],
      ['c', 1],
      ['a', 1]
    ]);
    expect(o.upcoming.map((u) => u.visit.clientId)).toEqual(['d']);
  });
});
