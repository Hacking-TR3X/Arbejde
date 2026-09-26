import { describe, expect, it } from 'vitest';
import type { Client, Visit } from '../domain/types';
import { reminderText } from './reminders';

const NOW = '2026-01-01T00:00:00.000Z';

function client(id: string, name: string): Client {
  return { id, name, gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
}

function visit(id: string, clientId: string, date: string): Visit {
  return { id, clientId, treatment: 'Klip', treatmentKey: 'klip', date, amountOre: null, pay: null, note: '', createdAt: NOW, updatedAt: NOW };
}

/** Three visits 28 days apart → next expected 28 days after the last. */
function regular(prefix: string, clientId: string, last: string, offsets = [56, 28, 0]): Visit[] {
  const lastDay = new Date(`${last}T00:00:00Z`).getTime();
  return offsets.map((o, i) => visit(`${prefix}${i}`, clientId, new Date(lastDay - o * 86_400_000).toISOString().slice(0, 10)));
}

describe('reminderText', () => {
  const clients = new Map([
    ['a', client('a', 'Anna')],
    ['b', client('b', 'Bo')],
    ['c', client('c', 'Carl')],
    ['d', client('d', 'Dorthe')]
  ]);

  it('returns null when nobody is overdue', () => {
    expect(reminderText(regular('a', 'a', '2026-09-20'), clients, '2026-09-26', false)).toBeNull();
  });

  it('names up to three clients and counts the rest', () => {
    const visits = [
      ...regular('a', 'a', '2026-08-01'),
      ...regular('b', 'b', '2026-08-02'),
      ...regular('c', 'c', '2026-08-03'),
      ...regular('d', 'd', '2026-08-04')
    ];
    const t = reminderText(visits, clients, '2026-09-26', false);
    expect(t?.title).toBe('4 kunder er over tid');
    expect(t?.body).toMatch(/og 1 til$/);
  });

  it('joins two names with "og"', () => {
    const visits = [...regular('a', 'a', '2026-08-01'), ...regular('b', 'b', '2026-08-02')];
    expect(reminderText(visits, clients, '2026-09-26', false)?.body).toMatch(/^(Anna|Bo) og (Anna|Bo)$/);
  });

  it('never shows names when the app lock is on', () => {
    const t = reminderText(regular('a', 'a', '2026-08-01'), clients, '2026-09-26', true);
    expect(t).toEqual({ title: '1 kunde er over tid', body: 'Åbn Saloona for at se hvem.' });
  });

  it('does not remind about a client with a booked appointment', () => {
    const visits = [...regular('a', 'a', '2026-08-01'), visit('future', 'a', '2026-10-02')];
    expect(reminderText(visits, clients, '2026-09-26', false)).toBeNull();
  });
});
