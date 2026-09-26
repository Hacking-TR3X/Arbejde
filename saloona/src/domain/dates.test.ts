import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsToKey,
  daysInMonth,
  diffDays,
  firstOfMonth,
  formatDateCompact,
  formatDateLong,
  formatDateShort,
  formatInterval,
  formatRelativeDays,
  fromDayNumber,
  isLeapYear,
  isValidISODate,
  lastOfMonth,
  monthKey,
  monthNameLong,
  monthNameShort,
  toDayNumber,
  weekday
} from './dates';

// Time-zone-sensitive tests (todayISO, DST instants) live in dates.tz.test.ts.

describe('isValidISODate', () => {
  it.each([
    '2026-09-26',
    '2026-01-31',
    '2026-12-31',
    '2028-02-29', // leap year
    '2000-02-29', // divisible by 400
    '2026-03-29', // DST switch in Copenhagen
    '2026-10-25',
    '1900-01-01',
    '2200-12-31'
  ])('accepts %s', (s) => {
    expect(isValidISODate(s)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-02-29', // not a leap year
    '2100-02-29', // divisible by 100, not 400
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-9-1',
    '2026-09-1',
    '2026-9-01',
    '26-09-26',
    '2026/09/26',
    '26.09.2026',
    ' 2026-09-26',
    '2026-09-26 ',
    '2026-09-26\n',
    '2026-09-26T00:00:00Z',
    '1899-12-31',
    '2201-01-01',
    '+02026-09-26',
    '２０２６-09-26', // full-width digits
    ''
  ])('rejects %j', (s) => {
    expect(isValidISODate(s)).toBe(false);
  });

  it.each([undefined, null, 20260926, NaN, true, {}, ['2026-09-26'], new Date('2026-09-26'), { toString: () => '2026-09-26' }])(
    'rejects non-string %j',
    (v) => {
      expect(isValidISODate(v)).toBe(false);
    }
  );
});

describe('isLeapYear / daysInMonth', () => {
  it('follows the Gregorian rules', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
  });

  it('knows the month lengths', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31
    ]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 0)).toBe(0);
    expect(daysInMonth(2026, 13)).toBe(0);
  });
});

describe('day numbers', () => {
  it('counts days from 1970-01-01', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(toDayNumber('1970-01-02')).toBe(1);
    expect(toDayNumber('1969-12-31')).toBe(-1);
    expect(fromDayNumber(0)).toBe('1970-01-01');
    expect(fromDayNumber(-1)).toBe('1969-12-31');
  });

  it('round-trips every day from 1900 to 2200 and steps by exactly one day', () => {
    const start = toDayNumber('1900-01-01');
    const end = toDayNumber('2200-12-31');
    let prev = fromDayNumber(start - 1);
    for (let n = start; n <= end; n++) {
      const iso = fromDayNumber(n);
      if (!isValidISODate(iso) || toDayNumber(iso) !== n || !(iso > prev)) {
        throw new Error(`day ${n} -> ${iso} (prev ${prev})`);
      }
      prev = iso;
    }
    expect(end - start + 1).toBe(301 * 365 + 73); // 73 leap days in 1900–2200
  });

  it('throws on a malformed date instead of returning garbage', () => {
    expect(() => toDayNumber('garbage')).toThrow(RangeError);
    expect(() => addDays('2026-9-1', 1)).toThrow(RangeError);
    expect(() => diffDays('2026-09-26', '')).toThrow(RangeError);
  });

  it('does not validate impossible-but-well-formed dates (documented leniency)', () => {
    // parts() only checks the pattern; Date.UTC rolls 30 Feb over to 2 Mar.
    // Callers must validate input with isValidISODate first (the backup reader does).
    expect(addDays('2026-02-30', 0)).toBe('2026-03-02');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'], // month end
    ['2026-02-28', 1, '2026-03-01'], // February, common year
    ['2028-02-28', 1, '2028-02-29'], // leap day
    ['2028-02-29', 1, '2028-03-01'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2100-02-28', 1, '2100-03-01'], // not a leap year
    ['2026-12-31', 1, '2027-01-01'], // year end
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-03-28', 1, '2026-03-29'], // Europe/Copenhagen spring forward
    ['2026-03-29', 1, '2026-03-30'],
    ['2026-03-30', -1, '2026-03-29'],
    ['2026-10-24', 1, '2026-10-25'], // Europe/Copenhagen fall back
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-10-26', -1, '2026-10-25'],
    ['2026-03-01', 30, '2026-03-31'],
    ['2026-09-26', 0, '2026-09-26'],
    ['2026-09-26', 365, '2027-09-26'],
    ['2028-01-01', 366, '2029-01-01'],
    ['2026-06-13', 35, '2026-07-18'],
    ['2026-01-31', 28, '2026-02-28'] // "31 Jan + 1 month" has no day 31 in Feb
  ])('%s %+d → %s', (from, n, to) => {
    expect(addDays(from, n)).toBe(to);
  });

  it('crosses both DST switches in one step', () => {
    expect(addDays('2026-03-01', 240)).toBe('2026-10-27');
    expect(diffDays('2026-03-01', '2026-10-27')).toBe(240);
  });
});

