import { describe, expect, it } from 'vitest';
import { buildBackup } from './backup/export';
import { readBackupText } from './backup/validate';
import { formatTime } from './dates';
import { compareAppointments } from './rhythm';
import { isValidTime, type Visit } from './types';

const NOW = '2026-09-26T10:00:00.000Z';

function visit(id: string, date: string, time: string | null, createdAt = NOW): Visit {
  return { id, clientId: 'c1', treatment: 'Klip', treatmentKey: 'klip', date, time, amountOre: null, pay: null, note: '', createdAt, updatedAt: createdAt };
}

describe('time of day', () => {
  it('validates HH:MM from 00:00 to 23:59', () => {
    for (const t of ['00:00', '09:05', '14:30', '23:59']) expect(isValidTime(t)).toBe(true);
    for (const t of ['24:00', '9:05', '14:60', '1430', '14.30', '', ' 14:30', null, 1430]) expect(isValidTime(t)).toBe(false);
  });

  it('formats Danish style', () => {
    expect(formatTime('14:30')).toBe('kl. 14.30');
    expect(formatTime(null)).toBe('');
  });

  it('sorts appointments by date, then time (no time last), then entry order', () => {
    const list = [
      visit('d', '2026-10-02', null),
      visit('c', '2026-10-02', '16:00'),
      visit('b', '2026-10-02', '09:30'),
      visit('a', '2026-10-01', null),
      visit('e', '2026-10-02', null, '2026-09-27T00:00:00.000Z')
    ];
    expect(list.sort(compareAppointments).map((v) => v.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('round-trips through a Saloona backup and drops an invalid time with a warning', () => {
    const client = { id: 'c1', name: 'Maria', gender: null, tag: null, phone: null, note: '', createdAt: NOW, updatedAt: NOW };
    const file = buildBackup([client], [visit('v1', '2026-10-02', '14:30'), visit('v2', '2026-10-03', null)], new Map(), new Date(NOW));
    expect(file.visits[0]?.time).toBe('14:30');
    expect(file.visits[1]).not.toHaveProperty('time');
    const text = JSON.stringify(file).replace('"14:30"', '"25:99"');
    const read = readBackupText(JSON.stringify(file));
    if (read.kind !== 'plain') throw new Error('expected plain');
    expect(read.backup.visits.map((v) => v.time)).toEqual(['14:30', null]);
    const bad = readBackupText(text);
    if (bad.kind !== 'plain') throw new Error('expected plain');
    expect(bad.backup.visits[0]?.time).toBeNull();
    expect(bad.backup.warnings).toEqual(['1 tidspunkt var ugyldigt og blev fjernet']);
  });
});
