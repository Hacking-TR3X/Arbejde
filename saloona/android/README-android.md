# Saloona – Android

Capacitor 8-projekt. `minSdk 26` (Android 8), `targetSdk`/`compileSdk 36`. Appens egen native kode er pluginnet `SaloonaNative` i `app/src/main/java/dk/saloona/app/SaloonaNativePlugin.java`. JS-siden ligger i `src/platform/native.ts`, og de to skal holdes i sync.

## Permissions
| Permission | Hvorfor |
|---|---|
| `USE_BIOMETRIC` | App-låsen (fingeraftryk/ansigt via `BiometricPrompt`). |
| `USE_FINGERPRINT` | Merges ind af `androidx.biometric`. Bruges kun af fingeraftrykslæsere på Android 8–9. Det er en normal permission, som ikke skal godkendes. |
| `POST_NOTIFICATIONS` | Påmindelsen. Appen spørger først, når påmindelsen slås til (Android 13+). |
| `RECEIVE_BOOT_COMPLETED` | Så planlagte påmindelser overlever en genstart. |

`androidx.core` tilføjer desuden `dk.saloona.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. Det er en intern signature-permission, som kun appen selv kan bruge.

Fjernes med `tools:node="remove"`, også hvis et plugin merger dem ind: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `WAKE_LOCK`, `VIBRATE`, `FOREGROUND_SERVICE`, `READ_EXTERNAL_STORAGE` og `WRITE_EXTERNAL_STORAGE`.
- **Ingen `INTERNET`:** Android blokerer selv al netværkstrafik. WebView'et henter kun filer fra appen via Capacitors lokale server.
- **Ingen eksakte alarmer:** `@capacitor/local-notifications` falder tilbage til unøjagtige alarmer. JS skal sende `isExactNotification: false` (og ikke `isExactMandatory`) i hver `schedule()`. Ellers åbner pluginnet på Android 12+ skærmen "Alarmer og påmindelser" for en permission, appen ikke har. Brug gerne `schedule.allowWhileIdle: true`, så Doze ikke forsinker kl. 9-påmindelsen for meget.
- **Ingen `VIBRATE`:** haptik går gennem `View.performHapticFeedback` og følger telefonens indstilling for berøringsfeedback.
- **Ring/SMS** bruger `ACTION_DIAL` og `ACTION_SENDTO` og kræver ingen telefon- eller SMS-permission.

Kun `MainActivity` er eksporteret. Plugins' receivere og providere er `exported="false"`. `androidx.profileinstaller`s receiver er fjernet (den bruges kun af adb og benchmark-værktøjer).

## Backup
`allowBackup="false"`. `fullBackupContent` (Android ≤ 11) og `dataExtractionRules` (Android 12+) udelukker alle domæner, både for cloud-backup og for overførsel fra telefon til telefon. På Android 12+ stopper `allowBackup="false"` nemlig ikke overførslen til en ny telefon.

Begrundelsen er, at databasen er krypteret med en nøgle fra Android Keystore, og den nøgle følger aldrig med til en anden telefon. En kopi af databasen ville derfor være ulæselig og kun være en ekstra kopi af persondata. Backup sker bevidst via eksport i appen.

`network_security_config.xml` forbyder klartekst og stoler kun på systemets certifikater. Det er et ekstra forsvar, da appen ikke har netværk.

## Debug og release
| | Debug (`assembleDebug`) | Release (`assembleRelease`) |
|---|---|---|
| Pakkenavn | `dk.saloona.app.debug` | `dk.saloona.app` |
| Navn på telefonen | Saloona test | Saloona |
| WebView-debugging | til | fra |
| Capacitor-logning | til | fra |
| R8 og resource shrinking | nej | ja (`proguard-rules.pro`) |

WebView-debugging følger `debuggable`-flaget: Capacitors `CapConfig` bruger `FLAG_DEBUGGABLE` som standard for `android.webContentsDebuggingEnabled`, og `capacitor.config.json` sætter den ikke. Logning følger `loggingBehavior: "debug"`.

**Bemærk:** debug-builds logger argumenterne til plugin-kald i logcat, fx backup-indhold og telefonnumre. Det gør Capacitor selv (`Bridge.callPluginMethod`). Brug derfor ikke testversionen til rigtige kundedata.

`versionCode` sættes med `-PversionCode=<tal>` (CI bruger run-nummeret) og er ellers 1.

## Signering af release
Keystore og passwords må **aldrig** i git. Gradle læser dem fra miljøvariabler og ellers fra Gradle-properties med samme navn, fx i `~/.gradle/gradle.properties` uden for repoet:

```
SALOONA_KEYSTORE=/sti/til/saloona-release.jks   # SALOONA_KEYSTORE_FILE virker også
SALOONA_KEYSTORE_PASSWORD=...
SALOONA_KEY_ALIAS=saloona
SALOONA_KEY_PASSWORD=...
```

Brug en absolut sti til keystoren. Mangler en af dem, bygges release **usigneret** (`app-release-unsigned.apk`), og Gradle skriver en tydelig advarsel. Buildet fejler ikke.

Sådan bygger du lokalt (kræver Android SDK):
```
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

## CI
`.github/workflows/saloona.yml` kører web-tjek (`npm audit`, `npm run check`, `npm test`, `npm run build`) og bygger derefter debug og usigneret release. Til sidst starter den begge APK'er på en emulator (Android 14). Release signeres her med en nøgle, der kun findes i det job, for at fange R8-fejl. På grenen `claude/saloona-salon-app-cxdxja` lægges `Saloona-test.apk` på prereleasen `saloona-test`, som aldrig bliver "latest".

Testversionen signeres med en fast debug-nøgle fra GitHub Actions-cachen, så en ny test-APK kan installeres oven på den gamle. Cachen slettes efter 7 dage uden brug. Så laves en ny nøgle, og den gamle testversion skal afinstalleres først.