describe('diffDays', () => {
  it.each([
    ['2026-03-28', '2026-03-30', 2], // 47 hours of wall-clock time in Copenhagen
    ['2026-10-24', '2026-10-26', 2], // 49 hours
    ['2026-03-29', '2026-03-29', 0],
    ['2026-12-31', '2027-01-01', 1],
    ['2028-02-28', '2028-03-01', 2],
    ['2026-02-28', '2026-03-01', 1],
    ['2026-09-26', '2026-06-13', -105],
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366]
  ])('%s → %s = %d', (a, b, n) => {
    const d = diffDays(a, b);
    expect(d).toBe(n);
    expect(Number.isInteger(d)).toBe(true);
  });

  it('is the inverse of addDays', () => {
    for (let n = -800; n <= 800; n += 7) {
      expect(diffDays('2026-09-26', addDays('2026-09-26', n))).toBe(n);
    }
  });
});

describe('weekday (0 = Monday)', () => {
  it.each([
    ['1970-01-01', 3], // Thursday
    ['1900-01-01', 0], // Monday (negative day number)
    ['2026-09-26', 5], // Saturday
    ['2026-03-29', 6], // Sunday, last in March
    ['2026-10-25', 6], // Sunday, last in October
    ['2028-02-29', 1], // Tuesday
    ['2026-01-01', 3]
  ])('%s → %d', (iso, wd) => {
    expect(weekday(iso)).toBe(wd);
  });
});

describe('month keys', () => {
  it('monthKey', () => {
    expect(monthKey('2026-09-26')).toBe('2026-09');
  });

  it.each([
    ['2026-01', -1, '2025-12'], // January → December the year before
    ['2026-12', 1, '2027-01'],
    ['2026-09', 0, '2026-09'],
    ['2026-09', -5, '2026-04'],
    ['2027-02', -5, '2026-09'],
    ['2026-01', -12, '2025-01'],
    ['2026-01', -13, '2024-12'],
    ['2026-01', 24, '2028-01'],
    ['2026-03', -26, '2024-01'],
    ['2026-12', -12, '2025-12']
  ])('addMonthsToKey(%s, %d) → %s', (k, n, out) => {
    expect(addMonthsToKey(k, n)).toBe(out);
  });

  it.each([
    ['2026-02', '2026-02-28'],
    ['2028-02', '2028-02-29'],
    ['2100-02', '2100-02-28'],
    ['2000-02', '2000-02-29'],
    ['2026-04', '2026-04-30'],
    ['2026-12', '2026-12-31']
  ])('lastOfMonth(%s) → %s', (k, out) => {
    expect(lastOfMonth(k)).toBe(out);
    expect(isValidISODate(lastOfMonth(k))).toBe(true);
    expect(firstOfMonth(k)).toBe(`${k}-01`);
  });

  it('31 Jan "+ 1 month" lands on the last day of February', () => {
    expect(lastOfMonth(addMonthsToKey(monthKey('2026-01-31'), 1))).toBe('2026-02-28');
    expect(lastOfMonth(addMonthsToKey(monthKey('2028-01-31'), 1))).toBe('2028-02-29');
  });
});

