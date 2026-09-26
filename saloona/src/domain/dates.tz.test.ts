/**
 * Time-zone and daylight-saving tests.
 *
 * Run the whole suite at least twice:
 *   TZ=Europe/Copenhagen npx vitest run
 *   TZ=America/Los_Angeles npx vitest run
 *
 * In addition, this file switches process.env.TZ itself (Node re-reads the zone
 * when TZ is assigned) so every run covers several zones, and restores the
 * original zone afterwards.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, diffDays, fromDayNumber, todayISO, toDayNumber, weekday } from './dates';
import { computeRhythms } from './rhythm';
import { periodRange } from './earnings';
import { visit } from '../../tests/helpers/factories';

const ORIGINAL_TZ = process.env.TZ;

function useZone(tz: string) {
  beforeEach(() => {
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
}

function currentZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

it('the zone the suite was started with is reported', () => {
  // Informative: makes the zone visible in verbose output and fails loudly if
  // TZ was set to something Node does not understand.
  expect(currentZone()).toBeTruthy();
  if (ORIGINAL_TZ) expect(['UTC', 'Etc/UTC', ORIGINAL_TZ]).toContain(currentZone());
});

/** Expected local calendar date for an instant, per zone. */
const INSTANTS: { at: string; label: string; expect: Record<string, string> }[] = [
  {
    at: '2026-09-26T22:30:00Z',
    label: 'after local midnight in Copenhagen (CEST, UTC+2)',
    expect: {
      'Europe/Copenhagen': '2026-09-27',
      'America/Los_Angeles': '2026-09-26',
      UTC: '2026-09-26',
      'Pacific/Kiritimati': '2026-09-27',
      'Pacific/Pago_Pago': '2026-09-26'
    }
  },
  {
    at: '2026-09-26T21:59:59Z',
    label: 'one second before local midnight in Copenhagen',
    expect: {
      'Europe/Copenhagen': '2026-09-26',
      'America/Los_Angeles': '2026-09-26',
      UTC: '2026-09-26',
      'Pacific/Kiritimati': '2026-09-27',
      'Pacific/Pago_Pago': '2026-09-26'
    }
  },
  {
    at: '2026-03-28T23:30:00Z',
    label: 'night before spring-forward (Copenhagen still CET, UTC+1)',
    expect: {
      'Europe/Copenhagen': '2026-03-29',
      'America/Los_Angeles': '2026-03-28',
      UTC: '2026-03-28',
      'Pacific/Kiritimati': '2026-03-29',
      'Pacific/Pago_Pago': '2026-03-28'
    }
  },
  {
    at: '2026-03-29T01:00:00Z',
    label: '03:00 CEST, right after the clocks jump in Copenhagen',
    expect: {
      'Europe/Copenhagen': '2026-03-29',
      'America/Los_Angeles': '2026-03-28',
      UTC: '2026-03-29',
      'Pacific/Kiritimati': '2026-03-29',
      'Pacific/Pago_Pago': '2026-03-28'
    }
  },
  {
    at: '2026-10-24T21:59:59Z',
    label: '23:59:59 CEST the evening before fall-back',
    expect: {
      'Europe/Copenhagen': '2026-10-24',
      'America/Los_Angeles': '2026-10-24',
      UTC: '2026-10-24',
      'Pacific/Kiritimati': '2026-10-25',
      'Pacific/Pago_Pago': '2026-10-24'
    }
  },
  {
    at: '2026-10-24T22:00:00Z',
    label: '00:00 CEST on fall-back day',
    expect: {
      'Europe/Copenhagen': '2026-10-25',
      'America/Los_Angeles': '2026-10-24',
      UTC: '2026-10-24',
      'Pacific/Kiritimati': '2026-10-25',
      'Pacific/Pago_Pago': '2026-10-24'
    }
  },
  {
    at: '2026-10-25T22:59:59Z',
    label: '23:59:59 CET on fall-back day (25-hour day)',
    expect: {
      'Europe/Copenhagen': '2026-10-25',
      'America/Los_Angeles': '2026-10-25',
      UTC: '2026-10-25',
      'Pacific/Kiritimati': '2026-10-26',
      'Pacific/Pago_Pago': '2026-10-25'
    }
  },
  {
    at: '2026-10-25T23:00:00Z',
    label: 'midnight CET after fall-back',
    expect: {
      'Europe/Copenhagen': '2026-10-26',
      'America/Los_Angeles': '2026-10-25',
      UTC: '2026-10-25',
      'Pacific/Kiritimati': '2026-10-26',
      'Pacific/Pago_Pago': '2026-10-25'
    }
  },
  {
    at: '2026-12-31T23:30:00Z',
    label: 'New Year in Copenhagen, still 2026 in Los Angeles',
    expect: {
      'Europe/Copenhagen': '2027-01-01',
      'America/Los_Angeles': '2026-12-31',
      UTC: '2026-12-31',
      'Pacific/Kiritimati': '2027-01-01',
      'Pacific/Pago_Pago': '2026-12-31'
    }
  },
  {
    at: '2028-02-29T23:30:00Z',
    label: 'leap day evening',
    expect: {
      'Europe/Copenhagen': '2028-03-01',
      'America/Los_Angeles': '2028-02-29',
      UTC: '2028-02-29',
      'Pacific/Kiritimati': '2028-03-01',
      'Pacific/Pago_Pago': '2028-02-29'
    }
  }
];

