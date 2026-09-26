/**
 * Money is stored as whole øre (integer). Parsing accepts the ways a Danish user
 * types an amount: "450", "450 kr.", "450,-", "1.250,50", "1250.5", "99,95 kr".
 */

export const MAX_AMOUNT_ORE = 100_000_000; // 1.000.000 kr.

export type ParseResult =
  | { ok: true; ore: number | null }
  | { ok: false; error: string };

const SPACES = /[\s\u00a0\u202f\u2009]/g;

export function parseAmount(input: string): ParseResult {
  let s = input.replace(SPACES, '').toLowerCase();
  if (s === '') return { ok: true, ore: null };

  // Currency words and trailing ",-" / ".-"
  s = s.replace(/^(kr\.?|dkk)/, '').replace(/(kr\.?|dkk)$/, '').replace(/[,.]-$/, '');
  if (s === '') return { ok: false, error: 'Skriv et beløb, fx 450' };
  if (s.startsWith('-')) return { ok: false, error: 'Beløbet kan ikke være negativt' };
  if (!/^[\d.,]+$/.test(s)) return { ok: false, error: 'Skriv kun tal, fx 450 eller 1.250,50' };

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let intPart: string;
  let fracPart = '';

  if (commas > 1) return { ok: false, error: 'Beløbet ser forkert ud' };

  if (commas === 1) {
    // Comma is the decimal separator; dots are thousands separators.
    const [a = '', b = ''] = s.split(',');
    if (dots > 0 && !/^\d{1,3}(\.\d{3})+$/.test(a)) return { ok: false, error: 'Beløbet ser forkert ud' };
    intPart = a.replace(/\./g, '');
    fracPart = b;
  } else if (dots === 0) {
    intPart = s;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.250" or "1.250.000": thousands separators
    intPart = s.replace(/\./g, '');
  } else if (dots === 1 && /^\d+\.\d{1,2}$/.test(s)) {
    // "1250.5" or "99.95": decimal point
    const [a = '', b = ''] = s.split('.');
    intPart = a;
    fracPart = b;
  } else {
    return { ok: false, error: 'Beløbet ser forkert ud' };
  }

  if (intPart === '' && fracPart === '') return { ok: false, error: 'Skriv et beløb, fx 450' };
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return { ok: false, error: 'Beløbet ser forkert ud' };
  if (fracPart.length > 2) return { ok: false, error: 'Højst to decimaler' };
  if (intPart.length > 9) return { ok: false, error: 'Beløbet er for stort' };

  const kr = Number(intPart || '0');
  const ore = kr * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(ore)) return { ok: false, error: 'Beløbet ser forkert ud' };
  if (ore > MAX_AMOUNT_ORE) return { ok: false, error: 'Beløbet er for stort' };
  return { ok: true, ore };
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1.250 kr." or "1.250,50 kr." (non-breaking space before "kr."). */
export function formatAmount(ore: number): string {
  return `${formatNumber(ore)}\u00a0kr.`;
}

/** "1.250" or "1.250,50" */
export function formatNumber(ore: number): string {
  const neg = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = rest === 0 ? groupThousands(kr) : `${groupThousands(kr)},${String(rest).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

/** Value to put back into an input field: "1250" or "1250,50". */
export function formatAmountInput(ore: number | null): string {
  if (ore === null) return '';
  const kr = Math.floor(ore / 100);
  const rest = ore % 100;
  return rest === 0 ? String(kr) : `${kr},${String(rest).padStart(2, '0')}`;
}

/** Converts a kroner number from a backup file to øre, or null if unusable. */
export function oreFromKroner(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const ore = Math.round(value * 100);
  if (ore > MAX_AMOUNT_ORE) return null;
  return ore;
}

export function kronerFromOre(ore: number): number {
  return ore / 100;
}
