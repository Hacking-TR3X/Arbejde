import { describe, expect, it } from 'vitest';
import {
  GENDERS,
  GENDER_LABELS,
  PAY_LABELS,
  PAY_METHODS,
  isCompleted,
  isGender,
  isPayMethod,
  isValidId,
  newId
} from './types';

describe('enums', () => {
  it('genders', () => {
    expect(GENDERS).toEqual(['dame', 'herre']);
    for (const g of GENDERS) expect(isGender(g)).toBe(true);
    for (const v of ['Dame', 'HERRE', 'mand', 'kvinde', '', null, undefined, 0, ['dame']]) expect(isGender(v)).toBe(false);
    expect(Object.keys(GENDER_LABELS).sort()).toEqual([...GENDERS].sort());
  });

  it('pay methods', () => {
    expect(PAY_METHODS).toEqual(['kontant', 'mp_mig', 'mp_noah']);
    for (const p of PAY_METHODS) expect(isPayMethod(p)).toBe(true);
    for (const v of ['Kontant', 'mobilepay', 'kort', '', null, undefined, 1, {}]) expect(isPayMethod(v)).toBe(false);
    expect(PAY_LABELS).toEqual({ kontant: 'Kontant', mp_mig: 'MobilePay mig', mp_noah: 'MobilePay Noah' });
  });
});

describe('isCompleted (visit vs. booked appointment)', () => {
  it('today counts as completed, tomorrow is booked', () => {
    expect(isCompleted({ date: '2026-09-25' }, '2026-09-26')).toBe(true);
    expect(isCompleted({ date: '2026-09-26' }, '2026-09-26')).toBe(true);
    expect(isCompleted({ date: '2026-09-27' }, '2026-09-26')).toBe(false);
    expect(isCompleted({ date: '2027-01-01' }, '2026-12-31')).toBe(false);
    expect(isCompleted({ date: '2026-12-31' }, '2027-01-01')).toBe(true);
  });
});

describe('isValidId', () => {
  it.each(['a', 'c01', 'A-b_9', 'x'.repeat(64), 'k3j2l1m0n9b8v7c6x5z4'])('accepts %j', (id) => {
    expect(isValidId(id)).toBe(true);
  });

  it.each(['', 'x'.repeat(65), 'a b', 'a.b', 'a/b', 'æ', 'id\n', '../x', 123, null, undefined, {}])('rejects %j', (id) => {
    expect(isValidId(id)).toBe(false);
  });

  it('rejects the reserved names "__proto__", "constructor" and "prototype"', () => {
    expect(isValidId('__proto__')).toBe(false);
    expect(isValidId('constructor')).toBe(false);
    expect(isValidId('prototype')).toBe(false);
    // Only the exact names are reserved.
    expect(isValidId('__proto')).toBe(true);
    expect(isValidId('Constructor')).toBe(true);
    expect(isValidId('prototype1')).toBe(true);
  });
});

describe('newId', () => {
  it('returns valid, 20-character, unique ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newId();
      expect(id).toHaveLength(20);
      expect(id).toMatch(/^[0-9a-z]{20}$/);
      expect(isValidId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });
});