const ZONES = ['Europe/Copenhagen', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

for (const tz of ZONES) {
  describe(`TZ=${tz}`, () => {
    useZone(tz);

    it('really runs in that zone', () => {
      expect(currentZone()).toEqual(tz === 'UTC' ? expect.stringMatching(/UTC$/) : tz);
    });

    it.each(INSTANTS)('todayISO at $at: $label', ({ at, expect: byZone }) => {
      expect(todayISO(new Date(at))).toBe(byZone[tz]);
    });

    it('todayISO uses the local date, not the UTC date', () => {
      const d = new Date('2026-09-26T22:30:00Z');
      const utc = d.toISOString().slice(0, 10);
      const local = todayISO(d);
      if (tz === 'Europe/Copenhagen') expect(local).not.toBe(utc);
      expect(local).toBe(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      );
    });

    it('todayISO near local midnight on ordinary, DST and leap days', () => {
      const days: [number, number, number][] = [
        [2026, 8, 26],
        [2026, 2, 28],
        [2026, 2, 29], // spring forward in Europe
        [2026, 9, 25], // fall back in Europe
        [2026, 2, 8], // spring forward in the US
        [2026, 10, 1], // fall back in the US
        [2026, 11, 31],
        [2028, 1, 29]
      ];
      for (const [y, m, d] of days) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        expect(todayISO(new Date(y, m, d, 0, 0, 0, 0))).toBe(iso);
        expect(todayISO(new Date(y, m, d, 0, 0, 1, 0))).toBe(iso);
        expect(todayISO(new Date(y, m, d, 12, 0, 0, 0))).toBe(iso);
        expect(todayISO(new Date(y, m, d, 23, 59, 59, 999))).toBe(iso);
        expect(todayISO(new Date(y, m, d + 1, 0, 0, 0, 0))).toBe(addDays(iso, 1));
      }
    });

    it('the non-existent 02:30 on spring-forward day is still that day', () => {
      expect(todayISO(new Date(2026, 2, 29, 2, 30))).toBe('2026-03-29');
      expect(todayISO(new Date(2026, 2, 8, 2, 30))).toBe('2026-03-08');
    });

    it('date arithmetic ignores the zone and DST', () => {
      expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
      expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
      expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
      expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
      expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
      expect(diffDays('2026-03-08', '2026-03-09')).toBe(1);
      expect(diffDays('2026-11-01', '2026-11-02')).toBe(1);
      expect(toDayNumber('2026-03-29') - toDayNumber('2026-03-28')).toBe(1);
      expect(fromDayNumber(toDayNumber('2026-10-25'))).toBe('2026-10-25');
      expect(weekday('2026-03-29')).toBe(6);
      expect(weekday('2026-10-25')).toBe(6);
    });

    it('a whole year of consecutive days has no gaps or repeats', () => {
      let d = '2026-01-01';
      for (let i = 0; i < 365; i++) {
        const next = addDays(d, 1);
        expect(diffDays(d, next)).toBe(1);
        d = next;
      }
      expect(d).toBe('2027-01-01');
    });

    it('rhythm across both DST switches is the same in every zone', () => {
      // 2026-02-15, 2026-03-29 (spring forward), 2026-05-10 → interval 42.
      const visits = [visit('c1', 'Klip', '2026-02-15'), visit('c1', 'Klip', '2026-03-29'), visit('c1', 'Klip', '2026-05-10')];
      const [r] = computeRhythms(visits, '2026-10-25');
      expect(r?.intervalDays).toBe(42);
      expect(r?.expected).toBe('2026-06-21');
      expect(r?.daysUntil).toBe(-126);
    });

    it('periods do not depend on the zone', () => {
      expect(periodRange('lastMonth', '2027-01-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
      expect(periodRange('month', '2026-03-29')).toEqual({ from: '2026-03-01', to: '2026-03-29' });
    });
  });
}

describe('zone restore', () => {
  it('leaves process.env.TZ as it was', () => {
    expect(process.env.TZ).toBe(ORIGINAL_TZ);
  });
});