describe('Danish names', () => {
  it('month names', () => {
    expect(monthNameLong(1)).toBe('januar');
    expect(monthNameLong(3)).toBe('marts');
    expect(monthNameLong(12)).toBe('december');
    expect(monthNameLong(0)).toBe('');
    expect(monthNameLong(13)).toBe('');
    expect(monthNameShort(5)).toBe('maj');
    expect(monthNameShort(9)).toBe('sep.');
    expect(monthNameShort(13)).toBe('');
  });
});

describe('formatDateLong', () => {
  it('uses Danish weekday and month names', () => {
    expect(formatDateLong('2026-09-26', '2026-09-26')).toBe('lørdag 26. september');
    expect(formatDateLong('2026-03-29', '2026-09-26')).toBe('søndag 29. marts');
    expect(formatDateLong('2026-01-01', '2026-09-26')).toBe('torsdag 1. januar');
    expect(formatDateLong('2026-05-04', '2026-09-26')).toBe('mandag 4. maj');
  });

  it('adds the year only when it differs from today', () => {
    expect(formatDateLong('2026-09-26')).toBe('lørdag 26. september');
    expect(formatDateLong('2026-09-26', '2027-01-02')).toBe('lørdag 26. september 2026');
    expect(formatDateLong('2028-02-29', '2026-09-26')).toBe('tirsdag 29. februar 2028');
    expect(formatDateLong('2026-12-31', '2027-01-01')).toBe('torsdag 31. december 2026');
  });
});

describe('formatDateShort', () => {
  it('uses Danish abbreviations', () => {
    expect(formatDateShort('2026-09-26', '2026-09-26')).toBe('lør. 26. sep.');
    expect(formatDateShort('2026-05-04', '2026-09-26')).toBe('man. 4. maj');
    expect(formatDateShort('2026-09-29', '2026-09-26')).toBe('tirs. 29. sep.');
  });

  it('adds the year only when it differs from today', () => {
    expect(formatDateShort('2026-09-26')).toBe('lør. 26. sep.');
    expect(formatDateShort('2025-12-31', '2026-01-02')).toBe('ons. 31. dec. 2025');
    expect(formatDateShort('2027-01-04', '2026-12-30')).toBe('man. 4. jan. 2027');
  });
});

describe('formatDateCompact', () => {
  it('omits the year only in the current year', () => {
    expect(formatDateCompact('2026-09-26', '2026-01-05')).toBe('26. sep.');
    expect(formatDateCompact('2025-12-31', '2026-01-05')).toBe('31. dec. 2025');
    expect(formatDateCompact('2026-09-26')).toBe('26. sep. 2026');
  });
});

describe('formatRelativeDays', () => {
  it.each([
    [0, 'i dag'],
    [1, 'i morgen'],
    [-1, 'i går'],
    [2, 'om 2 dage'],
    [-2, 'for 2 dage siden'],
    [13, 'om 13 dage'],
    [-13, 'for 13 dage siden'],
    [14, 'om 2 uger'],
    [-14, 'for 2 uger siden'],
    [17, 'om 2 uger'],
    [18, 'om 3 uger'],
    [59, 'om 8 uger'],
    [60, 'om 2 måneder'],
    [-60, 'for 2 måneder siden'],
    [365, 'om 12 måneder'],
    [-400, 'for 13 måneder siden']
  ])('%d → %s', (n, text) => {
    expect(formatRelativeDays(n)).toBe(text);
  });
});

describe('formatInterval', () => {
  it.each([
    [0, 'hver dag'],
    [1, 'hver dag'],
    [2, 'hver 2. dag'],
    [7, 'hver 7. dag'],
    [13, 'hver 13. dag'],
    [14, 'hver 2. uge'],
    [35, 'hver 5. uge'],
    [42, 'hver 6. uge'],
    [62, 'hver 9. uge'],
    [63, 'hver 2. måned'],
    [91, 'hver 3. måned'],
    [365, 'hver 12. måned']
  ])('%d → %s', (n, text) => {
    expect(formatInterval(n)).toBe(text);
  });
});
