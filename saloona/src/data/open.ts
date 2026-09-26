import { Capacitor } from '@capacitor/core';
import type { Db } from './db';

export const isNative = Capacitor.isNativePlatform();

export async function openDb(): Promise<Db> {
  if (isNative) {
    const { openNativeDb } = await import('./native');
    return openNativeDb();
  }
  if (__WEB_PREVIEW__) {
    const { openPreviewDb } = await import('./preview');
    return openPreviewDb();
  }
  throw new Error('Saloona kører kun som Android-app');
}

/** Deletes the database and its key ("Slet alle data"). */
export async function destroyDb(): Promise<void> {
  if (isNative) {
    const { destroyNativeDb } = await import('./native');
    return destroyNativeDb();
  }
  if (__WEB_PREVIEW__) {
    const { destroyPreviewDb } = await import('./preview');
    return destroyPreviewDb();
  }
}

export async function discardUnreadableDb(): Promise<void> {
  if (isNative) {
    const { discardUnreadableNativeDb } = await import('./native');
    return discardUnreadableNativeDb();
  }
  return destroyDb();
}
