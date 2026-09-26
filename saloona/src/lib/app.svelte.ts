/**
 * Application state and every action that changes data.
 * Screens read from `app` and call its methods; nothing else talks to the repository.
 */
import { buildBackup, backupFileName, serializeBackup } from '../domain/backup/export';
import { encryptBackup } from '../domain/backup/crypto';
import { planImport, type ImportMode, type ImportPlan } from '../domain/backup/merge';
import type { ParsedBackup } from '../domain/backup/validate';
import { diffDays, formatDateShort, formatTime, isValidISODate, todayISO, type ISODate } from '../domain/dates';
import { parseAmount } from '../domain/money';
import { LIMITS, cleanLine, cleanMultiline, normalizePhone, treatmentKey } from '../domain/text';
import { isValidTime, newId, type Client, type Gender, type PayMethod, type Visit } from '../domain/types';
import { DbKeyLostError, DbTooNewError } from '../data/db';
import { migrate } from '../data/migrations';
import { destroyDb, discardUnreadableDb, openDb } from '../data/open';
import { DEFAULT_SETTINGS, Repo, type Settings } from '../data/repo';
import {
  authenticate,
  clearExportCache,
  haptic,
  lockAvailability,
  onAppStateChange,
  saveFile,
  setSecureScreen,
  setSystemBars,
  shareFile
} from '../platform';
import { cancelReminders, remindersSupported, requestReminderPermission, scheduleReminders } from '../platform/reminders';
import { snackbar } from './snackbar.svelte';

export type Phase = 'loading' | 'ready' | 'keylost' | 'toonew' | 'error';

export interface VisitDraft {
  id?: string;
  clientId: string | null;
  clientName: string;
  newClientGender: Gender | null;
  treatment: string;
  amountText: string;
  pay: PayMethod | null;
  date: ISODate;
  /** "HH:MM" or '' for no time. */
  time: string;
  note: string;
}

export interface ClientDraft {
  /** Absent when creating a new client. */
  id?: string;
  name: string;
  gender: Gender | null;
  tag: string;
  phone: string;
  note: string;
}

export type FieldErrors = Partial<Record<'client' | 'treatment' | 'amount' | 'date' | 'time' | 'name' | 'phone', string>>;

export type Result = { ok: true; id?: string } | { ok: false; errors: FieldErrors };

export const BACKUP_NUDGE_DAYS = 14;
/** Grace period (seconds) for a trip to a system picker or share sheet started by the app. */
const EXTERNAL_GRACE_S = 300;

class AppState {
  phase = $state<Phase>('loading');
  locked = $state(false);
  authenticating = $state(false);
  /** False while the app is in the background. */
  active = $state(true);
  /** Increments every time the app returns to the foreground (the lock screen prompts once per return). */
  activations = $state(0);

  clients = $state.raw<Client[]>([]);
  visits = $state.raw<Visit[]>([]);
  prices = $state.raw<Map<string, number>>(new Map());
  settings = $state.raw<Settings>({ ...DEFAULT_SETTINGS });
  today = $state<ISODate>(todayISO());

  clientMap = $derived(new Map(this.clients.map((c) => [c.id, c])));

  /**
   * True when there is something to lose and no backup has been taken for
   * BACKUP_NUDGE_DAYS: counted from the last backup, or – if there never was one –
   * from when the oldest visit was entered. An import counts as a backup (the data
   * is in the imported file).
   */
  backupDue = $derived.by(() => {
    if (this.visits.length === 0) return false;
    let since = this.settings.lastBackupAt;
    if (!since) {
      for (const v of this.visits) if (!since || v.createdAt < since) since = v.createdAt;
    }
    if (!since) return false;
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return true;
    return diffDays(todayISO(d), this.today) >= BACKUP_NUDGE_DAYS;
  });

  /** Days since the last backup, or null if there never was one. */
  daysSinceBackup = $derived.by(() => {
    const last = this.settings.lastBackupAt;
    if (!last) return null;
    const d = new Date(last);
    return Number.isNaN(d.getTime()) ? null : diffDays(todayISO(d), this.today);
  });

  private repo: Repo | null = null;
  private backgroundSince: number | null = null;
  private backgroundExternal = false;
  private ignoreBackgroundUntil = 0;
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- start-up ----------

