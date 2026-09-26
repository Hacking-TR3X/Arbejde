/**
 * Platform services with a native (Android) implementation and a browser-preview fallback.
 * The preview fallbacks only exist so the UI can be developed and tested in Chromium.
 */
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { SaloonaNative, type AuthResult, type HapticKind, type LockAvailability, type OpenFileResult } from './native';

const native = Capacitor.isNativePlatform();

// ---------- lock ----------

export async function lockAvailability(): Promise<LockAvailability> {
  if (!native) return { available: true };
  return SaloonaNative.lockAvailability();
}

export async function authenticate(): Promise<AuthResult> {
  if (!native) return { success: true };
  return SaloonaNative.authenticate({ title: 'Lås Saloona op', subtitle: 'Brug fingeraftryk, ansigt eller telefonens kode' });
}

export async function setSecureScreen(enabled: boolean): Promise<void> {
  if (native) await SaloonaNative.setSecureScreen({ enabled });
}

/** Calls back with false when the app goes to the background and true when it returns. */
export function onAppStateChange(cb: (active: boolean) => void): void {
  if (native) {
    void SaloonaNative.addListener('appStateChange', (s) => cb(s.isActive));
  } else {
    document.addEventListener('visibilitychange', () => cb(document.visibilityState === 'visible'));
  }
}

// ---------- files ----------

export async function saveFile(fileName: string, data: string): Promise<boolean> {
  if (native) return (await SaloonaNative.saveFile({ fileName, mimeType: 'application/json', data })).saved;
  downloadInBrowser(fileName, data);
  return true;
}

export async function shareFile(fileName: string, data: string): Promise<boolean> {
  if (native) return (await SaloonaNative.shareFile({ fileName, mimeType: 'application/json', data, title: 'Del backup' })).shared;
  downloadInBrowser(fileName, data);
  return true;
}

export async function openFile(maxBytes: number): Promise<OpenFileResult> {
  if (native) return SaloonaNative.openFile({ mimeTypes: ['*/*'], maxBytes });
  return pickInBrowser(maxBytes);
}

export async function clearExportCache(): Promise<void> {
  if (native) await SaloonaNative.clearExportCache().catch(() => undefined);
}

function downloadInBrowser(fileName: string, data: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickInBrowser(maxBytes: number): Promise<OpenFileResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true });
      if (file.size > maxBytes) return resolve({ canceled: false, tooLarge: true, name: file.name });
      file.text().then(
        (data) => resolve({ canceled: false, name: file.name, data }),
        () => resolve({ canceled: true })
      );
    });
    input.addEventListener('cancel', () => resolve({ canceled: true }));
    input.click();
  });
}

// ---------- phone ----------

export async function dial(number: string): Promise<void> {
  if (native) await SaloonaNative.dial({ number });
  else window.location.href = `tel:${number}`;
}

export async function sms(number: string): Promise<void> {
  if (native) await SaloonaNative.sms({ number });
  else window.location.href = `sms:${number}`;
}

// ---------- feedback & appearance ----------

export function haptic(kind: HapticKind): void {
  if (native) void SaloonaNative.haptic({ kind }).catch(() => undefined);
}

export function setSystemBars(dark: boolean): void {
  if (native) void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
}
