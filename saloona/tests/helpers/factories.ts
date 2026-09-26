/**
 * Small builders for domain objects in unit tests.
 * Kept outside src/ so they do not count towards coverage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { treatmentKey } from '../../src/domain/text';
import type { Client, PayMethod, Visit } from '../../src/domain/types';

export function visit(
  clientId: string,
  treatment: string,
  date: string,
  extra: Partial<Visit> & { amountKr?: number } = {}
): Visit {
  const { amountKr, ...rest } = extra;
  return {
    id: rest.id ?? `v-${clientId}-${date}-${treatmentKey(treatment).replace(/[^a-z0-9]/g, '')}`,
    clientId,
    treatment,
    treatmentKey: treatmentKey(treatment),
    date,
    amountOre: amountKr !== undefined ? Math.round(amountKr * 100) : null,
    pay: null,
    note: '',
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T09:00:00.000Z`,
    ...rest
  };
}

export function paid(clientId: string, treatment: string, date: string, kr: number, pay: PayMethod | null = null, extra: Partial<Visit> = {}): Visit {
  return visit(clientId, treatment, date, { amountKr: kr, pay, ...extra });
}

export function client(id: string, name: string, extra: Partial<Client> = {}): Client {
  return {
    id,
    name,
    gender: null,
    tag: null,
    phone: null,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra
  };
}

export function clientMap(...clients: Client[]): Map<string, Client> {
  return new Map(clients.map((c) => [c.id, c]));
}

/** Reads a file from tests/fixtures as text. */
export function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Deterministic PRNG (mulberry32) for fuzz-style tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