  async start(): Promise<void> {
    this.watchClock();
    onAppStateChange((active) => this.onAppState(active));
    // Plain-text backups shared earlier must not linger, whatever happens next.
    await clearExportCache();
    try {
      const db = await openDb();
      await migrate(db);
      this.repo = new Repo(db);
      await this.reload();
      this.applyTheme();
      if (this.settings.lockEnabled) {
        this.locked = true;
        await setSecureScreen(true);
      }
      this.phase = 'ready';
      this.queueReminders();
    } catch (e) {
      if (e instanceof DbKeyLostError) this.phase = 'keylost';
      else if (e instanceof DbTooNewError) this.phase = 'toonew';
      else this.phase = 'error';
    }
  }

  private async reload(): Promise<void> {
    if (!this.repo) return;
    const s = await this.repo.load();
    this.clients = s.clients;
    this.visits = s.visits;
    this.prices = s.prices;
    this.settings = s.settings;
  }

  private get db(): Repo {
    if (!this.repo) throw new Error('Databasen er ikke åben');
    return this.repo;
  }

  private watchClock(): void {
    const tick = () => {
      const t = todayISO();
      if (t !== this.today) {
        this.today = t;
        this.queueReminders();
      }
    };
    setInterval(tick, 30_000);
  }

  /**
   * Re-lock after the app has been in the background.
   * A trip to a system picker/share sheet started by us still counts as background
   * time, but with a grace period of at least EXTERNAL_GRACE_S so a quick save does
   * not force a new unlock. With "Straks" the app locks as soon as it is hidden.
   */
  private onAppState(active: boolean): void {
    if (!active) {
      this.active = false;
      if (this.backgroundSince !== null) return;
      this.backgroundSince = Date.now();
      // The system PIN screen of an ongoing prompt also pauses the app; treat it like
      // our own pickers (grace period) instead of ignoring it.
      this.backgroundExternal = this.authenticating || Date.now() < this.ignoreBackgroundUntil;
      if (this.settings.lockEnabled && this.settings.lockAfterSeconds === 0 && !this.backgroundExternal) this.lockNow();
      return;
    }
    this.active = true;
    this.activations += 1;
    this.today = todayISO();
    const since = this.backgroundSince;
    const external = this.backgroundExternal;
    this.backgroundSince = null;
    this.backgroundExternal = false;
    this.ignoreBackgroundUntil = 0;
    if (since === null || !this.settings.lockEnabled || this.locked) return;
    const limit = external ? Math.max(this.settings.lockAfterSeconds, EXTERNAL_GRACE_S) : this.settings.lockAfterSeconds;
    if ((Date.now() - since) / 1000 >= limit) this.lockNow();
  }

  private lockNow(): void {
    this.locked = true;
    snackbar.dismiss();
  }

  /** Call right before opening a system picker/share sheet (see onAppState). */
  expectExternalActivity(): void {
    this.ignoreBackgroundUntil = Date.now() + 10 * 60_000;
  }

  // ---------- lock ----------

  async unlock(): Promise<'ok' | 'canceled' | 'lockout' | 'failed' | 'unavailable'> {
    if (this.authenticating) return 'canceled';
    this.authenticating = true;
    try {
      const res = await authenticate();
      if (res.success) {
        this.locked = false;
        this.backgroundSince = null;
        return 'ok';
      }
      return res.error;
    } finally {
      this.authenticating = false;
    }
  }

  async setLock(enabled: boolean): Promise<'ok' | 'unavailable' | 'canceled'> {
    if (enabled) {
      const avail = await lockAvailability();
      if (!avail.available) return 'unavailable';
    }
    // Turning the lock on proves the phone's credential works; turning it off
    // requires the owner, not just whoever holds the unlocked app.
    if (enabled || (await lockAvailability()).available) {
      this.authenticating = true;
      const res = await authenticate().finally(() => (this.authenticating = false));
      if (!res.success) return res.error === 'unavailable' && enabled ? 'unavailable' : 'canceled';
    }
    await this.db.saveSettings({ lockEnabled: enabled });
    this.settings = { ...this.settings, lockEnabled: enabled };
    await setSecureScreen(enabled);
    this.queueReminders();
    return 'ok';
  }

  async setLockAfter(seconds: number): Promise<void> {
    await this.db.saveSettings({ lockAfterSeconds: seconds });
    this.settings = { ...this.settings, lockAfterSeconds: seconds };
  }

  // ---------- appearance ----------

  async setTheme(theme: Settings['theme']): Promise<void> {
    await this.db.saveSettings({ theme });
    this.settings = { ...this.settings, theme };
    this.applyTheme();
  }

  applyTheme(): void {
    const t = this.settings.theme;
    const root = document.documentElement;
    if (t === 'system') delete root.dataset.theme;
    else root.dataset.theme = t;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setSystemBars(dark);
  }

