# Saloona – plan

Saloona er en Android-app til en hjemmefrisør. Den holder styr på kunder, hvor ofte de kommer, og hvad hun tjener. Den bygger på prototypen `salonbog.html`. Alt ligger kun på telefonen.

Status: **Udkast – afventer ejerens godkendelse.**

## Beslutninger (aftalt med ejeren)
| Emne | Valg |
|---|---|
| Placering | Appen ligger i mappen `saloona/` i dette repo. LoopCast bliver liggende urørt. Saloona har sin egen CI-workflow. |
| UI-framework | Svelte 5 + Vite + TypeScript (strict). Begrundelse: Svelte kompileres til almindelig JS uden virtual DOM-runtime og uden `eval`, så en streng CSP er let at holde. Bundlen er lille, der er få dependencies, og indbyggede overgange er lette at slå fra. |
| App-lås | Fingeraftryk eller ansigt via `BiometricPrompt` med telefonens egen PIN, mønster eller adgangskode som fallback. Appen gemmer ingen PIN. |
| Backup | Filen er som standard almindelig JSON, kompatibel med prototypen. Man kan vælge "Beskyt med adgangskode" (AES-256-GCM, nøgle fra PBKDF2-SHA-256 med 600.000 iterationer, via WebCrypto). |
| Signering | Release signeres lokalt hos ejeren med en keystore uden for repoet. CI bygger debug-APK og en usigneret release til test. |
| Startdata | Prototypens indbyggede startkunder kommer ikke med. Rigtige data kommer ind via import af backup. |

## Arkitektur
```
saloona/
  index.html            CSP-meta, ingen inline scripts
  src/
    domain/             ren logik uden I/O: dates, money, rhythm, pricing, periods, earnings,
                        backup/{schema,validate,merge,crypto}. Unit-testes grundigt.
    data/               Db-interface, migrations/NNN_*.ts, repositories (clients, visits, settings)
      native.ts         @capacitor-community/sqlite + SQLCipher (telefon)
      sqljs.ts          sql.js (kun tests og browser-preview, dev-dependency, ikke i APK'en)
    platform/           bro til native: lock, secureScreen, files (gem/åbn/del), haptics, notifications
    ui/                 komponenter (BottomSheet, Snackbar, Chip, SwipeRow, NavBar, …), icons/, tokens.css
    screens/            Due, Clients, Client, VisitSheet, Money, More, Backup, Lock, Onboarding
    assets/fonts/       Italiana + Bricolage Grotesque (woff2, OFL-licens medfølger)
  tests/                e2e (Playwright mod web-build), fixtures (prototype-backups)
  android/              Capacitor-projekt (committes), eget lokalt plugin i dk.saloona.app
```
- **State:** Svelte 5-runes. Data læses fra DB ved start og efter hver skrivning. Skrivninger går altid gennem repositories.
- **Eget Kotlin-plugin (`SaloonaNative`):** biometri/enheds-PIN, FLAG_SECURE til/fra, gem fil (`ACTION_CREATE_DOCUMENT`), åbn fil (`ACTION_OPEN_DOCUMENT`), del via share sheet, haptik (`performHapticFeedback`). Pluginnet erstatter 4–5 tredjepartsplugins.
- **Ring/SMS:** `ACTION_DIAL`/`ACTION_SENDTO` med et valideret nummer. Det kræver ingen telefon-permission.
- **Notifikationer (valgfri, slået fra som standard):** `@capacitor/local-notifications`. Når data ændres, planlægges de næste 14 dages notifikationer kl. 9 med færdigudregnet tekst. Da data kun ændres, når appen bruges, er teksten altid korrekt. Er app-låsen slået til, står der ingen navne på låseskærmen, fx "3 kunder er over tid".

### Runtime-dependencies (låst eksakt)
`svelte`, `@capacitor/core`, `@capacitor/android`, `@capacitor-community/sqlite`, `@capacitor/local-notifications`.
Dev-dependencies: `vite`, `@sveltejs/vite-plugin-svelte`, `typescript`, `svelte-check`, `vitest`, `sql.js`, `@playwright/test`, `@capacitor/cli`.

