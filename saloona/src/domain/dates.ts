/**
 * Calendar dates as "YYYY-MM-DD" strings.
 *
 * All arithmetic runs on whole day numbers (days since 1970-01-01, computed in UTC),
 * so daylight saving time and the device time zone never shift a date.
 * The only place the local time zone matters is `todayISO`.
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, month1: number): number {
  const table = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month1 - 1] ?? 0;
}

function parts(iso: ISODate): [number, number, number] {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError('Ugyldig dato');
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function toDayNumber(iso: ISODate): number {
  const [y, mo, d] = parts(iso);
  return Math.round(Date.UTC(y, mo - 1, d) / MS_PER_DAY);
}

export function fromDayNumber(day: number): ISODate {
  const dt = new Date(day * MS_PER_DAY);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Number of days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Today's date in the device's local time zone. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function weekday(iso: ISODate): number {
  // 0 = Monday … 6 = Sunday. 1970-01-01 was a Thursday.
  return (((toDayNumber(iso) + 3) % 7) + 7) % 7;
}

// ---------- months ----------

/** "YYYY-MM" */
export type MonthKey = string;

export function monthKey(iso: ISODate): MonthKey {
  return iso.slice(0, 7);
}

export function addMonthsToKey(key: MonthKey, delta: number): MonthKey {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${pad2(nm + 1)}`;
}

export function firstOfMonth(key: MonthKey): ISODate {
  return `${key}-01`;
}

export function lastOfMonth(key: MonthKey): ISODate {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return `${key}-${pad2(daysInMonth(y, m))}`;
}

// ---------- Danish formatting ----------

const MONTHS_LONG = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december'
];
const MONTHS_SHORT = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
const WEEKDAYS_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const WEEKDAYS_SHORT = ['man.', 'tirs.', 'ons.', 'tors.', 'fre.', 'lør.', 'søn.'];

export function monthNameLong(month1: number): string {
  return MONTHS_LONG[month1 - 1] ?? '';
}

export function monthNameShort(month1: number): string {
  return MONTHS_SHORT[month1 - 1] ?? '';
}

/** "fredag 26. september" (year added when it differs from `today`). */
export function formatDateLong(iso: ISODate, today?: ISODate): string {
  const [y, mo, d] = parts(iso);
  const base = `${WEEKDAYS_LONG[weekday(iso)]} ${d}. ${MONTHS_LONG[mo - 1]}`;
  return today && today.slice(0, 4) !== String(y) ? `${base} ${y}` : base;
}

/** "fre. 26. sep." (year added when it differs from `today`). */
export function formatDateShort(iso: ISODate, today?: ISODate): string {
  const [y, mo, d] = parts(iso);
  const base = `${WEEKDAYS_SHORT[weekday(iso)]} ${d}. ${MONTHS_SHORT[mo - 1]}`;
  return today && today.slice(0, 4) !== String(y) ? `${base} ${y}` : base;
}

/** "26. sep. 2026" – compact form for history lists. */
export function formatDateCompact(iso: ISODate, today?: ISODate): string {
  const [y, mo, d] = parts(iso);
  const base = `${d}. ${MONTHS_SHORT[mo - 1]}`;
  return today && today.slice(0, 4) === String(y) ? base : `${base} ${y}`;
}

/** Relative wording for a signed day difference (target − today). */
export function formatRelativeDays(days: number): string {
  if (days === 0) return 'i dag';
  if (days === 1) return 'i morgen';
  if (days === -1) return 'i går';
  const abs = Math.abs(days);
  let amount: string;
  if (abs < 14) amount = `${abs} dage`;
  else if (abs < 60) {
    const w = Math.round(abs / 7);
    amount = w === 1 ? '1 uge' : `${w} uger`;
  } else {
    const mo = Math.round(abs / 30.44);
    amount = mo === 1 ? '1 måned' : `${mo} måneder`;
  }
  return days > 0 ? `om ${amount}` : `for ${amount} siden`;
}

/** "hver 6. uge", "hver 10. dag", "hver 3. måned". */
export function formatInterval(days: number): string {
  if (days <= 1) return 'hver dag';
  if (days < 14) return `hver ${days}. dag`;
  if (days < 63) {
    const w = Math.round(days / 7);
    return w <= 1 ? 'hver uge' : `hver ${w}. uge`;
  }
  const mo = Math.round(days / 30.44);
  return mo <= 1 ? 'hver måned' : `hver ${mo}. måned`;
}
