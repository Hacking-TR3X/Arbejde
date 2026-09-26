/**
 * Reads a backup file. The file is untrusted input: every field is checked,
 * unknown fields are ignored, and bad entries are skipped with a warning.
 * A file that is structurally wrong is rejected as a whole.
 *
 * Accepted formats:
 *  - Salonbog prototype:  { app: "salonbog", version, exported, clients, visits, prices }
 *  - Saloona:             { app: "saloona", version: 2, ... } (superset: tag, phone)
 *  - Saloona encrypted:   { app: "saloona", format: "encrypted", kdf, cipher, data }
 */
import { isValidISODate, type ISODate } from '../dates';
import { oreFromKroner, parseAmount } from '../money';
import { LIMITS, cleanLine, cleanMultiline, normalizePhone, treatmentKey } from '../text';
import { isGender, isPayMethod, isValidId, type Gender, type PayMethod } from '../types';

export const MAX_FILE_CHARS = 20_000_000;
export const MAX_CLIENTS = 20_000;
export const MAX_VISITS = 200_000;
export const MAX_PRICES = 2_000;

export interface ImportClient {
  id: string;
  name: string;
  gender: Gender | null;
  tag: string | null;
  phone: string | null;
  note: string;
}

export interface ImportVisit {
  id: string;
  clientId: string;
  treatment: string;
  treatmentKey: string;
  date: ISODate;
  amountOre: number | null;
  pay: PayMethod | null;
  note: string;
}

export interface ParsedBackup {
  source: 'salonbog' | 'saloona';
  exported: string | null;
  clients: ImportClient[];
  visits: ImportVisit[];
  prices: Map<string, number>;
  warnings: string[];
}

