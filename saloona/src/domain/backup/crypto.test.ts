import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, PBKDF2_ITERATIONS, decryptBackup, encryptBackup } from './crypto';
import { readBackupText, type EncryptedEnvelope } from './validate';
import { fixtureText } from '../../../tests/helpers/factories';

// A low iteration count keeps the suite fast; 100.000 is the lowest the reader accepts.
const FAST = 100_000;
const PASSWORD = 'Kaffe og klip 2026';
const WRONG = 'Forkert adgangskode, eller filen er beskadiget.';

async function envelopeFor(plain: string, password = PASSWORD, iterations = FAST): Promise<EncryptedEnvelope> {
  const text = await encryptBackup(plain, password, iterations);
  const r = readBackupText(text);
  if (r.kind !== 'encrypted') throw new Error(`expected encrypted, got ${r.kind}`);
  return r.envelope;
}

function b64len(b64: string): number {
  return atob(b64).length;
}

/** Flips one base64 character to another valid one, keeping the length. */
function flip(b64: string, at: number): string {
  const c = b64[at]!;
  return b64.slice(0, at) + (c === 'A' ? 'B' : 'A') + b64.slice(at + 1);
}

describe('constants', () => {
  it('match the plan', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe('password length', () => {
  it('refuses to encrypt with a password shorter than MIN_PASSWORD_LENGTH', async () => {
    await expect(encryptBackup('{}', '', FAST)).rejects.toThrow(RangeError);
    await expect(encryptBackup('{}', 'kort', FAST)).rejects.toThrow(RangeError);
    await expect(encryptBackup('{}', '1234567', FAST)).rejects.toThrow('Adgangskoden er for kort');
  });

  it('accepts exactly MIN_PASSWORD_LENGTH characters', async () => {
    const pw = '12345678';
    expect(pw).toHaveLength(MIN_PASSWORD_LENGTH);
    const out = await decryptBackup(await envelopeFor('{"a":1}', pw), pw);
    expect(out).toEqual({ ok: true, text: '{"a":1}' });
  });
});

describe('round trip', () => {
  it('encrypts and decrypts the prototype backup', async () => {
    const plain = fixtureText('salonbog-backup.json');
    const env = await envelopeFor(plain);
    const out = await decryptBackup(env, PASSWORD);
    expect(out).toEqual({ ok: true, text: plain });
    const again = readBackupText(out.ok ? out.text : '');
    expect(again.kind).toBe('plain');
  });

  it('keeps æøå, emoji and line breaks', async () => {
    const plain = JSON.stringify({ note: 'Søren Ærø-Åberg 💇‍♀️\r\nLinje 2' });
    const out = await decryptBackup(await envelopeFor(plain, 'æøå-ÆØÅ-kodeord'), 'æøå-ÆØÅ-kodeord');
    expect(out).toEqual({ ok: true, text: plain });
  });

  it('handles a large file (base64 in chunks)', async () => {
    const plain = JSON.stringify({ pad: 'x'.repeat(300_000), tail: 'slut' });
    const out = await decryptBackup(await envelopeFor(plain), PASSWORD);
    expect(out.ok && out.text === plain).toBe(true);
  });

  it('the envelope has the documented shape and hides the content', async () => {
    const plain = fixtureText('salonbog-backup.json');
    const text = await encryptBackup(plain, PASSWORD, FAST);
    expect(text).not.toContain('Holger');
    expect(text).not.toContain(PASSWORD);
    const env = JSON.parse(text) as EncryptedEnvelope;
    expect(env.app).toBe('saloona');
    expect(env.format).toBe('encrypted');
    expect(env.version).toBe(1);
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: FAST });
    expect(env.cipher.name).toBe('AES-GCM');
    expect(b64len(env.kdf.salt)).toBe(16);
    expect(b64len(env.cipher.iv)).toBe(12);
    // AES-GCM adds a 16-byte tag.
    expect(b64len(env.data)).toBe(new TextEncoder().encode(plain).length + 16);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = JSON.parse(await encryptBackup('{}', PASSWORD, FAST)) as EncryptedEnvelope;
    const b = JSON.parse(await encryptBackup('{}', PASSWORD, FAST)) as EncryptedEnvelope;
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('the default (600.000 iterations) produces a file the reader accepts', async () => {
    const text = await encryptBackup('{"clients":[],"visits":[]}', PASSWORD);
    const r = readBackupText(text);
    expect(r.kind).toBe('encrypted');
    if (r.kind === 'encrypted') expect(r.envelope.kdf.iterations).toBe(600_000);
  });
});

describe('wrong password and damaged files', () => {
  it('a wrong password gives a Danish error, not an exception', async () => {
    const env = await envelopeFor('{"clients":[],"visits":[]}');
    await expect(decryptBackup(env, 'forkert-kodeord')).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup(env, '')).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup(env, PASSWORD.toLowerCase())).resolves.toEqual({ ok: false, error: WRONG });
  });

  it('tampered data is detected', async () => {
    const env = await envelopeFor('{"clients":[],"visits":[]}');
    for (const at of [0, Math.floor(env.data.length / 2), env.data.length - 4]) {
      await expect(decryptBackup({ ...env, data: flip(env.data, at) }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    }
  });

  it('truncated or extended data is detected', async () => {
    const env = await envelopeFor('{"clients":[],"visits":[]}');
    await expect(decryptBackup({ ...env, data: env.data.slice(0, -8) }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup({ ...env, data: `${env.data}AAAA` }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
  });

  it('a tampered IV, salt or iteration count is detected', async () => {
    const env = await envelopeFor('{"clients":[],"visits":[]}');
    await expect(decryptBackup({ ...env, cipher: { ...env.cipher, iv: flip(env.cipher.iv, 0) } }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup({ ...env, kdf: { ...env.kdf, salt: flip(env.kdf.salt, 0) } }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup({ ...env, kdf: { ...env.kdf, iterations: FAST + 1 } }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
  });

  it('base64 that passes the reader’s pattern but cannot be decoded is an error, not an exception', async () => {
    const env = await envelopeFor('{}');
    // "abcde" matches /^[A-Za-z0-9+/]+={0,2}$/ but has an impossible length for base64.
    expect(readBackupText(JSON.stringify({ ...env, kdf: { ...env.kdf, salt: 'abcde' } })).kind).toBe('encrypted');
    await expect(decryptBackup({ ...env, kdf: { ...env.kdf, salt: 'abcde' } }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup({ ...env, data: 'abcde' }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
    await expect(decryptBackup({ ...env, cipher: { ...env.cipher, iv: 'A' } }, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
  });

  it('decrypted bytes that are not valid UTF-8 are rejected', async () => {
    // Encrypt raw invalid UTF-8 with the same scheme and check the fatal decoder.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSWORD), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: FAST }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([0xff, 0xfe, 0xfd])));
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const env: EncryptedEnvelope = {
      app: 'saloona',
      format: 'encrypted',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: FAST, salt: b64(salt) },
      cipher: { name: 'AES-GCM', iv: b64(iv) },
      data: b64(data)
    };
    await expect(decryptBackup(env, PASSWORD)).resolves.toEqual({ ok: false, error: WRONG });
  });
});
