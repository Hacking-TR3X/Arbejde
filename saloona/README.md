# Saloona

En lille Android-app til en frisør, der klipper hjemme. Den holder styr på kunderne, hvor ofte de kommer, og hvad der er tjent. Alt ligger kun på telefonen: databasen er krypteret, og appen har ingen adgang til internettet.

- **Snart tid:** hvem der er over tid, hvem der kommer inden for 2 uger, og de kommende aftaler.
- **Kunder:** alfabetisk liste med søgning og filteret Dame/Herre. Kundesiden viser rytme, næste aftale, beløb brugt i alt og historik, og du kan ringe eller sende SMS.
- **Nyt besøg:** et par tryk. Prisen og betalingsmåden er udfyldt på forhånd. Vælger du en dato frem i tiden, bliver det en booket aftale.
- **Indtjening:** pr. måned og år, pr. betalingsmåde, pr. behandling og topkunder.
- **Backup:** gem en fil i fx Google Drev, eventuelt beskyttet med adgangskode. Du kan også hente backups fra den gamle Salonbog.

---

## 1. Installér appen på telefonen (sideloading)

1. Hent APK-filen over på telefonen. Det kan være via en download-side, e-mail, Google Drev eller et USB-kabel.
2. Åbn filen på telefonen. Første gang spørger Android, om den app, du åbner filen fra (fx Chrome eller Filer), må installere ukendte apps. Tryk **Indstillinger**, slå **Tillad fra denne kilde** til, og gå tilbage.
3. Tryk **Installer**.
4. Når appen er installeret, kan du slå tilladelsen fra igen under *Indstillinger → Apps → (appen) → Installer ukendte apps*.

Er telefonen tilsluttet en computer med USB-fejlfinding slået til, kan du også bruge `adb install -r Saloona.apk`.

**Opdatering:** Installér den nye APK oven på den gamle. Dine data bliver liggende, så længe APK'en er signeret med **samme nøgle**. Derfor skal du passe godt på din keystore (se afsnit 3).

### Testversionen
GitHub bygger automatisk en testversion, **Saloona test**, ved hvert push. Du finder den under *Releases → Saloona – testversion* i dette repository (filen `Saloona-test.apk`).
- Den er bygget som den rigtige app. Databasen er krypteret, der er ingen fejlfinding slået til, og appen har ingen internetadgang. Den er dog signeret med en testnøgle fra GitHub og har sit eget app-id (`dk.saloona.app.test`), så den kan ligge ved siden af den rigtige Saloona.
- **Tag backup, før du installerer en ny testversion.** Testnøglen ligger i GitHubs cache og kan blive skiftet, hvis der ikke bygges i 7 dage. Så kan den nye testversion ikke installeres oven på den gamle, og den gamle skal afinstalleres først. Dine data får du tilbage fra backup-filen.
- Den rigtige app bygger og signerer du selv med din egen nøgle (afsnit 3). Data flytter du fra testversionen til den rigtige app med backup og gendannelse.

---

## 2. Backup og gendannelse

Alt ligger kun på telefonen, og Android tager bevidst ikke automatisk backup af Saloona (se [SECURITY.md](SECURITY.md)). Tag derfor en backup jævnligt. Appen minder dig om det, når der er gået 14 dage.

**Tag backup:** Gå til *Mere → Backup og gendannelse*.
- **Gem som fil** åbner Androids filvælger. Vælg fx *Drev* og en mappe.
- **Del** åbner delingsmenuen, hvor du fx kan sende filen til dig selv på mail.
- **Beskyt med adgangskode** krypterer filen (AES-256). Glemmer du adgangskoden, kan filen ikke åbnes. Heller ikke af os.

**Hent backup:** Tryk *Vælg backup-fil* samme sted, eller *Hent fra backup* første gang appen åbnes. Du ser, hvor mange kunder og besøg filen indeholder, og om noget i den var ugyldigt. Derefter vælger du:
- **Flet med appen:** Nye kunder og besøg bliver tilføjet. Kunder bliver genkendt på id og navn, og besøg på kunde + dato + behandling. Det, der allerede er i appen, bliver ikke ændret, så du kan trygt flette den samme fil to gange.
- **Erstat alt:** Alt i appen bliver skiftet ud med indholdet af filen.

**Fra den gamle Salonbog:** Brug backup-funktionen i Salonbog til at gemme en backup-fil (JSON), og læg filen på telefonen. Vælg den derefter i Saloona under *Hent fra backup*. Kunder, besøg, beløb, betalingsmåder og standardpriser kommer med. En kort kunde-note som "Barn" bliver til kundens mærke.