  async finishOnboarding(): Promise<void> {
    await this.db.saveSettings({ onboarded: true });
    this.settings = { ...this.settings, onboarded: true };
  }

  // ---------- visits ----------

  validateVisit(d: VisitDraft): FieldErrors {
    const errors: FieldErrors = {};
    if (!d.clientId && !cleanLine(d.clientName, LIMITS.name)) errors.client = 'Skriv eller vælg en kunde';
    if (d.clientId && !this.clientMap.has(d.clientId)) errors.client = 'Kunden findes ikke længere';
    if (!cleanLine(d.treatment, LIMITS.treatment)) errors.treatment = 'Skriv eller vælg en behandling';
    const amount = parseAmount(d.amountText);
    if (!amount.ok) errors.amount = amount.error;
    if (!isValidISODate(d.date)) errors.date = 'Vælg en gyldig dato';
    if (d.time && !isValidTime(d.time)) errors.time = 'Vælg et tidspunkt, fx 14:30';
    return errors;
  }

  /** Finds an existing client by exact name (ignoring case), used when a name is typed. */
  findClientByName(name: string): Client | undefined {
    const key = cleanLine(name, LIMITS.name).toLocaleLowerCase('da');
    if (!key) return undefined;
    return this.clients.find((c) => c.name.toLocaleLowerCase('da') === key);
  }

  async saveVisit(d: VisitDraft): Promise<Result> {
    const errors = this.validateVisit(d);
    if (Object.keys(errors).length) {
      haptic('reject');
      return { ok: false, errors };
    }
    const now = new Date().toISOString();
    const amount = parseAmount(d.amountText);
    let clientId = d.clientId;
    let newClient: Client | undefined;
    if (!clientId) {
      const existing = this.findClientByName(d.clientName);
      if (existing) clientId = existing.id;
      else {
        newClient = {
          id: newId(),
          name: cleanLine(d.clientName, LIMITS.name),
          gender: d.newClientGender,
          tag: null,
          phone: null,
          note: '',
          createdAt: now,
          updatedAt: now
        };
        clientId = newClient.id;
      }
    }
    const treatment = cleanLine(d.treatment, LIMITS.treatment);
    const base = {
      clientId,
      treatment,
      treatmentKey: treatmentKey(treatment),
      date: d.date,
      time: d.time || null,
      amountOre: amount.ok ? amount.ore : null,
      pay: d.pay,
      note: cleanMultiline(d.note, LIMITS.note),
      updatedAt: now
    };
    const old = d.id ? this.visits.find((v) => v.id === d.id) : undefined;
    if (old) await this.db.saveVisit({ ...old, ...base }, newClient);
    else await this.db.addVisit({ id: newId(), createdAt: now, ...base }, newClient);
    await this.afterChange();
    haptic('confirm');
    const booked = d.date > this.today;
    const who = newClient?.name ?? this.clientMap.get(clientId)?.name ?? '';
    const when = booked ? ` ${formatDateShort(d.date, this.today)}${d.time ? ` ${formatTime(d.time)}` : ''}` : '';
    snackbar.show(old ? 'Besøget er opdateret' : booked ? `Aftale med ${who} er booket${when}` : `Besøg for ${who} er gemt`);
    return { ok: true };
  }

  async deleteVisit(id: string): Promise<void> {
    const v = this.visits.find((x) => x.id === id);
    if (!v) return;
    await this.db.deleteVisit(id);
    await this.afterChange();
    haptic('confirm');
    snackbar.show(v.date > this.today ? 'Aftalen er slettet' : 'Besøget er slettet', {
      label: 'Fortryd',
      run: async () => {
        if (!this.clientMap.has(v.clientId)) return;
        await this.db.restoreVisit(v);
        await this.afterChange();
      }
    });
  }

  /** Fills in a missing amount from the earnings screen. */
  async setVisitAmount(id: string, amountText: string): Promise<Result> {
    const v = this.visits.find((x) => x.id === id);
    const amount = parseAmount(amountText);
    if (!v) return { ok: false, errors: {} };
    if (!amount.ok || amount.ore === null) return { ok: false, errors: { amount: amount.ok ? 'Skriv et beløb' : amount.error } };
    await this.db.saveVisit({ ...v, amountOre: amount.ore, updatedAt: new Date().toISOString() });
    await this.afterChange();
    haptic('confirm');
    return { ok: true };
  }

  // ---------- clients ----------

