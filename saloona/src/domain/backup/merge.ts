/**
 * Turns a validated backup into the rows to write.
 *
 * Replace: everything in the app is replaced by the file.
 * Merge:   clients are matched on id, then on name (ignoring case).
 *          Visits are matched on id, then on client + date + treatment.
 *          Existing data wins; only empty fields on existing clients are filled in.
 */
import { treatmentKey } from '../text';
import { newId, type Client, type Visit } from '../types';
import type { ParsedBackup } from './validate';

export type ImportMode = 'replace' | 'merge';

export interface ExistingData {
  clients: readonly Client[];
  visits: readonly Visit[];
  prices: ReadonlyMap<string, number>;
}

export interface ImportStats {
  clientsInFile: number;
  visitsInFile: number;
  newClients: number;
  matchedClients: number;
  newVisits: number;
  duplicateVisits: number;
}

export interface ImportPlan {
  mode: ImportMode;
  insertClients: Client[];
  updateClients: Client[];
  insertVisits: Visit[];
  prices: [string, number][];
  stats: ImportStats;
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase('da');
}

export function planImport(
  existing: ExistingData,
  incoming: ParsedBackup,
  mode: ImportMode,
  now: string,
  makeId: () => string = newId
): ImportPlan {
  const stats: ImportStats = {
    clientsInFile: incoming.clients.length,
    visitsInFile: incoming.visits.length,
    newClients: 0,
    matchedClients: 0,
    newVisits: 0,
    duplicateVisits: 0
  };

  if (mode === 'replace') {
    stats.newClients = incoming.clients.length;
    stats.newVisits = incoming.visits.length;
    return {
      mode,
      insertClients: incoming.clients.map((c) => ({ ...c, createdAt: now, updatedAt: now })),
      updateClients: [],
      insertVisits: incoming.visits.map((v) => ({ ...v, createdAt: now, updatedAt: now })),
      prices: [...incoming.prices],
      stats
    };
  }

  const byId = new Map(existing.clients.map((c) => [c.id, c]));
  const byName = new Map<string, Client>();
  for (const c of existing.clients) if (!byName.has(nameKey(c.name))) byName.set(nameKey(c.name), c);

  const usedClientIds = new Set(existing.clients.map((c) => c.id));
  const idMap = new Map<string, string>();
  const insertClients: Client[] = [];
  const updates = new Map<string, Client>();

  for (const c of incoming.clients) {
    const match = byId.get(c.id) ?? byName.get(nameKey(c.name));
    if (match) {
      stats.matchedClients++;
      idMap.set(c.id, match.id);
      const base = updates.get(match.id) ?? match;
      const filled: Client = {
        ...base,
        gender: base.gender ?? c.gender,
        tag: base.tag ?? c.tag,
        phone: base.phone ?? c.phone,
        note: base.note || c.note
      };
      if (filled.gender !== base.gender || filled.tag !== base.tag || filled.phone !== base.phone || filled.note !== base.note) {
        updates.set(match.id, { ...filled, updatedAt: now });
      }
      continue;
    }
    const id = usedClientIds.has(c.id) ? makeId() : c.id;
    usedClientIds.add(id);
    idMap.set(c.id, id);
    const client: Client = { ...c, id, createdAt: now, updatedAt: now };
    insertClients.push(client);
    byName.set(nameKey(client.name), client);
    stats.newClients++;
  }

  const visitIds = new Set(existing.visits.map((v) => v.id));
  const signature = (clientId: string, date: string, key: string) => `${clientId}\u0000${date}\u0000${key}`;
  const signatures = new Set(existing.visits.map((v) => signature(v.clientId, v.date, v.treatmentKey)));
  const insertVisits: Visit[] = [];

  for (const v of incoming.visits) {
    const clientId = idMap.get(v.clientId);
    if (!clientId) continue; // validated earlier; defensive
    const key = treatmentKey(v.treatment);
    const sig = signature(clientId, v.date, key);
    if (visitIds.has(v.id) || signatures.has(sig)) {
      stats.duplicateVisits++;
      continue;
    }
    visitIds.add(v.id);
    signatures.add(sig);
    insertVisits.push({ ...v, clientId, treatmentKey: key, createdAt: now, updatedAt: now });
    stats.newVisits++;
  }

  const prices: [string, number][] = [];
  for (const [k, ore] of incoming.prices) if (!existing.prices.has(k)) prices.push([k, ore]);

  return { mode, insertClients, updateClients: [...updates.values()], insertVisits, prices, stats };
}
