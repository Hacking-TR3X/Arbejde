# Saloona – sikkerhed

Seneste gennemgang: 2026-09-26. Første runde dækkede fase 1–4 og CI. Anden runde verificerede rettelserne i `dcf14d7` og `5a0ed60`. Tredje runde gennemgik `988c96c` (prisliste, migration 003, kalender): ingen nye permissions, netværkskald eller persondata i notifikationer. S-19–S-22 er rettet i commit'en efter.
**Afgørelse: IKKE GODKENDT.** S-18 (Middel) er åben: LoopCasts workflow i samme repo har samme risiko, som S-02 fjernede fra Saloonas. Alle Saloona-fund af betydning er rettet, se [Fund](#fund).

## Data og dataflow
Saloona gemmer kunders navn, køn, mærke, telefonnummer og note samt besøg med dato, behandling, beløb, betalingsmåde og note. Det er persondata efter GDPR. En note kan indeholde helbredsoplysninger, fx om allergi, så skriv kun det, der er nødvendigt.

- **Indtastning:** WebView (Svelte) → Capacitor-broen → SQLCipher-databasen `databases/saloonaSQLite.db` i appens sandbox. Al SQL er parametriseret.
- **Nøgle:** 32 tilfældige bytes (`crypto.getRandomValues`) bliver én gang til SQLCipher-passphrase. Pluginnet gemmer den i `EncryptedSharedPreferences` (`sqlite_encrypted_shared_prefs`), som er krypteret med en AES-256-GCM-nøgle i Android Keystore. Den står ikke i kode, logs, localStorage eller backup.
- **Eksport:** JSON, som man kan vælge at kryptere med AES-256-GCM. Nøglen udledes med PBKDF2-SHA-256, 600.000 iterationer og 16 bytes salt, og adgangskoden skal have mindst 8 tegn. Filen gemmes via Androids filvælger (`ACTION_CREATE_DOCUMENT`) eller deles via share sheet. Ved deling skrives filen først til `cache/exports/` og deles gennem FileProvider med en læse-grant. Mappen ryddes ved hver start og ved "Slet alle data".
- **Import:** filvælger (`ACTION_OPEN_DOCUMENT`) → højst 8 MB → validering felt for felt → forhåndsvisning → én transaktion.
- **Påmindelser:** den færdige tekst gemmes af `@capacitor/local-notifications` i `shared_prefs/NOTIFICATION_STORE.xml`, som ikke er krypteret, og planlægges med AlarmManager. Når app-låsen er slået til, står der ingen navne i teksten.
- **Netværk:** intet. Appen har ingen `INTERNET`-permission, og CSP'en tillader kun `'self'`.

## Trusselsmodel
**Beskytter mod:** netværkslæk og tracking, andre apps på telefonen (sandbox, kun launcher-activity eksporteret, snævre FileProvider-grants), kopier af app-data via Google-backup eller telefonskifte, ondsindede backup-filer, og en person der får fat i en ulåst telefon (app-lås, `FLAG_SECURE` og notifikationer uden navne).

**Beskytter ikke mod:**
- root og malware med root. Kode, der kører som appens UID, kan bruge Keystore-nøglen.
- debug-buildet (`assembleDebug`), som kan inspiceres over USB og kun er til udvikling.
- en person, der kender telefonens kode. App-låsen falder tilbage til den (ejerens beslutning).
- backup-filer uden adgangskode, der ligger i Drev eller mail.
- den, der kan skrive til GitHub-repoet og dermed ændre testversionen på Releases (S-18).

App-låsen er en UI-lås. Databasen åbnes ved start uanset låsen, og nøglen er ikke bundet til biometri (`biometricAuth: false`).

## Foranstaltninger
- **Netværk:** `INTERNET` og netværks-permissions er fjernet med `tools:node="remove"`. `usesCleartextTraffic="false"`, og `network_security_config` tillader kun system-CA'er og ingen klartekst. `CapacitorHttp` og `CapacitorCookies` er slået fra. Der er ingen `fetch`/XHR/WebSocket/`sendBeacon` og ingen eksterne URL'er i appkoden. Fontene er lokale (woff2).
- **WebView:** CSP i det byggede `index.html`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'`.
  - Der er ingen inline scripts og intet `unsafe-inline`/`unsafe-eval`. `frame-ancestors` virker ikke i en meta-tag og er derfor udeladt. `'wasm-unsafe-eval'` findes kun i web-preview'et (`dist-web`), som aldrig kommer i APK'en.
  - `connect-src 'self'` (kun `https://localhost` fra APK'en) beholdes bevidst. Et CSP-brud ved `'none'` ville ikke kunne ses i smoke-testen, fordi konsollen ikke logges.
  - Capacitors bro injiceres med `DOCUMENT_START_SCRIPT` og `WebMessageListener`, begrænset til `https://localhost` og kun i main frame.
  - `webContentsDebuggingEnabled` følger `debuggable` og er derfor fra i release og pilot. `allowMixedContent: false`. `allowFileAccess` er som standard fra (targetSdk ≥ 30), og `allowContentAccess` er slået fra i `MainActivity`. `loggingBehavior: "none"` gælder i alle builds.
  - Der er ingen `{@html}`, `innerHTML`, `eval` eller `new Function` i appkoden. Svelte-runtimen bruger `innerHTML` på statiske templates, der er kendt ved compile-tid.
- **Data i hvile:** databasen er krypteret med SQLCipher, nøglen er beskyttet af Keystore, og `PRAGMA secure_delete = ON` er slået til. Der ligger ingen persondata i localStorage, sessionStorage eller IndexedDB på Android. Plugin-kaldets data (hele backuppen) gemmes ikke i `onSaveInstanceState`.
- **Slet:**
  - "Slet kunde" sletter besøgene og kunden i én transaktion (og `ON DELETE CASCADE`).
  - "Slet alle data":
    1. Rydder `cache/exports/`.
    2. Fjerner påmindelser, også dem der allerede er vist.
    3. Fjerner `FLAG_SECURE`.
    4. Sletter databasen via forbindelsen og derefter med `Context.deleteDatabase`, som også sletter `-journal`, `-wal` og `-shm`.
    5. Fjerner passphrasen, men først når filen er væk.
  - Indstillingerne ligger i databasen og forsvinder med den.
  - "Start forfra", når nøglen er mistet, sletter filerne uden nøglen.
- **Import:**
  - Filen læses højst til grænsen plus én byte, uanset hvad provideren oplyser om størrelsen. En for stor fil eller `OutOfMemoryError` giver "for stor" i stedet for et crash.
  - `JSON.parse` kører uden reviver. Felter læses kun som egne properties, `__proto__`, `constructor` og `prototype` afvises, og der bruges `Map` i stedet for objekter.
  - Ukendte felter ignoreres.
  - Datoer skal være `YYYY-MM-DD` og en gyldig kalenderdato i årene 1900–2200. Beløb skal være endelige, ≥ 0 og ≤ 1.000.000 kr. `pay` og `gender` skal have en tilladt enum-værdi. Id'er følger `[A-Za-z0-9_-]{1,64}`, ellers laves et afledt id.
  - Tekster renses for kontrol-, bidi- og nulbreddetegn og får en maksimal længde.
  - Der er højst 20.000 kunder, 200.000 besøg og 2.000 priser. Besøg med ukendt `clientId` afvises.
  - Prislisten (`treatments`, kun Saloona-filer): et array med højst 2.000 punkter. Navnet renses og får højst 60 tegn, prisen skal være et tal på 0–1.000.000 kr., og varigheden skal være et heltal på 5–600 min. `gender` skal være `dame`, `herre` eller `alle`. Mangler feltet, læses det ud fra navnet, og andre værdier giver en advarsel. Ugyldige priser og varigheder fjernes, dubletter springes over, og nøglerne ligger kun i `Map`/arrays.
  - En krypteret backup skal have 100.000–5.000.000 iterationer, og salt, IV og data skal være base64 med længdegrænser.
- **Ring/SMS:** nummeret normaliseres i JS og valideres igen i Java (`^\+?[0-9]{3,15}$`) før `ACTION_DIAL tel:` eller `ACTION_SENDTO smsto:`. Der kan ikke komme andre skemaer, parametre eller USSD-tegn (`*#`) igennem, og det kræver ingen telefon- eller SMS-permission.
- **App-lås:** `BiometricPrompt` med `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`.
  - Appen låses ved hver start og efter baggrund plus den valgte timeout. Med "Straks" låses den allerede ved pause.
  - Tid i appens egen filvælger eller share sheet tæller med, men med en grace på mindst 5 min.
  - Snackbaren lukkes, når appen låses. Det kræver godkendelse at slå låsen fra.
  - `FLAG_SECURE` sættes i `MainActivity.onCreate`, før WebView'et tegner, når låsen er slået til.
  - Når låsen er slået til, siger notifikationen kun "N kunder er over tid". Kanal og notifikation har `VISIBILITY_PRIVATE`.
  - Der er ingen deep links. Tilbage-knappen går kun tilbage i WebView-historikken, og låseskærmen vises uanset navigationen.
- **Build:**
  - Release: `debuggable false`, R8 og resource shrinking, signeret med ejerens nøgle fra miljøvariabler eller `~/.gradle/gradle.properties`.
  - Den udgivne app er build-typen `pilot`. Den er `initWith release` (ikke debuggable, R8), har app-id `dk.saloona.app` og signeres med den faste nøgle i CI's cache. Ejeren har fravalgt selv at signere en release.
  - `*.jks`, `*.keystore`, `*.p12`, `keystore.properties`, `local.properties` og `.env` er i `.gitignore`. Der ligger ingen Saloona-nøgler i git-historikken.
  - Versionerne er låst eksakt (`save-exact`), og `package-lock.json` er committet. Der er 4 direkte runtime-dependencies, og `npm audit` giver 0 sårbarheder. `overrides.uuid` er en dev-afhængighed og kommer ikke med i APK'en.
- **CI (`saloona.yml`):**
  - Top-level `contents: read`. Kun publish-jobbet har `contents: write`, og det bruger kun GitHubs egne actions plus `gh`-CLI'en.
  - Alle actions er pinnet på commit-SHA (verificeret mod tags med `git ls-remote`).
  - `persist-credentials: false` undtagen i publish, og `validate-wrappers: true`.
  - Der bruges ingen secrets og ingen `pull_request`-triggere.
  - `scripts/ci-manifest-check.py` tjekker det flettede manifest i pilot og release.

## Hvorfor Android-backup er slået fra
`allowBackup="false"`, og både `fullBackupContent` (Android ≤ 11) og `dataExtractionRules` (Android 12+, cloud og device-transfer) udelukker alle domæner. Databasen er krypteret med en Keystore-nøgle, som aldrig følger med til en anden telefon, så en Google-backup ville være ulæselig og kun en ekstra kopi af persondata. Backup laves bevidst via eksport i appen.

## Permissions
Allow-listen i `scripts/ci-manifest-check.py`. CI fejler, hvis det flettede manifest i pilot eller release indeholder andet, eller hvis en anden komponent end `MainActivity` er eksporteret.

| Permission | Kilde | Hvorfor |
|---|---|---|
| `USE_BIOMETRIC` | app | App-låsen (`BiometricPrompt`). |
| `USE_FINGERPRINT` | androidx.biometric | Fingeraftryk på Android 8–9. Normal permission. |
| `POST_NOTIFICATIONS` | app, local-notifications | Påmindelsen. Appen spørger først, når den slås til (Android 13+). |
| `RECEIVE_BOOT_COMPLETED` | app, local-notifications | Planlagte påmindelser overlever en genstart. |
| `<app-id>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx.core | Intern signature-permission. Kun appen selv kan bruge den. |

Fjernet med `tools:node="remove"`: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `WAKE_LOCK`, `VIBRATE`, `FOREGROUND_SERVICE`, `READ_EXTERNAL_STORAGE` og `WRITE_EXTERNAL_STORAGE`.

Komponenter:
- Eksporteret: kun `MainActivity` (LAUNCHER, `singleTask`).
- Ikke eksporteret: `FileProvider` (kun `cache/exports/`), local-notifications' receivere og `LocalNotificationsAssetProvider` samt androidx.startup's `InitializationProvider`.
- `ProfileInstallReceiver` er fjernet.

## Fund
| ID | Alvor | Fund | Sted | Status |
|---|---|---|---|---|
| S-01 | Middel | App-låsen slog ikke til efter filvælger, deling eller import, fordi pausen slet ikke blev registreret. | `src/lib/app.svelte.ts` `onAppState` | rettet. Pausen registreres altid, der er 5 min grace for egne eksterne aktiviteter, og forventningen nulstilles ved resume. |
| S-02 | Middel | Tredjeparts-actions var pinnet på tag i `saloona.yml`, bl.a. `softprops` med `contents: write`. | `.github/workflows/saloona.yml` | rettet. SHA-pins er verificeret, `gh release` bruges, `persist-credentials: false` og `validate-wrappers`. Dependabot for `github-actions` er en anbefaling til ejeren. |
| S-03 | Lav | "Start forfra" ved mistet nøgle kunne ikke slette databasen. | `src/data/native.ts`; `SaloonaNativePlugin.deleteDatabaseFiles` | rettet |
| S-04 | Lav | Viste notifikationer med navne og deres post i `NOTIFICATION_STORE.xml` overlevede "Slet alle data" og at låsen blev slået til. | `src/platform/reminders.ts` `cancelReminders` | rettet (`removeDeliveredNotificationsById` før `cancel`). Rest accepteret: mens påmindelser er slået til og låsen er slået fra, ligger op til 15 tekster med højst 3 fornavne i klartekst i sandboxen (ingen backup). |
| S-05 | Lav | En snackbar med kundenavn og "Fortryd" blev vist over låseskærmen, og indhold kunne ses kortvarigt ved genåbning. | `src/lib/app.svelte.ts` `lockNow` | rettet. Rest accepteret: med en timeout > 0 kan det seneste billede ses et øjeblik ved genåbning efter timeout, men `FLAG_SECURE` skjuler det i app-oversigten. |
| S-06 | Lav | En delt backup i klartekst blev liggende i `cache/exports/`. | `src/lib/app.svelte.ts` `start`, `wipeAll` | rettet |
| S-07 | Lav | Importgrænsen på 20 MB kunne give `OutOfMemoryError` og crash. | `validate.ts` `MAX_FILE_CHARS`; `SaloonaNativePlugin.readDocument` | rettet (8 MB, OOM → `tooLarge`) |
| S-08 | Lav | Den offentlige testversion var debuggable, så `run-as` og `chrome://inspect` gav adgang til alle data. | `android/app/build.gradle` (`pilot`); `saloona.yml`; `README.md` | rettet (hærdet `pilot`-build, README opdateret) |
| S-09 | Info | Det flettede manifest var ikke verificeret. | `scripts/ci-manifest-check.py` | rettet i CI, afventer output fra første kørsel. Anbefaling: permission-delen fejler åbent, hvis aapt2's outputformat ændrer sig. Kræv derfor, at `USE_BIOMETRIC` findes. |
| S-10 | Info | Sqlite-pluginnet trækker `androidx.security:security-crypto:1.1.0-alpha06` (deprecated) og Tink 1.8.0 ind. Hvis keysettet bliver beskadiget, kan pluginnet ikke loade, og appen viser "Saloona kunne ikke starte" igen og igen. | sqlite-plugin `build.gradle` | accepteret. Vejen ud er *Indstillinger → Apps → Saloona → Ryd lagerplads* og derefter import af seneste backup. |
| S-11 | Info | Sqlite-pluginnet logger fejlbeskeder med `android.util.Log` uanset `loggingBehavior`. Der er ikke fundet SQL-værdier eller passphrase i beskederne. | `RetHandler.java` m.fl. | accepteret |
| S-12 | Info | Dokumentationen om logning var forældet. | `android/README-android.md`; release-tekst | rettet |
| S-13 | Info | `PRAGMA secure_delete` var ikke slået til. | `src/data/native.ts` `openNativeDb` | rettet (ikke verificeret på en enhed) |
| S-14 | Info | Hærdning: `allowContentAccess`, godkendelse for at slå låsen fra og `connect-src`. | `MainActivity.java`; `app.svelte.ts` `setLock` | rettet. `connect-src 'self'` er accepteret, se WebView. |
| S-15 | Info | Uden for Saloona: LoopCasts keystore og password (`app/keystore/loopcast.jks`, `"loopcast"`) ligger i det offentlige repos historik. | LoopCast | åben (ejer/LoopCast) |
| S-16 | Info | Fixtures brugte prototypens startkunder. | `tests/fixtures/*.json` | rettet (opdigtede navne). Ejeren skal bekræfte, om prototypens navne var rigtige kunder. De findes stadig i git-historikken. |
| S-17 | Lav | En pause, mens `authenticating` er sand, registreres ikke. Hvis ejeren forlader appen med Hjem, mens godkendelsen til "slå lås fra" vises, er appen ulåst, når den åbnes igen, uanset tiden. Rettelse: registrér pausen og behandl den som ekstern (`backgroundExternal = this.authenticating \|\| …`). | `src/lib/app.svelte.ts` `onAppState` | rettet (`backgroundExternal = this.authenticating \|\| …`) |
| S-18 | Middel | LoopCasts `build.yml` i samme repo har `permissions: contents: write` for alle jobs og tag-pinnede tredjeparts-actions (`setup-android@v3`, `setup-gradle@v4`, `softprops/action-gh-release@v2`). Den kører ved hvert push, også på Saloonas gren. Et kompromitteret tag kan derfor ændre Saloonas kode, `saloona`-releasen og `Saloona.apk`. Det kan også hente app-nøglen fra Actions-cachen, som ikke er begrænset til ét workflow. README beder ejeren afinstallere og gendanne backup ved en signaturkonflikt, så en udskiftet APK vil få hendes data. Rettelse: pin `build.yml` på SHA og flyt `contents: write` til release-jobbet, eller flyt Saloona til sit eget repo. Anbefaling: læg app-nøglen som environment-secret, så den ikke skifter, og skriv "afinstallér ikke – kontakt udvikleren" ved en konflikt. | `.github/workflows/build.yml`; `README.md` | åben (kræver ejerens beslutning, da LoopCast skulle være urørt) |
| S-19 | Lav | Migration 003 fejler, hvis en standardpris uden besøg har en nøgle på mere end 60 tegn. Det kan ske via en prototype-import, fordi `toLocaleLowerCase` gør "İ" til to tegn. Så rammer fallback-navnet `CHECK (length(label) BETWEEN 1 AND 60)`. Migrationen rulles tilbage, men appen viser "kunne ikke starte" ved hver start, og data kan ikke eksporteres. Rettelse: `substr(p.treatment_key, 1, 60)` som fallback. Det er sikkert at rette 003, selv om den er udgivet, for enheder, hvor den lykkedes, får samme resultat, og de andre står stadig på version 2. | `src/data/migrations/003_treatments.ts` | rettet (test i `migrations.test.ts`) |
| S-20 | Lav | Ved import af prototypens `prices` bliver navnet `capitalizeFirst(key)`, som kan komme over 60 tegn ("ß" giver "SS", og "İ" bliver til to tegn). Så fejler hele importen med en CHECK-fejl. Der går ingen data tabt, fordi importen er én transaktion. Rettelse: `truncate(capitalizeFirst(key), LIMITS.treatment)`. | `src/data/repo.ts` `applyImport` | rettet (test i `migrations.test.ts`) |
| S-21 | Info | Hvis man eksporterer og gendanner en Saloona-backup, kommer alle brugte behandlinger på prislisten med den senest betalte pris, fordi `prices` også importeres. Det er ikke en sikkerhedsfejl, men den gendannede prisliste er ikke den samme som den eksporterede. | `src/domain/backup/validate.ts`, `merge.ts` | rettet: har filen en prisliste, bruges `prices` ikke ved import |
| S-22 | Info | En behandling, hvis nøgle starter med `new:`, åbnes som en ny behandling og kan hverken redigeres eller slettes. | `src/screens/TreatmentSheet.svelte` | rettet: navnet gives som `prefillName` i stedet for en `new:`-nøgle |

## Rapportér et sikkerhedsproblem
Opret ikke et offentligt issue, og send aldrig rigtige kundedata med. Brug GitHubs private sårbarhedsrapportering (*Security → Report a vulnerability*) i dette repository, eller kontakt ejeren direkte. Beskriv version, telefon/Android-version og trin til at genskabe problemet.
