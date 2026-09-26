# Saloona – sikkerhed

Seneste gennemgang: 2026-09-26 (fase 1–4 og CI). **Afgørelse: IKKE GODKENDT.** S-01 og S-02 (Middel) er åbne, se [Fund](#fund).

## Data og dataflow
Saloona gemmer kunders navn, køn, mærke, telefonnummer og note samt besøg med dato, behandling, beløb, betalingsmåde og note. Det er persondata efter GDPR. En note kan indeholde helbredsoplysninger, fx om allergi, så skriv kun det, der er nødvendigt.

- **Indtastning:** WebView (Svelte) → Capacitor-broen → SQLCipher-databasen `databases/saloonaSQLite.db` i appens sandbox. Al SQL er parametriseret.
- **Nøgle:** 32 tilfældige bytes (`crypto.getRandomValues`) bliver én gang til SQLCipher-passphrase. Pluginnet gemmer den i `EncryptedSharedPreferences` (`sqlite_encrypted_shared_prefs`), som er krypteret med en AES-256-GCM-nøgle i Android Keystore. Den står ikke i kode, logs, localStorage eller backup.
- **Eksport:** JSON, som man kan vælge at kryptere med AES-256-GCM. Nøglen udledes med PBKDF2-SHA-256, 600.000 iterationer og 16 bytes salt, og adgangskoden skal have mindst 8 tegn. Filen gemmes via Androids filvælger (`ACTION_CREATE_DOCUMENT`) eller deles via share sheet. Ved deling skrives filen først til `cache/exports/` og deles gennem FileProvider med en læse-grant.
- **Import:** filvælger (`ACTION_OPEN_DOCUMENT`) → højst 20 MB → validering felt for felt → forhåndsvisning → én transaktion.
- **Påmindelser:** den færdige tekst gemmes af `@capacitor/local-notifications` i `shared_prefs/NOTIFICATION_STORE.xml`, som ikke er krypteret, og planlægges med AlarmManager. Når app-låsen er slået til, står der ingen navne i teksten.
- **Netværk:** intet. Appen har ingen `INTERNET`-permission, og CSP'en tillader kun `'self'`.

## Trusselsmodel
**Beskytter mod:** netværkslæk og tracking, andre apps på telefonen (sandbox, kun launcher-activity eksporteret, snævre FileProvider-grants), kopier af app-data via Google-backup eller telefonskifte, ondsindede backup-filer, og en person der får fat i en ulåst telefon (app-lås, `FLAG_SECURE` og notifikationer uden navne).

**Beskytter ikke mod:**
- root, malware med root, og debug-builds tilgået via adb (`run-as` og WebView-debugging). Kode, der kører som appens UID, kan bruge Keystore-nøglen.
- en person, der kender telefonens kode. App-låsen falder tilbage til den (ejerens beslutning).
- backup-filer uden adgangskode, der ligger i Drev eller mail.

App-låsen er en UI-lås. Databasen åbnes ved start uanset låsen, og nøglen er ikke bundet til biometri (`biometricAuth: false`).

## Foranstaltninger
- **Netværk:** `INTERNET` og netværks-permissions er fjernet med `tools:node="remove"`. `usesCleartextTraffic="false"`, og `network_security_config` tillader kun system-CA'er og ingen klartekst. `CapacitorHttp` og `CapacitorCookies` er slået fra. Der er ingen `fetch`/XHR/WebSocket/`sendBeacon` og ingen eksterne URL'er i appkoden. Fontene er lokale (woff2).
- **WebView:** CSP i det byggede `index.html`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'`. Der er ingen inline scripts og intet `unsafe-inline`/`unsafe-eval`. `frame-ancestors` virker ikke i en meta-tag og er derfor udeladt. `'wasm-unsafe-eval'` findes kun i web-preview'et (`dist-web`), som aldrig kommer i APK'en.
  - Capacitors bro injiceres med `DOCUMENT_START_SCRIPT` og `WebMessageListener`, begrænset til `https://localhost` og kun i main frame.
  - `webContentsDebuggingEnabled` følger `debuggable` og er derfor fra i release. `allowMixedContent: false`. `allowFileAccess` er som standard fra (targetSdk ≥ 30). `loggingBehavior: "none"`.
  - Der er ingen `{@html}`, `innerHTML`, `eval` eller `new Function` i appkoden. Svelte-runtimen bruger `innerHTML` på statiske templates, der er kendt ved compile-tid.
- **Data i hvile:** databasen er krypteret med SQLCipher, og nøglen er beskyttet af Keystore. Der ligger ingen persondata i localStorage, sessionStorage eller IndexedDB på Android. Web-preview'ets localStorage-kode er ikke med i `dist`. Plugin-kaldets data (hele backuppen) gemmes ikke i `onSaveInstanceState` (`saveInstanceState()` returnerer `null`).
- **Slet:**
  - "Slet kunde" sletter besøgene og kunden i én transaktion (og `ON DELETE CASCADE`).
  - "Slet alle data" annullerer påmindelserne, fjerner `FLAG_SECURE` og kalder `context.deleteDatabase`, som også sletter `-journal`, `-wal` og `-shm`. Derefter fjernes passphrasen, og appen genindlæses. Indstillingerne ligger i databasen og forsvinder med den. Se S-03, S-04 og S-06 for rester.
- **Import:**
  - Filen læses højst til grænsen plus én byte, uanset hvad provideren oplyser om størrelsen.
  - `JSON.parse` kører uden reviver. Felter læses kun som egne properties, `__proto__`, `constructor` og `prototype` afvises, og der bruges `Map` i stedet for objekter.
  - Ukendte felter ignoreres.
  - Datoer skal være `YYYY-MM-DD` og en gyldig kalenderdato i årene 1900–2200. Beløb skal være endelige, ≥ 0 og ≤ 1.000.000 kr. `pay` og `gender` skal have en tilladt enum-værdi. Id'er følger `[A-Za-z0-9_-]{1,64}`, ellers laves et afledt id.
  - Tekster renses for kontrol-, bidi- og nulbreddetegn og får en maksimal længde.
  - Der er højst 20.000 kunder, 200.000 besøg og 2.000 priser. Besøg med ukendt `clientId` afvises.
  - En krypteret backup skal have 100.000–5.000.000 iterationer, og salt, IV og data skal være base64 med længdegrænser.
- **Ring/SMS:** nummeret normaliseres i JS og valideres igen i Java (`^\+?[0-9]{3,15}$`) før `ACTION_DIAL tel:` eller `ACTION_SENDTO smsto:`. Der kan ikke komme andre skemaer, parametre eller USSD-tegn (`*#`) igennem, og det kræver ingen telefon- eller SMS-permission.
- **App-lås:** `BiometricPrompt` med `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`. Appen låses ved hver start og efter baggrund plus den valgte timeout (se S-01).
  - `FLAG_SECURE` sættes i `MainActivity.onCreate`, før WebView'et tegner, når låsen er slået til.
  - Når låsen er slået til, siger notifikationen kun "N kunder er over tid". Kanal og notifikation har `VISIBILITY_PRIVATE`.
  - Der er ingen deep links. Tilbage-knappen går kun tilbage i WebView-historikken, og låseskærmen vises uanset navigationen.
- **Build:**
  - Release: `debuggable false`, R8 og resource shrinking. Keystore og passwords læses fra miljøvariabler eller `~/.gradle/gradle.properties`, og `*.jks`, `*.keystore`, `*.p12`, `keystore.properties`, `local.properties` og `.env` er i `.gitignore`. Der ligger ingen Saloona-nøgler i git-historikken.
  - Versionerne er låst eksakt (`save-exact`), og `package-lock.json` er committet. Der er 4 direkte runtime-dependencies, og `npm audit` giver 0 sårbarheder. `overrides.uuid` er en dev-afhængighed og kommer ikke med i APK'en.
- **CI:** `permissions: contents: read`. Kun publish-jobbet har `contents: write`. Der bruges ingen secrets og ingen `pull_request`-triggere.

## Hvorfor Android-backup er slået fra
`allowBackup="false"`, og både `fullBackupContent` (Android ≤ 11) og `dataExtractionRules` (Android 12+, cloud og device-transfer) udelukker alle domæner. Databasen er krypteret med en Keystore-nøgle, som aldrig følger med til en anden telefon, så en Google-backup ville være ulæselig og kun en ekstra kopi af persondata. Backup laves bevidst via eksport i appen.

## Permissions
Forventet i det flettede manifest. Det kan ikke bygges lokalt (intet Android SDK) og skal verificeres i CI (S-09).

| Permission | Kilde | Hvorfor |
|---|---|---|
| `USE_BIOMETRIC` | app | App-låsen (`BiometricPrompt`). |
| `USE_FINGERPRINT` | androidx.biometric | Fingeraftryk på Android 8–9. Normal permission. |
| `POST_NOTIFICATIONS` | app, local-notifications | Påmindelsen. Appen spørger først, når den slås til (Android 13+). |
| `RECEIVE_BOOT_COMPLETED` | app, local-notifications | Planlagte påmindelser overlever en genstart. |
| `dk.saloona.app(.debug).DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx.core | Intern signature-permission. Kun appen selv kan bruge den. |

Fjernet med `tools:node="remove"`: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `WAKE_LOCK`, `VIBRATE`, `FOREGROUND_SERVICE`, `READ_EXTERNAL_STORAGE` og `WRITE_EXTERNAL_STORAGE`.

Komponenter:
- Eksporteret: kun `MainActivity` (LAUNCHER, `singleTask`).
- Ikke eksporteret: `FileProvider` (kun `cache/exports/`), local-notifications' receivere og `LocalNotificationsAssetProvider` samt androidx.startup's `InitializationProvider`.
- `ProfileInstallReceiver` er fjernet.

## Fund
| ID | Alvor | Fund | Sted | Status |
|---|---|---|---|---|
| S-01 | Middel | App-låsen slår ikke til efter filvælger, deling eller import. En pause inden for `ignoreBackgroundUntil` (10 min) registreres slet ikke, så appen er ulåst ved næste åbning, uanset hvor længe den har ligget i baggrunden. Import rydder aldrig vinduet. Rettelse: registrér altid `backgroundSince`, giv en ekstern aktivitet en grace på fx 5 min i stedet for at springe over, og nulstil forventningen ved første resume. | `src/lib/app.svelte.ts:137-156, 375-392`; `src/screens/ImportFlow.svelte:41` | åben |
| S-02 | Middel | Tredjeparts-actions er pinnet på tag, ikke på commit-SHA: `android-actions/setup-android@v3`, `gradle/actions/setup-gradle@v4`, `reactivecircus/android-emulator-runner@v2` og `softprops/action-gh-release@v2`. Den sidste kører med `contents: write` i et offentligt repo (også LoopCast). Et kompromitteret tag kan pushe kode eller udskifte release-APK'er. Rettelse: pin på fuld SHA (med versionskommentar), erstat `softprops` med `gh release`, sæt `persist-credentials: false` i jobs uden write, og slå Dependabot til for `github-actions`. | `.github/workflows/saloona.yml:66, 70, 151, 188, 233` | åben |
| S-03 | Lav | "Start forfra" ved mistet nøgle virker ikke. `deleteDatabase` kræver en åben forbindelse, og `deleteDB` kræver passphrasen, så fejlen sluges, og appen står fast på "Dine data kan ikke åbnes". Hvis `EncryptedSharedPreferences` er beskadiget, fejler plugin-load og giver en uendelig "Prøv igen". Rettelse: en native `deleteDatabaseFiles()` i `SaloonaNativePlugin` (`context.deleteDatabase("saloonaSQLite.db")`), som bruges af `discardUnreadableNativeDb`. `destroyNativeDb` bør først fjerne nøglen, når filen er væk. | `src/data/native.ts:62-86` | åben |
| S-04 | Lav | `cancel()` i local-notifications fjerner ikke en notifikation, der allerede er vist, og heller ikke dens post i `NOTIFICATION_STORE.xml`. Navne bliver derfor i skuffen og i klartekst i prefs efter "Slet alle data", og efter at låsen er slået til. Rettelse: `removeDeliveredNotifications` (eller `removeAllDeliveredNotifications`) før `cancel` i `cancelReminders`. Rest (accepteret): mens påmindelser er slået til og låsen er slået fra, ligger op til 15 tekster med højst 3 fornavne i klartekst i sandboxen (ingen backup). | `src/platform/reminders.ts:36-41` | åben |
| S-05 | Lav | En snackbar med kundenavn og "Fortryd" (6 s) vises oven på låseskærmen og kan trykkes, fordi `<Snackbar />` ligger uden for lås-grenen. Ved genåbning kan det seneste billede med indhold også ses kortvarigt, før JS har sat `locked`. Rettelse: `snackbar.dismiss()` hver gang `locked` sættes (eller render kun Snackbar, når appen er ulåst), og lås allerede ved pause, når timeouten er "Straks". | `src/App.svelte:73`; `src/lib/app.svelte.ts:137-147` | åben |
| S-06 | Lav | En delt backup i klartekst ligger i `cache/exports/` indtil næste vellykkede start. `clearExportCache` kaldes først, når databasen er åbnet, altså ikke ved keylost- eller fejlstart, og `wipeAll` kalder den ikke. Rettelse: kald den som det første i `start()` og i `wipeAll()`. | `src/lib/app.svelte.ts:103, 406-411` | åben |
| S-07 | Lav | Importgrænsen er 20 MB. Det giver op til ca. 150 MB kopier på Java-heapen (buffer, String, bro-JSON), og `OutOfMemoryError` fanges ikke, så appen crasher. Importen er transaktionel, så intet går tabt. Rettelse: en egen importgrænse på fx 8 MB, og fang `OutOfMemoryError` i `readDocument` → `tooLarge`. | `src/domain/backup/validate.ts:16`; `SaloonaNativePlugin.java:508-546` | åben |
| S-08 | Lav | Den offentlige testversion er `debuggable` og har WebView-debugging. Via USB-fejlfinding (`run-as`, `chrome://inspect`) kan man læse alle data og omgå lås og kryptering. `README.md` opfordrer til at flytte data mellem appen og testversionen. Rettelse: skriv "kun testdata i Saloona test". Bedre: udgiv en R8-build, der ikke er debuggable, med `.test`-suffix og testnøglen. | `README.md:25`; `.github/workflows/saloona.yml:205-259` | åben |
| S-09 | Info | Det flettede manifest er ikke verificeret, fordi det ikke kan bygges lokalt. Rettelse: et CI-trin, der kører `aapt2 dump permissions` og `aapt2 dump xmltree --file AndroidManifest.xml` på begge APK'er og fejler ved permissions uden for tabellen ovenfor. | CI | åben |
| S-10 | Info | Sqlite-pluginnet trækker `androidx.security:security-crypto:1.1.0-alpha06` (deprecated af Google) og Tink 1.8.0 ind. `EncryptedSharedPreferences` har kendte problemer med beskadigede keysets, som ender i S-03-stien. Det kan ikke skiftes uden at forke pluginnet. | sqlite-plugin `build.gradle` | accepteret |
| S-11 | Info | Sqlite-pluginnet logger fejlbeskeder med `android.util.Log` uanset `loggingBehavior`. Der er ikke fundet SQL-værdier eller passphrase i beskederne. | `RetHandler.java` m.fl. | accepteret |
| S-12 | Info | Dokumentationen om logning er forældet. `loggingBehavior` er nu `"none"`, så plugin-argumenter logges heller ikke i debug. | `android/README-android.md:39-41`; `saloona.yml:250` | åben |
| S-13 | Info | `PRAGMA secure_delete` er ikke slået til. Slettede rækker kan ligge i frie sider (krypteret) til en `VACUUM`. | `src/data/native.ts` | åben (anbefaling) |
| S-14 | Info | Hærdning: prøv `connect-src 'none'` (intet bruger fetch), `setAllowContentAccess(false)` på WebView'et, og kræv godkendelse for at slå app-låsen fra. | `vite.config.ts:38`; `MainActivity.java` | åben (anbefaling) |
| S-15 | Info | Uden for Saloona: LoopCasts keystore og password (`app/keystore/loopcast.jks`, `"loopcast"`) ligger i det offentlige repos historik. | LoopCast | åben (LoopCast) |
| S-16 | Info | Fixtures i det offentlige repo er prototypens startkunder med fornavne og noter (fx "Tåler ikke parfumeret shampoo"). Ejeren skal bekræfte, at de er opdigtede. Ellers skal de erstattes. | `tests/fixtures/*.json` | åben (ejer) |

## Rapportér et sikkerhedsproblem
Opret ikke et offentligt issue, og send aldrig rigtige kundedata med. Brug GitHubs private sårbarhedsrapportering (*Security → Report a vulnerability*) i dette repository, eller kontakt ejeren direkte. Beskriv version, telefon/Android-version og trin til at genskabe problemet.
