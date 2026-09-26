/**
 * Who a treatment is for, and the client's gender read from their treatments.
 */
import type { Client, Gender, Treatment, Visit } from './types';

const HERRE_RE = /herre|drenge/;
const DAME_RE = /dame|pige/;

/** "Herreklip" → herre, "Pigeklip" → dame, "Klip" or "Dame- og herreklip" → null. */
export function genderFromName(name: string): Gender | null {
  const n = name.toLocaleLowerCase('da');
  const herre = HERRE_RE.test(n);
  const dame = DAME_RE.test(n);
  if (herre === dame) return null;
  return herre ? 'herre' : 'dame';
}

/**
 * Who a treatment is for. An entry in the price list decides (null there means
 * both); a treatment that is not on the list is read from its name.
 */
export function treatmentGender(key: string, label: string, catalog: ReadonlyMap<string, Treatment>): Gender | null {
  const t = catalog.get(key);
  return t ? t.gender : genderFromName(label);
}

export type GenderGuess = { kind: 'known'; gender: Gender } | { kind: 'mixed' } | { kind: 'unknown' };

/** A client's gender from their visits and bookings: known when every gendered treatment agrees. */
export function guessGender(visits: readonly Visit[], catalog: ReadonlyMap<string, Treatment>): GenderGuess {
  let found: Gender | null = null;
  for (const v of visits) {
    const g = treatmentGender(v.treatmentKey, v.treatment, catalog);
    if (!g) continue;
    if (found && found !== g) return { kind: 'mixed' };
    found = g;
  }
  return found ? { kind: 'known', gender: found } : { kind: 'unknown' };
}

/** Clients without a gender whose treatments point to exactly one. */
export function inferGenders(
  clients: readonly Client[],
  visits: readonly Visit[],
  catalog: ReadonlyMap<string, Treatment>
): { id: string; gender: Gender }[] {
  const missing = new Set(clients.filter((c) => !c.gender).map((c) => c.id));
  if (missing.size === 0) return [];
  const byClient = new Map<string, Visit[]>();
  for (const v of visits) {
    if (!missing.has(v.clientId)) continue;
    const list = byClient.get(v.clientId);
    if (list) list.push(v);
    else byClient.set(v.clientId, [v]);
  }
  const out: { id: string; gender: Gender }[] = [];
  for (const [id, list] of byClient) {
    const guess = guessGender(list, catalog);
    if (guess.kind === 'known') out.push({ id, gender: guess.gender });
  }
  return out;
}

/** The client is marked as a child ("Barn" or "Børn" as their tag). */
export function isChild(c: Pick<Client, 'tag'>): boolean {
  const t = c.tag?.trim().toLocaleLowerCase('da');
  return t === 'barn' || t === 'børn';
}