### Android
- `minSdk 26`, `targetSdk`/`compileSdk 36`, Capacitor 8.
- **Ingen `INTERNET`-permission**, så Android selv forhindrer netværk. Det verificeres i fase 1, at WebView'et virker uden.
- `allowBackup="false"`, og `dataExtractionRules` samt `fullBackupContent` udelukker alt. Begrundelsen er, at databasen er krypteret med en Keystore-nøgle, der ikke følger med til en anden telefon. En Google-backup ville derfor være ubrugelig og kun en ekstra kopi af persondata. Backup sker bevidst via eksport.
- Permissions (foreløbig):
  - `USE_BIOMETRIC` bruges til app-låsen.
  - `POST_NOTIFICATIONS` bruges til påmindelsen og spørges der først om, når den slås til.
  - `RECEIVE_BOOT_COMPLETED` bruges, så påmindelser overlever en genstart.
  - Alt andet, som plugins merger ind (fx `SCHEDULE_EXACT_ALARM`), fjernes.
- FLAG_SECURE er sat, når app-låsen er slået til. WebView-debugging er kun slået til i debug-builds. Release bruger R8.

### Sikkerhed i webview
CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Den justeres kun, hvis Capacitor kræver det, og det skal i så fald dokumenteres. `{@html}`, `innerHTML` og `eval` er forbudt.

## Datamodel (SQLite + SQLCipher, `PRAGMA user_version`)
**Migration 001**
- `clients`
  - `id TEXT PK`
  - `name TEXT NOT NULL`
  - `gender TEXT NULL CHECK (gender IN ('dame','herre'))`
  - `tag TEXT NULL` (fx "Barn")
  - `phone TEXT NULL`
  - `note TEXT NOT NULL DEFAULT ''`
  - `created_at`, `updated_at`
- `visits`
  - `id TEXT PK`
  - `client_id TEXT NOT NULL REFERENCES clients ON DELETE CASCADE`
  - `treatment TEXT NOT NULL`
  - `treatment_key TEXT NOT NULL` (trim + lowercase + samlede mellemrum)
  - `date TEXT NOT NULL` (`YYYY-MM-DD`)
  - `amount_ore INTEGER NULL`
  - `pay TEXT NULL CHECK (pay IN ('kontant','mp_mig','mp_noah'))`
  - `note TEXT NOT NULL DEFAULT ''`
  - `created_at`, `updated_at`
  - Indeks på `(client_id, treatment_key, date)` og `(date)`.
- `treatment_prices(treatment_key PK, amount_ore)` indeholder prototypens `prices` og bruges som sidste fallback til prisforslag.
- `settings(key PK, value)` gemmer `lastBackupAt`, `lockEnabled`, `remindersEnabled`, `theme` og `onboarded`.

**Regler**
- Besøg og aftale skelnes på datoen: `date <= i dag` er et gennemført besøg, og `date > i dag` er en booket aftale. Der er ingen statuskolonne, så en aftale bliver automatisk til et besøg, når dagen kommer.
- **Rytme** gælder pr. kunde og `treatment_key`. Kun gennemførte besøg tæller, og hver dato tælles én gang. Med mindst 3 datoer er intervallet (sidste − første) / (antal − 1), og det forventede næste besøg er sidste dato + det afrundede interval. Status er "over tid", hvis forventet dato < i dag, "inden for 2 uger", hvis den ligger 0–14 dage frem, og ellers "senere". Findes der en booket aftale på samme behandling, vises kunden ikke som over tid. Detaljerne afstemmes med prototypens beregning, når den er læst.
- **Prisforslag:** kundens seneste beløb for samme behandling, ellers det seneste beløb for behandlingen, ellers `treatment_prices`, ellers tomt. Betalingsmåden forudfyldes med kundens seneste.
- **Indtjening:** kun gennemførte besøg tæller.