---

## 3. Byg APK'en selv

### Det skal du bruge
- **Node.js 22** (22.12 eller nyere)
- **JDK 21** (fx Temurin)
- **Android SDK** med *Android SDK Platform 36* og *Build-Tools 36*. Det nemmeste er at installere Android Studio og åbne *SDK Manager*. Sæt derefter miljøvariablen `ANDROID_HOME` til SDK-mappen, eller lav filen `saloona/android/local.properties` med `sdk.dir=/sti/til/Android/sdk`. Den fil må ikke committes, og den er allerede i `.gitignore`.

### Debug-APK (kun til udvikling)
```sh
cd saloona
npm ci
npm run build          # bygger web-delen til dist/
npx cap sync android   # kopierer den ind i Android-projektet
cd android
./gradlew assembleDebug
```
APK'en ligger derefter i `android/app/build/outputs/apk/debug/app-debug.apk`. Debug-buildet kan inspiceres over USB. Brug det derfor ikke til rigtige kundedata. `./gradlew assembleTester` bygger den hærdede testversion (samme som release, signeret med din lokale debug-nøgle).

### Signeret release-APK

**Trin 1: Lav en keystore (kun én gang).** Gem den **uden for** repository'et, fx i en mappe i din hjemmemappe:
```sh
mkdir -p ~/saloona-signering
keytool -genkeypair -v \
  -keystore ~/saloona-signering/saloona-release.jks \
  -alias saloona -keyalg RSA -keysize 4096 -validity 10000
```
`keytool` følger med JDK'en. Du bliver bedt om et password og om navn og by. Navn og by må gerne være noget kort, fx dit navn.

> **Pas på keystoren og passwordet.** Mister du dem, kan du ikke længere lave opdateringer, der kan installeres oven på den app, der er på telefonen. Så skal appen afinstalleres, og data skal hentes tilbage fra en backup. Læg en kopi af keystoren et sikkert sted, fx en krypteret USB-nøgle eller en password-manager. Læg den **aldrig** i git.

**Trin 2: Fortæl Gradle, hvor nøglen ligger.** Skriv dette i `~/.gradle/gradle.properties`, altså i din hjemmemappe og **ikke** i projektet:
```properties
SALOONA_KEYSTORE_FILE=/Users/dig/saloona-signering/saloona-release.jks
SALOONA_KEYSTORE_PASSWORD=dit-keystore-password
SALOONA_KEY_ALIAS=saloona
SALOONA_KEY_PASSWORD=dit-key-password
```
Du kan også sætte de samme navne som miljøvariabler i terminalen. Miljøvariabler vinder over `gradle.properties`.

**Trin 3: Byg.**
```sh
cd saloona
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
```
Den signerede APK ligger i `android/app/build/outputs/apk/release/app-release.apk`. Mangler signeringsoplysningerne, bygges en **usigneret** APK (`app-release-unsigned.apk`), og Gradle skriver en advarsel. En usigneret APK kan ikke installeres.

**Tjek signaturen (valgfrit):**
```sh
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

---

## 4. Udvikling

```sh
cd saloona
npm ci
npm run dev          # web-preview i browseren med en sql.js-database (kun til udvikling)
npm run check        # svelte-check + TypeScript
npm test             # unit tests (vitest)
npm run test:coverage
npm run e2e          # end-to-end-tests (Playwright) mod web-preview
npm audit
```

Web-preview'et bruger sql.js og localStorage, så appen kan udvikles og testes i en browser. Den kode kommer ikke med i Android-buildet. På telefonen bruges SQLCipher.

### Opbygning
```
src/domain/    ren logik: datoer, beløb, rytme, prisforslag, indtjening, backup (grundigt unit-testet)
src/data/      migrationer, repository, SQLCipher-adapter (Android) og sql.js-adapter (test/preview)
src/platform/  bro til det lille native plugin (app-lås, filer, deling, haptik) og påmindelser
src/lib/       app-state, navigation, snackbar
src/screens/   skærmene
src/ui/        komponenter og ikoner
android/       Capacitor-projektet og vores eget plugin (dk.saloona.app)
```
Du kan læse mere i [docs/PLAN.md](docs/PLAN.md) og [SECURITY.md](SECURITY.md).

### Databaseændringer
Tilføj en ny fil i `src/data/migrations/` (fx `002_*.ts`), og registrér den i `migrations/index.ts`. Ret aldrig i en migration, der har været med i en udgivet APK.
