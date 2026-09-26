import type { ISODate } from './dates';

export type Gender = 'dame' | 'herre';
export type PayMethod = 'kontant' | 'mp_mig' | 'mp_noah';

export const GENDERS: readonly Gender[] = ['dame', 'herre'];
export const PAY_METHODS: readonly PayMethod[] = ['kontant', 'mp_mig', 'mp_noah'];

export const PAY_LABELS: Record<PayMethod, string> = {
  kontant: 'Kontant',
  mp_mig: 'MobilePay mig',
  mp_noah: 'MobilePay Noah'
};

export const GENDER_LABELS: Record<Gender, string> = {
  dame: 'Dame',
  herre: 'Herre'
};

export interface Client {
  id: string;
  name: string;
  gender: Gender | null;
  /** Short label shown next to the name, e.g. "Barn". */
  tag: string | null;
  phone: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Visit {
  id: string;
  clientId: string;
  treatment: string;
  treatmentKey: string;
  date: ISODate;
  /** Optional time of day, "HH:MM" (24 h). */
  time?: string | null;
  amountOre: number | null;
  pay: PayMethod | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** An entry in the price list: standard price and duration for a treatment. */
export interface Treatment {
  /** treatmentKey(label) */
  key: string;
  label: string;
  priceOre: number | null;
  durationMin: number | null;
  /** Who it is for; null means both. */
  gender: Gender | null;
  updatedAt: string;
}

export const DURATION_MIN = 5;
export const DURATION_MAX = 600;

/** Whole minutes, 5–600. */
export function isValidDuration(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= DURATION_MIN && v <= DURATION_MAX;
}

export function isGender(v: unknown): v is Gender {
  return v === 'dame' || v === 'herre';
}

export function isPayMethod(v: unknown): v is PayMethod {
  return v === 'kontant' || v === 'mp_mig' || v === 'mp_noah';
}

/** A visit is completed when its date has come; a future date is a booked appointment. */
export function isCompleted(visit: Pick<Visit, 'date'>, today: ISODate): boolean {
  return visit.date <= today;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM", 00:00–23:59. */
export function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v);
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v) && !RESERVED_IDS.has(v);
}

/** Random 20-character id (base36, ~103 bits). */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out + Date.now().toString(36).slice(-4);
}