## Backup-format
Eksporten er et superset af prototypens format, så prototypen kan læse de kendte felter:
```
{ app: "saloona", version: 2, exported: ISO-tid,
  clients: [{ id, name, gender?, note?, tag?, phone? }],
  visits:  [{ id, clientId, treatment, date, note, amount?, pay? }],
  prices:  { [behandling lowercase]: number } }
```
- Importen accepterer `app: "salonbog"` og `app: "saloona"` samt krypterede filer (`{ app: "saloona", format: "encrypted", kdf, cipher, data }`).
- Alt valideres felt for felt: størrelsesgrænse, ingen `__proto__`, datoer, beløb, enums, længder og referencer. Derefter vises en forhåndsvisning ("12 kunder, 40 besøg – 3 nye kunder, 5 nye besøg"), og man vælger mellem **Erstat** og **Flet**. Importen sker i én transaktion.
- **Flet:** kunder matches på id og ellers på navn (uden hensyn til store og små bogstaver). Besøg matches på id og ellers på kunde + dato + behandling. Hvor der er konflikt, vinder de eksisterende data.

## Skærme
1. **Snart tid:** dagens dato, Kommende aftaler, Over tid, Inden for 2 uger og Senere. "Samler data (x/3)" er sammenfoldet. Efter 14 dage uden backup vises en diskret påmindelse.
2. **Kunder:** alfabetisk liste (`Intl.Collator('da')`), søgning og filteret Alle/Dame/Herre med antal.
3. **Kundeside:** mærke, Ring/SMS, note, næste aftale, rytme pr. behandling, total brugt og fuld historik. Et tryk redigerer, og et swipe sletter med Fortryd. Kunden kan redigeres og slettes.
4. **Besøg-sheet** (bottom sheet fra + og fra kundesiden):
   - kunde med autoudfyld (en ny kunde vælger dame/herre)
   - behandlings-chips sorteret efter brug
   - beløb og betaling forudfyldt
   - dato med "I dag", "I går" og "Vælg dato"
   - note
   - Knappen hedder "Gem besøg" eller "Book aftale" efter datoen. Målet er under 10 sekunder.
5. **Indtjening:**
   - perioderne Denne måned, Sidste måned, I år og Alt
   - total, antal besøg og gennemsnit
   - besøg uden beløb (et tryk lader dig udfylde dem)
   - 6 måneder som søjler
   - fordeling pr. betalingsmåde og pr. behandling samt topkunder
6. **Mere:** Backup og gendannelse, App-lås, Påmindelse, Udseende (System/Lys/Mørk), Privatliv (slet alle data) og Om.
7. **Låseskærm og førstegangsstart**, hvor man vælger mellem "Hent fra backup" og "Start forfra".

Bundnavigationen er: Snart tid · Kunder · [+] · Indtjening · Mere.

## Faser
security-reviewer og qa-tester skal godkende hver fase, før den næste starter.
1. **Fundament:**
   - Vite/Svelte/TS-projekt og Capacitor-Android (uden INTERNET)
   - CSP, lokale fonte og design-tokens
   - krypteret DB og migrationer
   - domænelogik med unit tests (datoer, rytme, prisforslag, beløb, perioder)
   - CI der bygger debug-APK
2. **Kerne:** Snart tid, Kunder, Kundeside, besøg-sheet (opret/rediger/slet med Fortryd), Ring/SMS og e2e-tests.
3. **Indtjening og backup:** Indtjening, eksport (plus adgangskode), import med validering, forhåndsvisning og erstat/flet, prototype-kompatibilitet og backup-påmindelse.
4. **Sikkerhed og finish:** app-lås, FLAG_SECURE, påmindelser, slet kunde/alle data, backup-regler, ikoner, app-ikon, splash, haptik, swipe og dark mode.
5. **Release:** signering fra miljøvariabler eller `~/.gradle/gradle.properties`, release-APK, `SECURITY.md`, `README.md` på dansk og en sidste QA- og sikkerhedsgodkendelse.

## Miljø og begrænsninger
- Android SDK hentes fra `dl.google.com`, som i øjeblikket er blokeret i dette cloud-miljø. Indtil ejeren tillader værten, bygges APK'er i GitHub Actions.
- Der er ingen emulator her (ingen KVM). UI testes i Chromium i telefonstørrelse. Den sidste test på en fysisk telefon laver ejeren efter en tjekliste.
