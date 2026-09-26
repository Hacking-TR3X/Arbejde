/**
 * Optional daily reminder about clients who are overdue.
 *
 * Data only changes while the app is in use, so every time it changes we
 * pre-compute the next REMINDER_DAYS days and schedule one notification per day
 * (at 09:00) with the right text. No background work, no exact alarms.
 */
import { Capacitor } from '@capacitor/core';
import { addDays, type ISODate } from '../domain/dates';
import { computeRhythms } from '../domain/rhythm';
import type { Client, Visit } from '../domain/types';

const REMINDER_DAYS = 14;
const BASE_ID = 7100;
const CHANNEL = 'saloona-reminders';
const HOUR = 9;

async function plugin() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

export function remindersSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** Asks for POST_NOTIFICATIONS (Android 13+). Returns whether reminders can be shown. */
export async function requestReminderPermission(): Promise<boolean> {
  if (!remindersSupported()) return false;
  const ln = await plugin();
  let status = await ln.checkPermissions();
  if (status.display === 'prompt' || status.display === 'prompt-with-rationale') status = await ln.requestPermissions();
  return status.display === 'granted';
}

/**
 * Cancels pending reminders AND removes any that are already showing, so names
 * never linger in the notification shade after the lock is turned on or data is wiped.
 */
export async function cancelReminders(): Promise<void> {
  if (!remindersSupported()) return;
  const ln = await plugin();
  const ids = Array.from({ length: REMINDER_DAYS + 1 }, (_, i) => BASE_ID + i);
  await ln.removeDeliveredNotificationsById({ ids }).catch(() => undefined);
  await ln.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => undefined);
}

/** Text for a given day, or null if nobody is overdue. Names are left out when the app is locked. */
export function reminderText(
  visits: readonly Visit[],
  clients: ReadonlyMap<string, Client>,
  day: ISODate,
  hideNames: boolean
): { title: string; body: string } | null {
  const late = computeRhythms(visits, day).filter((r) => r.status === 'late' && clients.has(r.clientId));
  const people = [...new Set(late.map((r) => r.clientId))];
  if (people.length === 0) return null;
  const n = people.length;
  const title = n === 1 ? '1 kunde er over tid' : `${n} kunder er over tid`;
  if (hideNames) return { title, body: 'Åbn Saloona for at se hvem.' };
  const names = people.slice(0, 3).map((id) => clients.get(id)?.name ?? '');
  const rest = n - names.length;
  const body = rest > 0 ? `${names.join(', ')} og ${rest} til` : names.join(n === 2 ? ' og ' : ', ');
  return { title, body };
}

export async function scheduleReminders(
  visits: readonly Visit[],
  clients: ReadonlyMap<string, Client>,
  today: ISODate,
  hideNames: boolean
): Promise<void> {
  if (!remindersSupported()) return;
  const ln = await plugin();
  await cancelReminders();
  await ln
    .createChannel({ id: CHANNEL, name: 'Påmindelser', description: 'Kunder der er over tid', importance: 3, visibility: 0 })
    .catch(() => undefined);

  const now = new Date();
  const notifications = [];
  for (let i = 0; i <= REMINDER_DAYS; i++) {
    const day = addDays(today, i);
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const at = new Date(y, m - 1, d, HOUR, 0, 0);
    if (at <= now) continue;
    const text = reminderText(visits, clients, day, hideNames);
    if (!text) continue;
    notifications.push({
      id: BASE_ID + i,
      title: text.title,
      body: text.body,
      channelId: CHANNEL,
      smallIcon: 'ic_stat_saloona',
      // Inexact alarm: we deliberately do not hold SCHEDULE_EXACT_ALARM.
      schedule: { at, allowWhileIdle: true },
      isExactNotification: false
    });
  }
  if (notifications.length) await ln.schedule({ notifications });
}
