import { describe, expect, it } from 'vitest';
import { genderFromName, guessGender, inferGenders, isChild, treatmentGender } from './gender';
import type { Client, Treatment, Visit } from './types';

const NOW = '2026-09-26T10:00:00.000Z';
const tr = (key: string, gender: Treatment['gender']): Treatment => ({ key, label: key, priceOre: null, durationMin: null, gender, updatedAt: NOW });
const client = (id: string, gender: Client['gender'] = null, tag: string | null = null): Client => ({
  id, name: id, gender, tag, phone: null, note: '', createdAt: NOW, updatedAt: NOW
});
const visit = (clientId: string, treatment: string, date = '2026-09-01'): Visit => ({
  id: `${clientId}-${treatment}-${date}`,
  clientId,
  treatment,
  treatmentKey: treatment.toLocaleLowerCase('da'),
  date,
  amountOre: null,
  pay: null,
  note: '',
  createdAt: NOW,
  updatedAt: NOW
});

describe('genderFromName', () => {
  it.each([
    ['Herreklip', 'herre'],
    ['HERRE KLIP', 'herre'],
    ['Drengeklip', 'herre'],
    ['Dameklip', 'dame'],
    ['Dame, kort', 'dame'],
    ['Pigeklip', 'dame'],
    ['Klip', null],
    ['Farve', null],
    ['Børneklip', null],
    ['Dame- og herreklip', null],
    ['Pige/drengeklip', null],
    ['', null]
  ] as const)('%s → %s', (name, expected) => {
    expect(genderFromName(name)).toBe(expected);
  });
});

describe('treatmentGender', () => {
  it('the price list decides; null there means both, even for "Herreklip"', () => {
    const catalog = new Map([['herreklip', tr('herreklip', null)], ['klip', tr('klip', 'dame')]]);
    expect(treatmentGender('herreklip', 'Herreklip', catalog)).toBeNull();
    expect(treatmentGender('klip', 'Klip', catalog)).toBe('dame');
  });

  it('a treatment that is not on the list is read from its name', () => {
    expect(treatmentGender('herreklip', 'Herreklip', new Map())).toBe('herre');
    expect(treatmentGender('farve', 'Farve', new Map())).toBeNull();
  });
});

describe('guessGender', () => {
  it('known when every gendered treatment agrees, ignoring treatments for both', () => {
    expect(guessGender([visit('a', 'Klip'), visit('a', 'Herreklip'), visit('a', 'Farve')], new Map())).toEqual({ kind: 'known', gender: 'herre' });
  });

  it('mixed when both appear, unknown when none', () => {
    expect(guessGender([visit('a', 'Herreklip'), visit('a', 'Dameklip')], new Map())).toEqual({ kind: 'mixed' });
    expect(guessGender([visit('a', 'Klip')], new Map())).toEqual({ kind: 'unknown' });
    expect(guessGender([], new Map())).toEqual({ kind: 'unknown' });
  });

  it('a booking counts too', () => {
    expect(guessGender([visit('a', 'Dameklip', '2099-01-01')], new Map())).toEqual({ kind: 'known', gender: 'dame' });
  });
});

describe('inferGenders', () => {
  const clients = [client('a'), client('b'), client('c'), client('d', 'dame'), client('e')];
  const visits = [
    visit('a', 'Herreklip'),
    visit('a', 'Klip'),
    visit('b', 'Herreklip'),
    visit('b', 'Dameklip'), // mixed: left to the user
    visit('c', 'Klip'), // unknown: left to the user
    visit('d', 'Herreklip') // already set: never changed
  ];

  it('only fills in clients without a gender whose treatments agree', () => {
    expect(inferGenders(clients, visits, new Map())).toEqual([{ id: 'a', gender: 'herre' }]);
  });

  it('uses the price list: "Klip" set to dame makes c a dame', () => {
    expect(inferGenders(clients, visits, new Map([['klip', tr('klip', 'dame')]]))).toEqual([{ id: 'c', gender: 'dame' }]);
  });

  it('nothing to do when every client has a gender', () => {
    expect(inferGenders([client('d', 'dame')], visits, new Map())).toEqual([]);
  });
});

describe('isChild', () => {
  it('matches the tag "Barn" or "Børn" in any case, with spaces', () => {
    expect(isChild({ tag: 'Barn' })).toBe(true);
    expect(isChild({ tag: ' barn ' })).toBe(true);
    expect(isChild({ tag: 'BØRN' })).toBe(true);
    expect(isChild({ tag: 'Barnebarn' })).toBe(false);
    expect(isChild({ tag: 'Nabo' })).toBe(false);
    expect(isChild({ tag: null })).toBe(false);
  });
});