  async saveClient(d: ClientDraft): Promise<Result> {
    const errors: FieldErrors = {};
    const name = cleanLine(d.name, LIMITS.name);
    if (!name) errors.name = 'Skriv et navn';
    const phone = normalizePhone(d.phone.slice(0, 40));
    if (phone === false) errors.phone = 'Telefonnummeret ser forkert ud. Skriv fx 20 30 40 50';
    const clash = this.clients.find((c) => c.id !== d.id && c.name.toLocaleLowerCase('da') === name.toLocaleLowerCase('da'));
    if (clash) errors.name = 'Der er allerede en kunde med det navn. Tilføj fx et efternavn';
    if (Object.keys(errors).length) {
      haptic('reject');
      return { ok: false, errors };
    }
    const now = new Date().toISOString();
    const fields = {
      name,
      gender: d.gender,
      tag: cleanLine(d.tag, LIMITS.tag) || null,
      phone: phone || null,
      note: cleanMultiline(d.note, LIMITS.note),
      updatedAt: now
    };
    let id = d.id;
    if (id) {
      const old = this.clientMap.get(id);
      if (!old) return { ok: false, errors: { name: 'Kunden findes ikke længere' } };
      await this.db.saveClient({ ...old, ...fields });
    } else {
      id = newId();
      await this.db.addClient({ id, createdAt: now, ...fields });
    }
    await this.afterChange();
    haptic('confirm');
    snackbar.show(d.id ? 'Kunden er gemt' : `${name} er oprettet`);
    return { ok: true, id };
  }

  async deleteClient(id: string): Promise<void> {
    const c = this.clientMap.get(id);
    if (!c) return;
    const visits = this.visits.filter((v) => v.clientId === id);
    await this.db.deleteClient(id);
    await this.afterChange();
    haptic('confirm');
    snackbar.show(`${c.name} er slettet`, {
      label: 'Fortryd',
      run: async () => {
        await this.db.restoreClient(c, visits);
        await this.afterChange();
      }
    });
  }

  // ---------- backup ----------

  backupJson(): string {
    return serializeBackup(buildBackup(this.clients, this.visits, this.prices, new Date()));
  }

  async exportBackup(target: 'save' | 'share', password: string | null): Promise<boolean> {
    let data = this.backupJson();
    if (password) data = await encryptBackup(data, password);
    const name = backupFileName(this.today, !!password);
    this.expectExternalActivity();
    const done = target === 'save' ? await saveFile(name, data) : await shareFile(name, data);
    if (!done && this.backgroundSince === null) this.ignoreBackgroundUntil = 0;
    if (done) {
      const now = new Date().toISOString();
      await this.db.saveSettings({ lastBackupAt: now });
      this.settings = { ...this.settings, lastBackupAt: now };
      haptic('confirm');
    }
    return done;
  }

  planImport(backup: ParsedBackup, mode: ImportMode): ImportPlan {
    return planImport({ clients: this.clients, visits: this.visits, prices: this.prices }, backup, mode, new Date().toISOString());
  }

  async applyImport(plan: ImportPlan): Promise<void> {
    await this.db.applyImport(plan);
    if (!this.settings.lastBackupAt) await this.db.saveSettings({ lastBackupAt: new Date().toISOString() });
    await this.afterChange();
    haptic('confirm');
  }

  // ---------- wipe ----------

  async wipeAll(): Promise<void> {
    await clearExportCache();
    await cancelReminders();
    await setSecureScreen(false);
    await destroyDb();
    window.location.reload();
  }

  async discardUnreadable(): Promise<void> {
    await discardUnreadableDb();
    window.location.reload();
  }

  // ---------- reminders ----------

  async setReminders(enabled: boolean): Promise<'ok' | 'denied' | 'unsupported'> {
    if (enabled) {
      if (!remindersSupported()) return 'unsupported';
      if (!(await requestReminderPermission())) return 'denied';
    }
    await this.db.saveSettings({ remindersEnabled: enabled });
    this.settings = { ...this.settings, remindersEnabled: enabled };
    if (enabled) this.queueReminders();
    else await cancelReminders();
    return 'ok';
  }

  private queueReminders(): void {
    if (!this.settings.remindersEnabled || !remindersSupported()) return;
    if (this.reminderTimer) clearTimeout(this.reminderTimer);
    this.reminderTimer = setTimeout(() => {
      void scheduleReminders(this.visits, this.clientMap, this.today, this.settings.lockEnabled).catch(() => undefined);
    }, 800);
  }

  private async afterChange(): Promise<void> {
    await this.reload();
    this.queueReminders();
  }
}

export const app = new AppState();
