import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_ORE,
  formatAmount,
  formatAmountInput,
  formatNumber,
  kronerFromOre,
  oreFromKroner,
  parseAmount
} from './money';
import { rng } from '../../tests/helpers/factories';

const NBSP = ' ';

function ore(input: string): number | null {
  const r = parseAmount(input);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(input)}, got "${r.error}"`);
  return r.ore;
}

function err(input: string): string {
  const r = parseAmount(input);
  if (r.ok) throw new Error(`expected error for ${JSON.stringify(input)}, got ${r.ore}`);
  return r.error;
}

describe('parseAmount – accepted', () => {
  it.each([
    ['450', 45_000],
    ['450 kr.', 45_000],
    ['450 kr', 45_000],
    ['450kr', 45_000],
    ['450 KR.', 45_000],
    ['kr 450', 45_000],
    ['kr. 450', 45_000],
    ['450 DKK', 45_000],
    ['dkk450', 45_000],
    ['450,-', 45_000],
    ['450.-', 45_000],
    ['450,- kr', 45_000],
    ['1.250,50', 125_050],
    ['1.250,5', 125_050],
    ['1.250', 125_000],
    ['1.250,-', 125_000],
    ['1250.5', 125_050],
    ['1250,5', 125_050],
    ['99.95', 9_995],
    ['99,95', 9_995],
    [' 99,95 kr ', 9_995],
    ['0', 0],
    ['0,00', 0],
    ['0,5', 50],
    ['0,05', 5],
    [',5', 50],
    ['5,', 500],
    ['00450', 45_000],
    ['12.34', 1_234], // one dot + two digits = decimal point
    ['1.5', 150],
    ['1 250', 125_000], // space as thousands separator
    [`1${NBSP}250,50${NBSP}kr.`, 125_050], // pasted from formatAmount
    ['1 250', 125_000], // narrow no-break space
    ['1 250', 125_000], // thin space
    ['\t450\n', 45_000],
    ['999.999,99', 99_999_999],
    ['1.000.000', MAX_AMOUNT_ORE], // exactly the maximum
    ['1000000', MAX_AMOUNT_ORE]
  ])('%j → %d øre', (input, expected) => {
    expect(ore(input)).toBe(expected);
  });

  it('empty or blank input means "no amount"', () => {
    expect(parseAmount('')).toEqual({ ok: true, ore: null });
    expect(parseAmount('   ')).toEqual({ ok: true, ore: null });
    expect(parseAmount(NBSP)).toEqual({ ok: true, ore: null });
  });

  it('always returns whole øre', () => {
    for (const s of ['0,01', '0,1', '19,99', '1250.5', '99.95', '1.234,56']) {
      expect(Number.isInteger(ore(s))).toBe(true);
    }
  });
});

describe('parseAmount – rejected with a Danish message', () => {
  const MESSAGES = new Set([
    'Skriv et beløb, fx 450',
    'Beløbet kan ikke være negativt',
    'Skriv kun tal, fx 450 eller 1.250,50',
    'Beløbet ser forkert ud',
    'Højst to decimaler',
    'Beløbet er for stort'
  ]);

  it.each([
    ['abc', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['NaN', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['Infinity', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['-Infinity', 'Beløbet kan ikke være negativt'],
    ['1e3', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['0x1F', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['+450', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['450 €', 'Skriv kun tal, fx 450 eller 1.250,50'],
    ['− 50', 'Skriv kun tal, fx 450 eller 1.250,50'], // Unicode minus
    ['-50', 'Beløbet kan ikke være negativt'],
    ['- 50', 'Beløbet kan ikke være negativt'],
    ['kr -50', 'Beløbet kan ikke være negativt'],
    ['-0', 'Beløbet kan ikke være negativt'],
    ['1,2,3', 'Beløbet ser forkert ud'],
    ['1.25.0', 'Beløbet ser forkert ud'],
    ['1,250.50', 'Beløbet ser forkert ud'], // English format
    ['1.2345', 'Beløbet ser forkert ud'],
    ['12.345.67', 'Beløbet ser forkert ud'],
    ['1.2345,00', 'Beløbet ser forkert ud'],
    ['.', 'Beløbet ser forkert ud'],
    [',', 'Skriv et beløb, fx 450'],
    [',-', 'Skriv et beløb, fx 450'],
    ['kr', 'Skriv et beløb, fx 450'],
    ['kr.', 'Skriv et beløb, fx 450'],
    ['12,345', 'Højst to decimaler'],
    ['1.250,505', 'Højst to decimaler'],
    ['1.250.000', 'Beløbet er for stort'], // 1,25 mio. kr. > 1 mio. kr.
    ['1.000.000,01', 'Beløbet er for stort'],
    ['1000001', 'Beløbet er for stort'],
    ['1234567890', 'Beløbet er for stort'],
    ['99999999999999999999', 'Beløbet er for stort']
  ])('%j → %s', (input, message) => {
    expect(err(input)).toBe(message);
  });

  it('every error message is one of the known Danish texts', () => {
    const inputs = ['x', '-1', '1,,2', '9'.repeat(30), '1.2.3', '1,234', 'kr', '.', '1..2', '١٢٣'];
    for (const s of inputs) expect(MESSAGES.has(err(s))).toBe(true);
  });
});

describe('formatAmount / formatNumber', () => {
  it('uses dot as thousands separator, comma for øre and a non-breaking space before kr.', () => {
    expect(formatAmount(45_000)).toBe(`450${NBSP}kr.`);
    expect(formatAmount(125_050)).toBe(`1.250,50${NBSP}kr.`);
    expect(formatAmount(0)).toBe(`0${NBSP}kr.`);
    expect(formatAmount(MAX_AMOUNT_ORE)).toBe(`1.000.000${NBSP}kr.`);
    expect(formatAmount(45_000)).not.toContain(' ');
  });

  it.each([
    [125_000, '1.250'],
    [125_050, '1.250,50'],
    [5, '0,05'],
    [99, '0,99'],
    [100, '1'],
    [1_234_567, '12.345,67'],
    [99_999_999, '999.999,99'],
    [-5_000, '-50'],
    [-125_050, '-1.250,50'],
    [45_000.6, '450,01'], // rounds to whole øre
    [0.4, '0']
  ])('formatNumber(%d) → %s', (n, s) => {
    expect(formatNumber(n)).toBe(s);
  });
});

describe('formatAmountInput', () => {
  it.each([
    [null, ''],
    [0, '0'],
    [45_000, '450'],
    [125_050, '1250,50'],
    [125_000, '1250'],
    [5, '0,05'],
    [MAX_AMOUNT_ORE, '1000000']
  ])('%j → %j', (n, s) => {
    expect(formatAmountInput(n)).toBe(s);
  });
});

describe('round trips', () => {
  const samples: number[] = [0, 1, 5, 9, 10, 50, 99, 100, 101, 999, 45_000, 125_050, 99_999_999, MAX_AMOUNT_ORE];
  const rand = rng(42);
  for (let i = 0; i < 3000; i++) samples.push(Math.floor(rand() * (MAX_AMOUNT_ORE + 1)));

  it('parseAmount(formatAmountInput(x)) === x', () => {
    for (const x of samples) expect(ore(formatAmountInput(x))).toBe(x);
  });

  it('parseAmount(formatNumber(x)) === x and parseAmount(formatAmount(x)) === x', () => {
    for (const x of samples) {
      expect(ore(formatNumber(x))).toBe(x);
      expect(ore(formatAmount(x))).toBe(x);
    }
  });

  it('oreFromKroner(kronerFromOre(x)) === x (backup file ↔ database)', () => {
    for (const x of samples) expect(oreFromKroner(kronerFromOre(x))).toBe(x);
  });
});

describe('oreFromKroner', () => {
  it.each([
    [450, 45_000],
    [1250.5, 125_050],
    [0.1 + 0.2, 30],
    [19.99, 1_999],
    [0.29, 29], // 28.999999999999996 before rounding
    [1.1, 110],
    [4.35, 435],
    [0, 0],
    [0.004, 0],
    [1_000_000, MAX_AMOUNT_ORE]
  ])('%d kr → %d øre', (kr, o) => {
    expect(oreFromKroner(kr)).toBe(o);
  });

  it.each([-1, -0.001, NaN, Infinity, -Infinity, 1_000_000.01, 1e21, Number.MAX_VALUE])('rejects %d', (v) => {
    expect(oreFromKroner(v)).toBeNull();
  });

  it.each(['450', null, undefined, true, {}, [450], 450n])('rejects non-number #%#', (v) => {
    expect(oreFromKroner(v)).toBeNull();
  });

  it('-0 is treated as zero', () => {
    expect(oreFromKroner(-0) === 0).toBe(true);
  });
});

describe('kronerFromOre', () => {
  it('divides by 100', () => {
    expect(kronerFromOre(125_050)).toBe(1250.5);
    expect(kronerFromOre(0)).toBe(0);
    expect(kronerFromOre(1)).toBe(0.01);
  });
});
