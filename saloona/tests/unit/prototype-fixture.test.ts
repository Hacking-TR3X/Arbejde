/**
 * End-to-end through the domain layer with the prototype backup:
 * import → "Snart tid" → earnings → suggestions → export → merge again.
 * "Today" is fixed at 2026-09-26 (the fixture's export date).
 */
import { describe, expect, it } from 'vitest';
import { readBackupText } from '../../src/domain/backup/validate';
import { planImport, type ExistingData } from '../../src/domain/backup/merge';
import { buildBackup, serializeBackup } from '../../src/domain/backup/export';
import { dueOverview } from '../../src/domain/rhythm';
import { computeEarnings, monthBars } from '../../src/domain/earnings';
import { suggestPay, suggestPrice, treatmentOptions } from '../../src/domain/pricing';
import { formatAmount } from '../../src/domain/money';
import { formatInterval } from '../../src/domain/dates';
import { fixtureText } from '../helpers/factories';

const TODAY = '2026-09-26';
const NOW = '2026-09-26T10:00:00.000Z';

function load(): ExistingData {
  const r = readBackupText(fixtureText('salonbog-backup.json'));
  if (r.kind !== 'plain') throw new Error('fixture did not parse');
  const plan = planImport({ clients: [], visits: [], prices: new Map() }, r.backup, 'replace', NOW);
  return { clients: plan.insertClients, visits: plan.insertVisits, prices: new Map(plan.prices) };
}

const data = load();
const clients = new Map(data.clients.map((c) => [c.id, c]));
const nameOf = (id: string) => clients.get(id)?.name;

describe('Snart tid after importing the prototype backup', () => {
  const o = dueOverview(data.visits, clients, TODAY);

  it('over tid: Mads (43 days) before Lauge (10 days); Hanne is hidden by her booking', () => {
    expect(o.late.map((r) => [nameOf(r.clientId), r.treatment, r.daysUntil])).toEqual([
      ['Mads', 'Klip', -43],
      ['Lauge', 'Klip', -10]
    ]);
    expect(o.late.some((r) => nameOf(r.clientId) === 'Hanne')).toBe(false);
  });

  it('inden for 2 uger: Sirius in exactly 14 days', () => {
    expect(o.soon.map((r) => [nameOf(r.clientId), r.treatment, r.daysUntil])).toEqual([['Sirius', 'Børneklip', 14]]);
  });

  it('senere: Morten every 35 days, next 2026-10-31', () => {
    expect(o.later.map((r) => [nameOf(r.clientId), r.expected, formatInterval(r.intervalDays!)])).toEqual([
      ['Morten', '2026-10-31', 'hver 5. uge']
    ]);
  });

  it('kommende aftaler: Hanne, Farve, 2026-10-02', () => {
    expect(o.upcoming.map((u) => [u.client?.name, u.visit.treatment, u.visit.date])).toEqual([['Hanne', 'Farve', '2026-10-02']]);
  });

  it('samler data: Buster first (2 dates), then single visits newest first', () => {
    const list = o.collecting.map((r) => `${nameOf(r.clientId)}/${r.treatment}/${r.dates.length}`);
    expect(list[0]).toBe('Buster/Børneklip/2');
    expect(list).toContain('Morten/Skæg/1');
    expect(list).toContain('Gammel skoleveninde/Klip/1');
    expect(list.at(-1)).toBe('Gammel skoleveninde/Klip/1'); // oldest single visit (2026-02-27)
  });
});

describe('Indtjening after importing the prototype backup', () => {
  it('this month: 5 visits, 4.050 kr.', () => {
    const e = computeEarnings(data.visits, clients, 'month', TODAY);
    expect(e.count).toBe(5);
    expect(e.total).toBe(405_000);
    expect(formatAmount(e.total)).toBe('4.050 kr.');
    expect(e.average).toBe(81_000);
    expect(e.topClients[0]).toMatchObject({ label: 'Familie Køge', total: 160_000 });
  });

  it('last month (August): 5 visits, 1.600 kr., all paid', () => {
    const e = computeEarnings(data.visits, clients, 'lastMonth', TODAY);
    expect(e.count).toBe(5);
    expect(e.total).toBe(160_000);
    expect(e.missing).toEqual([]);
  });

  it('all: the booking is not counted, the unpaid visits are listed', () => {
    const e = computeEarnings(data.visits, clients, 'all', TODAY);
    expect(e.count).toBe(27);
    expect(e.missing.map((v) => v.id).sort()).toEqual(['v01', 'v02', 'v03', 'v06', 'v07', 'v11', 'v12', 'v15', 'v18', 'v27']);
    expect(e.missing.some((v) => v.date > TODAY)).toBe(false);
  });

  it('six months of bars, April–September', () => {
    const bars = monthBars(data.visits, TODAY);
    expect(bars.map((b) => b.label)).toEqual(['apr', 'maj', 'jun', 'jul', 'aug', 'sep']);
    expect(bars.at(-1)).toMatchObject({ total: 405_000, current: true });
  });
});

describe('Suggestions in the visit sheet', () => {
  const defaults = data.prices;

  it('prices', () => {
    expect(suggestPrice(data.visits, 'c01', 'klip', defaults, TODAY)).toBe(45_000); // Morten, own
    expect(suggestPrice(data.visits, 'c09', 'klip', defaults, TODAY)).toBe(35_000); // Farmor, own
    expect(suggestPrice(data.visits, 'c07', 'klip', defaults, TODAY)).toBe(45_000); // Arne, latest anyone
    expect(suggestPrice(data.visits, 'c10', 'farve', defaults, TODAY)).toBe(125_050); // Laura, Hanne's latest
    expect(suggestPrice(data.visits, 'c08', 'permanent', defaults, TODAY)).toBe(70_000);
    expect(suggestPrice(data.visits, 'c01', 'hårkur', defaults, TODAY)).toBeNull();
  });

  it('payment method', () => {
    expect(suggestPay(data.visits, 'c01')).toBe('kontant'); // Morten's latest
    expect(suggestPay(data.visits, 'c08')).toBe('mp_mig');
    expect(suggestPay(data.visits, 'c07')).toBe('kontant'); // Arne never paid – most used overall
  });

  it('treatment chips: most used first, Morten’s own first for Morten', () => {
    expect(treatmentOptions(data.visits).map((o) => o.label)).toEqual(['Klip', 'Børneklip', 'Farve', 'Farve + klip', 'Skæg', 'Permanent']);
    expect(treatmentOptions(data.visits, 'c01').slice(0, 2).map((o) => o.key)).toEqual(['klip', 'skæg']);
  });
});

describe('Export and merge back', () => {
  it('exporting and merging the export into the same data adds nothing', () => {
    const text = serializeBackup(buildBackup(data.clients, data.visits, data.prices, new Date(NOW)));
    const r = readBackupText(text);
    if (r.kind !== 'plain') throw new Error('export did not parse');
    const plan = planImport(data, r.backup, 'merge', NOW);
    expect(plan.stats).toEqual({ clientsInFile: 13, visitsInFile: 28, newClients: 0, matchedClients: 13, newVisits: 0, duplicateVisits: 28 });
    expect(plan.updateClients).toEqual([]);
  });
});