export interface EncryptedEnvelope {
  app: 'saloona';
  format: 'encrypted';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

export type ReadResult =
  | { kind: 'plain'; backup: ParsedBackup }
  | { kind: 'encrypted'; envelope: EncryptedEnvelope }
  | { kind: 'error'; error: string };

const NOT_A_BACKUP = 'Filen er ikke en backup fra Saloona eller Salonbog.';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads an own property only, so inherited or prototype keys are never used. */
function own(o: Obj, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

function optString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

class Warnings {
  private counts = new Map<string, number>();
  add(kind: string, n = 1) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + n);
  }
  list(): string[] {
    const out: string[] = [];
    for (const [kind, n] of this.counts) out.push(WARNING_TEXT[kind]?.(n) ?? `${n} fejl (${kind})`);
    return out;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Picks the singular or plural form of a word that follows the count (adjectives included). */
const pick = (n: number, one: string, many: string) => (n === 1 ? one : many);

const WARNING_TEXT: Record<string, (n: number) => string> = {
  clientInvalid: (n) => `${plural(n, 'kunde', 'kunder')} uden gyldigt id eller navn blev sprunget over`,
  clientDuplicate: (n) => `${plural(n, 'kunde', 'kunder')} stod der to gange og blev kun taget med én gang`,
  visitInvalid: (n) => `${plural(n, 'besøg', 'besøg')} med manglende eller ugyldige felter blev sprunget over`,
  visitDate: (n) => `${plural(n, 'besøg', 'besøg')} med ugyldig dato blev sprunget over`,
  visitOrphan: (n) => `${plural(n, 'besøg', 'besøg')} hørte ikke til nogen kunde og blev sprunget over`,
  visitDuplicate: (n) => `${plural(n, 'besøg', 'besøg')} stod der to gange og blev kun taget med én gang`,
  amountInvalid: (n) => `${plural(n, 'beløb', 'beløb')} var ${pick(n, 'ugyldigt', 'ugyldige')} og blev fjernet`,
  payInvalid: (n) => `${plural(n, 'betalingsmåde', 'betalingsmåder')} var ${pick(n, 'ukendt', 'ukendte')} og blev fjernet`,
  genderInvalid: (n) => `${plural(n, 'kunde', 'kunder')} havde et ukendt køn, som blev fjernet`,
  phoneInvalid: (n) => `${plural(n, 'telefonnummer', 'telefonnumre')} var ${pick(n, 'ugyldigt', 'ugyldige')} og blev fjernet`,
  priceInvalid: (n) => `${plural(n, 'standardpris', 'standardpriser')} var ${pick(n, 'ugyldig', 'ugyldige')} og blev sprunget over`,
  priceTooMany: (n) => `${plural(n, 'standardpris', 'standardpriser')} ud over de første ${MAX_PRICES} blev sprunget over`
};

/**
 * Ids from other apps are used as they are when they have a safe format.
 * Other string or integer ids are accepted but replaced by a fresh id, so a file
 * with unusual ids still imports with its client–visit links intact.
 */
function rawIdKey(v: unknown): string | null {
  if (typeof v === 'string' && v.length >= 1 && v.length <= 128) return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  return null;
}

/**
 * Deterministic replacement for an id in an unsafe format (FNV-1a, 64 bit), so
 * reading the same file twice gives the same ids and "Flet" recognises it.
 */
function derivedId(raw: string, prefix: string, taken: Set<string>): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < raw.length; i++) {
    h ^= BigInt(raw.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const base = `${prefix}${h.toString(36)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

export function readBackupText(text: string): ReadResult {
  if (text.length > MAX_FILE_CHARS) return { kind: 'error', error: 'Filen er for stor til at være en backup.' };
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { kind: 'error', error: NOT_A_BACKUP };
  }
  if (!isObj(root)) return { kind: 'error', error: NOT_A_BACKUP };

  const app = own(root, 'app');
  if (app !== undefined && app !== 'salonbog' && app !== 'saloona') return { kind: 'error', error: NOT_A_BACKUP };

  if (own(root, 'format') === 'encrypted') {
    const env = readEnvelope(root);
    return env ? { kind: 'encrypted', envelope: env } : { kind: 'error', error: 'Den krypterede backup er beskadiget.' };
  }

  const clients = own(root, 'clients');
  const visits = own(root, 'visits');
  if (!Array.isArray(clients) || !Array.isArray(visits)) return { kind: 'error', error: NOT_A_BACKUP };
  if (clients.length > MAX_CLIENTS || visits.length > MAX_VISITS) {
    return { kind: 'error', error: 'Filen indeholder flere kunder eller besøg, end appen kan håndtere.' };
  }

  const source = app === 'saloona' ? 'saloona' : 'salonbog';
  const w = new Warnings();
  const clientIdMap = new Map<string, string>();
  const outClients = readClients(clients, source, w, clientIdMap);
  const outVisits = readVisits(visits, clientIdMap, w);
  const prices = readPrices(own(root, 'prices'), w);
  const exported = optString(own(root, 'exported'));

  return {
    kind: 'plain',
    backup: {
      source,
      exported: exported && exported.length <= 40 ? exported : null,
      clients: outClients,
      visits: outVisits,
      prices,
      warnings: w.list()
    }
  };
}

function readClients(
  list: unknown[],
  source: 'salonbog' | 'saloona',
  w: Warnings,
  idMap: Map<string, string>
): ImportClient[] {
  const out: ImportClient[] = [];
  // Safe ids are kept as they are; reserve them so a derived id never collides.
  const takenClientIds = new Set<string>();
  for (const raw of list) {
    const k = isObj(raw) ? rawIdKey(own(raw, 'id')) : null;
    if (k !== null && isValidId(k)) takenClientIds.add(k);
  }
  for (const raw of list) {
    if (!isObj(raw)) {
      w.add('clientInvalid');
      continue;
    }
    const key = rawIdKey(own(raw, 'id'));
    const nameRaw = own(raw, 'name');
    const name = typeof nameRaw === 'string' ? cleanLine(nameRaw, LIMITS.name) : '';
    if (key === null || !name) {
      w.add('clientInvalid');
      continue;
    }
    if (idMap.has(key)) {
      w.add('clientDuplicate');
      continue;
    }
    const id = isValidId(key) ? key : derivedId(key, 'k', takenClientIds);
    takenClientIds.add(id);
    idMap.set(key, id);

    const g = own(raw, 'gender');
    let gender: Gender | null = null;
    if (isGender(g)) gender = g;
    else if (g !== undefined && g !== null && g !== '') w.add('genderInvalid');

    const noteRaw = optString(own(raw, 'note')) ?? '';
    let note = cleanMultiline(noteRaw, LIMITS.note);
    let tag: string | null = null;
    let phone: string | null = null;

    if (source === 'saloona') {
      const t = optString(own(raw, 'tag'));
      tag = t ? cleanLine(t, LIMITS.tag) || null : null;
      const pRaw = own(raw, 'phone');
      const p = typeof pRaw === 'number' && Number.isSafeInteger(pRaw) ? String(pRaw) : optString(pRaw);
      if (p) {
        const n = normalizePhone(p.slice(0, LIMITS.phone * 2));
        if (n === false) w.add('phoneInvalid');
        else phone = n;
      }
    } else if (note && note.length <= 16 && /^\S+$/.test(note)) {
      // The prototype only had a note per client and used it as a short label such as "Barn".
      tag = note;
      note = '';
    }

    out.push({ id, name, gender, tag, phone, note });
  }
  return out;
}

function readVisits(list: unknown[], clientIdMap: ReadonlyMap<string, string>, w: Warnings): ImportVisit[] {
  const out: ImportVisit[] = [];
  const seen = new Set<string>();
  const takenVisitIds = new Set<string>();
  for (const raw of list) {
    const k = isObj(raw) ? rawIdKey(own(raw, 'id')) : null;
    if (k !== null && isValidId(k)) takenVisitIds.add(k);
  }
  for (const raw of list) {
    if (!isObj(raw)) {
      w.add('visitInvalid');
      continue;
    }
    const key = rawIdKey(own(raw, 'id'));
    const clientKey = rawIdKey(own(raw, 'clientId'));
    const treatmentRaw = own(raw, 'treatment');
    const treatment = typeof treatmentRaw === 'string' ? cleanLine(treatmentRaw, LIMITS.treatment) : '';
    const date = own(raw, 'date');
    if (key === null || clientKey === null || !treatment) {
      w.add('visitInvalid');
      continue;
    }
    if (!isValidISODate(date)) {
      w.add('visitDate');
      continue;
    }
    const clientId = clientIdMap.get(clientKey);
    if (clientId === undefined) {
      w.add('visitOrphan');
      continue;
    }
    if (seen.has(key)) {
      w.add('visitDuplicate');
      continue;
    }
    seen.add(key);
    const id = isValidId(key) ? key : derivedId(key, 'b', takenVisitIds);
    takenVisitIds.add(id);

    const amountRaw = own(raw, 'amount');
    let amountOre: number | null = null;
    if (typeof amountRaw === 'number') {
      amountOre = oreFromKroner(amountRaw);
      if (amountOre === null) w.add('amountInvalid');
    } else if (typeof amountRaw === 'string' && amountRaw.length <= 20) {
      const p = parseAmount(amountRaw);
      if (p.ok) amountOre = p.ore;
      else w.add('amountInvalid');
    } else if (amountRaw !== undefined && amountRaw !== null) {
      w.add('amountInvalid');
    }

    const payRaw = own(raw, 'pay');
    let pay: PayMethod | null = null;
    if (isPayMethod(payRaw)) pay = payRaw;
    else if (payRaw !== undefined && payRaw !== null && payRaw !== '') w.add('payInvalid');

    const note = cleanMultiline(optString(own(raw, 'note')) ?? '', LIMITS.note);
    out.push({ id, clientId, treatment, treatmentKey: treatmentKey(treatment), date, amountOre, pay, note });
  }
  return out;
}

function readPrices(raw: unknown, w: Warnings): Map<string, number> {
  const out = new Map<string, number>();
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    w.add('priceInvalid');
    return out;
  }
  const keys = Object.keys(raw);
  if (keys.length > MAX_PRICES) w.add('priceTooMany', keys.length - MAX_PRICES);
  for (const key of keys.slice(0, MAX_PRICES)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const k = treatmentKey(key);
    const value = own(raw, key);
    let ore: number | null = null;
    if (typeof value === 'number') ore = oreFromKroner(value);
    else if (typeof value === 'string' && value.length <= 20) {
      const p = parseAmount(value);
      ore = p.ok ? p.ore : null;
    }
    if (!k || ore === null) {
      w.add('priceInvalid');
      continue;
    }
    out.set(k, ore);
  }
  return out;
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function readEnvelope(root: Obj): EncryptedEnvelope | null {
  const kdf = own(root, 'kdf');
  const cipher = own(root, 'cipher');
  const data = own(root, 'data');
  if (own(root, 'app') !== 'saloona' || own(root, 'version') !== 1) return null;
  if (!isObj(kdf) || !isObj(cipher) || typeof data !== 'string') return null;
  const iterations = own(kdf, 'iterations');
  const salt = own(kdf, 'salt');
  const iv = own(cipher, 'iv');
  if (own(kdf, 'name') !== 'PBKDF2' || own(kdf, 'hash') !== 'SHA-256') return null;
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) return null;
  if (typeof salt !== 'string' || !B64_RE.test(salt) || salt.length > 64) return null;
  if (own(cipher, 'name') !== 'AES-GCM' || typeof iv !== 'string' || !B64_RE.test(iv) || iv.length > 32) return null;
  if (!B64_RE.test(data) || data.length > MAX_FILE_CHARS) return null;
  return {
    app: 'saloona',
    format: 'encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    cipher: { name: 'AES-GCM', iv },
    data
  };
}
