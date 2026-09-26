import { describe, expect, it } from 'vitest';
import { countByDay, dayAgenda, findOverlaps, formatTimeRange, fromMinutes, isoWeek, toMinutes, weekOf } from './calendar';
import { treatmentOptions } from './pricing';
import type { Client, Treatment, Visit } from './types';

const NOW = '2026-09-26T10:00:00.000Z';
const client = (id: string, name: string): Client => ({ id, name, gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW });
const visit = (id: string, clientId: string, key: string, date: string, time: string | null, createdAt = NOW): Visit => ({
  id, clientId, treatment: key.charAt(0).toUpperCase() + key.slice(1), treatmentKey: key, date, time, amountOre: null, pay: null, note: '', createdAt, updatedAt: createdAt
});
const t = (key: string, durationMin: number | null, priceOre: number | null = null): Treatment => ({
  key, label: key.charAt(0).toUpperCase() + key.slice(1), priceOre, durationMin, updatedAt: NOW
});

const clients = new Map([['a', client('a', 'Anna')], ['b', client('b', 'Bo')], ['c', client('c', 'Carl')]]);
const catalog = new Map([['klip', t('klip', 45)], ['farve', t('farve', 90)]]);

describe('time helpers', () => {
  it('converts between "HH:MM" and minutes and clamps to the day', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('14:30')).toBe(870);
    expect(fromMinutes(870 + 45)).toBe('15:15');
    expect(fromMinutes(-5)).toBe('00:00');
    expect(fromMinutes(24 * 60 + 30)).toBe('23:59');
  });

  it('formats ranges Danish style', () => {
    expect(formatTimeRange('14:30', '15:15')).toBe('kl. 14.30–15.15');
    expect(formatTimeRange('09:00', null)).toBe('kl. 09.00');
  });
});

describe('weeks', () => {
  it('starts weeks on Monday, across month and year ends', () => {
    expect(weekOf('2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weekOf('2027-01-03')[0]).toBe('2026-12-28');
    expect(weekOf('2026-09-28')[0]).toBe('2026-09-28'); // a Monday
  });

  it('computes ISO week numbers, including week 53 and week 1 in late December', () => {
    expect(isoWeek('2026-09-26')).toBe(39);
    expect(isoWeek('2026-12-31')).toBe(53);
    expect(isoWeek('2027-01-03')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
    expect(isoWeek('2024-12-30')).toBe(1);
  });

  it('counts visits per day', () => {
    const days = weekOf('2026-10-01');
    const counts = countByDay([visit('1', 'a', 'klip', '2026-10-01', null), visit('2', 'b', 'klip', '2026-10-01', '10:00'), visit('3', 'a', 'klip', '2026-11-01', null)], days);
    expect(counts.get('2026-10-01')).toBe(2);
    expect(counts.get('2026-09-28')).toBe(0);
  });
});

describe('dayAgenda', () => {
  const day = '2026-10-02';
  const visits = [
    visit('late', 'c', 'klip', day, '16:00'),
    visit('x1', 'a', 'farve', day, '10:00'), // 10:00–11:30
    visit('x2', 'b', 'klip', day, '11:00'), // 11:00–11:45 overlaps x1
    visit('free', 'c', 'skæg', day, '12:00'), // unknown duration → 30 min for overlap checks
    visit('none', 'a', 'klip', day, null),
    visit('other-day', 'a', 'klip', '2026-10-03', '10:00'),
    visit('ghost', 'zz', 'klip', day, '10:00') // unknown client is left out
  ];
  const agenda = dayAgenda(visits, clients, catalog, day);

  it('orders timed items by start and keeps untimed ones apart', () => {
    expect(agenda.timed.map((i) => i.visit.id)).toEqual(['x1', 'x2', 'free', 'late']);
    expect(agenda.untimed.map((i) => i.visit.id)).toEqual(['none']);
  });

  it('computes end times from the price list and marks overlaps both ways', () => {
    const byId = new Map(agenda.timed.map((i) => [i.visit.id, i]));
    expect(byId.get('x1')).toMatchObject({ start: '10:00', end: '11:30', durationMin: 90, overlapsWith: ['x2'] });
    expect(byId.get('x2')?.overlapsWith).toEqual(['x1']);
    expect(byId.get('free')).toMatchObject({ end: null, durationMin: null, overlapsWith: [] });
    expect(byId.get('late')?.overlapsWith).toEqual([]);
  });

  it('back-to-back appointments do not overlap', () => {
    const a = dayAgenda([visit('p', 'a', 'klip', day, '10:00'), visit('q', 'b', 'klip', day, '10:45')], clients, catalog, day);
    expect(a.timed.every((i) => i.overlapsWith.length === 0)).toBe(true);
  });
});

describe('findOverlaps (while booking)', () => {
  const day = '2026-10-02';
  const visits = [visit('x1', 'a', 'farve', day, '10:00'), visit('x2', 'b', 'klip', day, '13:00'), visit('n', 'c', 'klip', day, null)];

  it('finds appointments the new one would collide with, using its own duration', () => {
    expect(findOverlaps(visits, catalog, { date: day, time: '11:00', treatmentKey: 'klip' }).map((v) => v.id)).toEqual(['x1']);
    expect(findOverlaps(visits, catalog, { date: day, time: '11:30', treatmentKey: 'klip' })).toEqual([]);
    expect(findOverlaps(visits, catalog, { date: day, time: '12:30', treatmentKey: 'farve' }).map((v) => v.id)).toEqual(['x2']);
  });

  it('ignores the appointment being edited, other days and entries without a time', () => {
    expect(findOverlaps(visits, catalog, { id: 'x1', date: day, time: '10:15', treatmentKey: 'farve' })).toEqual([]);
    expect(findOverlaps(visits, catalog, { date: '2026-10-03', time: '10:00', treatmentKey: 'klip' })).toEqual([]);
    expect(findOverlaps(visits, catalog, { date: day, time: '', treatmentKey: 'klip' })).toEqual([]);
  });
});

describe('treatmentOptions with a price list', () => {
  it('adds unused price-list entries last and uses the price-list name', () => {
    const used = [visit('1', 'a', 'klip', '2026-09-01', null), { ...visit('2', 'a', 'klip', '2026-09-02', null), treatment: 'klip' }];
    const options = treatmentOptions(used, null, new Map([['klip', { ...t('klip', 45), label: 'Klip' }], ['striber', t('striber', 120)]]));
    expect(options.map((o) => [o.label, o.count])).toEqual([['Klip', 2], ['Striber', 0]]);
  });
});
