/**
 * Turns a validated backup into the rows to write.
 *
 * Replace: everything in the app is replaced by the file.
 * Merge:   clients are matched on id, then on name (ignoring case).
 *          Visits are matched on id, then on client + date + treatment.
 *          Existing data wins; only empty fields on existing clients are filled in.
 */
import { treatmentKey } from '../text';
import { newId, type Client, type Treatment, type Visit } from '../types';
import type { ParsedBackup } from './validate';

export type ImportMode = 'replace' | 'merge';

export interface ExistingData {
  clients: readonly Client[];
  visits: readonly Visit[];
  prices: ReadonlyMap<string, number>;
  treatments?: ReadonlyMap<string, Treatment>;
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
  /** Price-list entries to insert or update. */
  treatments: Treatment[];
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
      prices: incoming.treatments ? [] : [...incoming.prices],
      treatments: (incoming.treatments ?? []).map((t) => ({ ...t, updatedAt: now })),
      stats
    };
  }

  const byId = new Map(existing.clients.map((c) => [c.id, c]));
  // Several existing clients may share a name; each can be claimed once.
  const byName = new Map<string, Client[]>();
  for (const c of existing.clients) {
    const k = nameKey(c.name);
    const list = byName.get(k);
    if (list) list.push(c);
    else byName.set(k, [c]);
  }

  const usedClientIds = new Set(existing.clients.map((c) => c.id));
  const idMap = new Map<string, string>();
  const insertClients: Client[] = [];
  const updates = new Map<string, Client>();

  // Pass 1: id matches claim their client first, so a same-named client with
  // another id in the file can never be merged into it.
  const claimed = new Set<string>();
  for (const c of incoming.clients) {
    const m = byId.get(c.id);
    if (m) claimed.add(m.id);
  }

  for (const c of incoming.clients) {
    let match = byId.get(c.id);
    if (!match) {
      match = byName.get(nameKey(c.name))?.find((x) => !claimed.has(x.id));
      if (match) claimed.add(match.id);
    }
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
    stats.newClients++;
  }

  const visitIds = new Set(existing.visits.map((v) => v.id));
  const signature = (clientId: string, date: string, key: string) => `${clientId}\u0000${date}\u0000${key}`;
  // Multiset: a family client can have several "Klip" the same day. Each existing
  // visit absorbs at most one look-alike from the file; the rest are new.
  const existingBySig = new Map<string, number>();
  for (const v of existing.visits) {
    const sig = signature(v.clientId, v.date, v.treatmentKey);
    existingBySig.set(sig, (existingBySig.get(sig) ?? 0) + 1);
  }
  const insertVisits: Visit[] = [];

  for (const v of incoming.visits) {
    const clientId = idMap.get(v.clientId);
    if (!clientId) continue; // validated earlier; defensive
    const key = treatmentKey(v.treatment);
    const sig = signature(clientId, v.date, key);
    if (visitIds.has(v.id)) {
      stats.duplicateVisits++;
      continue;
    }
    const left = existingBySig.get(sig) ?? 0;
    if (left > 0) {
      existingBySig.set(sig, left - 1);
      stats.duplicateVisits++;
      continue;
    }
    visitIds.add(v.id);
    insertVisits.push({ ...v, clientId, treatmentKey: key, createdAt: now, updatedAt: now });
    stats.newVisits++;
  }

  const prices: [string, number][] = [];
  // A file with its own price list brings it in below; its `prices` are only there for Salonbog.
  if (!incoming.treatments) for (const [k, ore] of incoming.prices) if (!existing.prices.has(k)) prices.push([k, ore]);

  // Price list: new treatments are added; existing ones only get blanks filled in.
  const treatments: Treatment[] = [];
  for (const t of incoming.treatments ?? []) {
    const cur = existing.treatments?.get(t.key);
    if (!cur) treatments.push({ ...t, updatedAt: now });
    else if ((cur.priceOre === null && t.priceOre !== null) || (cur.durationMin === null && t.durationMin !== null)) {
      treatments.push({ ...cur, priceOre: cur.priceOre ?? t.priceOre, durationMin: cur.durationMin ?? t.durationMin, updatedAt: now });
    }
  }

  return { mode, insertClients, updateClients: [...updates.values()], insertVisits, prices, treatments, stats };
}
