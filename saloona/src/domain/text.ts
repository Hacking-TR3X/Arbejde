/** Text helpers: normalisation, sorting, search and phone numbers. */

export const LIMITS = {
  name: 80,
  tag: 24,
  treatment: 60,
  note: 2000,
  phone: 24
} as const;

// C0/C1 control characters except tab and newline, zero-width space, LRM/RLM, word joiner,
// bidi overrides and BOM. ZWNJ/ZWJ (U+200C/U+200D) stay: they are part of emoji sequences.
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/** Cuts to at most `max` characters without splitting a surrogate pair (emoji). */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/** Single-line text: trims, collapses whitespace, removes control characters. */
export function cleanLine(value: string, max: number): string {
  return truncate(value.normalize('NFC').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim(), max).trim();
}

/** Multi-line text (notes): keeps line breaks, trims each end. */
export function cleanMultiline(value: string, max: number): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(cleaned, max).trim();
}

/** Key used to group treatments: "  Klip " and "klip" are the same treatment. */
export function treatmentKey(treatment: string): string {
  return cleanLine(treatment, LIMITS.treatment).toLocaleLowerCase('da');
}

/** Upper-cases the first letter: "klip" → "Klip". */
export function capitalizeFirst(value: string): string {
  return value.length ? value.charAt(0).toLocaleUpperCase('da') + value.slice(1) : value;
}

export const collator = new Intl.Collator('da', { sensitivity: 'base', numeric: true });

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

function fold(value: string): string {
  return value.toLocaleLowerCase('da').normalize('NFC');
}

/**
 * Search ranking: 0 = no match, 3 = name starts with query,
 * 2 = a word starts with query, 1 = contains query.
 */
export function searchRank(name: string, query: string): number {
  const q = fold(query.trim());
  if (!q) return 1;
  const n = fold(name);
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

// ---------- phone numbers ----------

/**
 * Normalises a phone number to digits with an optional leading "+".
 * Returns null for an empty value and `false` for an invalid one.
 */
export function normalizePhone(input: string): string | null | false {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[+\d\s\-().]+$/.test(trimmed)) return false;
  let digits = trimmed.replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!/^\+?\d{3,15}$/.test(digits)) return false;
  if (digits.indexOf('+') > 0) return false;
  return digits;
}

/** "12 34 56 78" / "+45 12 34 56 78", otherwise the normalised number. */
export function formatPhone(phone: string): string {
  const dk = /^(\+45)?(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  if (dk) return `${dk[1] ? '+45 ' : ''}${dk[2]} ${dk[3]} ${dk[4]} ${dk[5]}`;
  return phone;
}

/** tel:/sms: URI for a stored phone number, or null if it is not safe to use. */
export function phoneUri(kind: 'tel' | 'sms', phone: string | null): string | null {
  if (!phone) return null;
  const n = normalizePhone(phone);
  if (!n) return null;
  return `${kind}:${n}`;
}
