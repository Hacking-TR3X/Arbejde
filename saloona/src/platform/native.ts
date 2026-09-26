/**
 * Bridge to the app's own Android plugin `SaloonaNative`
 * (android/app/src/main/java/dk/saloona/app/SaloonaNativePlugin.java).
 *
 * Keep this interface and the Java implementation in sync.
 * All methods resolve; failures are returned as values, never thrown,
 * except for programming errors.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type LockAvailability =
  | { available: true }
  | { available: false; reason: 'no_hardware' | 'none_enrolled' | 'no_device_credential' | 'unavailable' };

export type AuthResult =
  | { success: true }
  | { success: false; error: 'canceled' | 'lockout' | 'failed' | 'unavailable' };

export type HapticKind = 'confirm' | 'reject' | 'tick';

export interface OpenFileResult {
  canceled: boolean;
  /** Display name reported by the document provider. */
  name?: string;
  /** File contents decoded as UTF-8. Absent when canceled or too large. */
  data?: string;
  tooLarge?: boolean;
}

export interface SaloonaNativePlugin {
  /** Whether fingerprint/face or the phone's own screen lock can be used. */
  lockAvailability(): Promise<LockAvailability>;
  /**
   * Shows the system BiometricPrompt. Allows BIOMETRIC_WEAK | DEVICE_CREDENTIAL
   * (API 30+) or setDeviceCredentialAllowed(true) (API 26–29), so the phone's
   * PIN/pattern/password is always the fallback.
   */
  authenticate(options: { title: string; subtitle?: string }): Promise<AuthResult>;
  /** Sets or clears FLAG_SECURE on the activity window. */
  setSecureScreen(options: { enabled: boolean }): Promise<void>;

  /** ACTION_CREATE_DOCUMENT: the user picks where to save (Drev, Downloads …). */
  saveFile(options: { fileName: string; mimeType: string; data: string }): Promise<{ saved: boolean }>;
  /** ACTION_OPEN_DOCUMENT: reads the chosen file as UTF-8, refusing files above maxBytes. */
  openFile(options: { mimeTypes: string[]; maxBytes: number }): Promise<OpenFileResult>;
  /**
   * Writes the data to cache/exports/, shares it through the FileProvider with a
   * chooser (ACTION_SEND), and deletes older export files.
   */
  shareFile(options: { fileName: string; mimeType: string; data: string; title: string }): Promise<{ shared: boolean }>;
  /** Deletes everything in cache/exports/. Called on start-up. */
  clearExportCache(): Promise<void>;

  /** ACTION_DIAL with tel:<number>. No CALL_PHONE permission needed. */
  dial(options: { number: string }): Promise<void>;
  /** ACTION_SENDTO with smsto:<number>. */
  sms(options: { number: string }): Promise<void>;

  /** View.performHapticFeedback. No VIBRATE permission needed. */
  haptic(options: { kind: HapticKind }): Promise<void>;

  /**
   * Fired from the plugin's handleOnPause/handleOnResume, used to re-lock the app
   * after it has been in the background.
   */
  addListener(eventName: 'appStateChange', listener: (state: { isActive: boolean }) => void): Promise<PluginListenerHandle>;
}

export const SaloonaNative = registerPlugin<SaloonaNativePlugin>('SaloonaNative');
