# LoopCast

En lille Android-app, der looper ét SoundCloud-track på din Google Nest / Chromecast –
også uden SoundCloud Go+. Indsæt et link, vælg din Nest, tryk **Afspil i loop**.

## Download

Hver gang der pushes til repoet, bygger GitHub Actions en APK:

- **Direkte link:** <https://github.com/Hacking-TR3X/Arbejde/releases/latest/download/LoopCast.apk>
- Eller under **Releases → LoopCast – nyeste build**.

Installér APK'en på telefonen (tillad "installér ukendte apps" for din browser/filhåndtering).
Nye builds er signeret med samme nøgle, så de kan installeres oven på den gamle.

## Sådan bruger du den

1. Sørg for at telefonen og din Nest er på samme Wi‑Fi.
2. Tryk på **cast-ikonet** øverst og vælg din Nest.
3. Indsæt et SoundCloud-link (korte `on.soundcloud.com/...`-links virker også) – eller del
   tracket fra SoundCloud-appen til LoopCast.
4. Tryk **Afspil i loop på Nest**. Tracket gemmes automatisk i listen, så du bare kan trykke
   på det næste gang.
5. **Stop** stopper afspilningen. Skraldespanden fjerner et gemt track.

Første gang vil appen bede om lov til notifikationer (den viser en lille "kører"-notifikation,
mens der castes). Under menuen (⋮) kan du undtage appen fra batterioptimering, så Android ikke
slår den ihjel midt om natten.

## Sådan virker det

- Appen slår tracket op via SoundCloud's offentlige web-API (samme som soundcloud.com bruger)
  og **henter MP3'en til telefonen én gang**. Herefter er SoundCloud slet ikke involveret.
- En lille relæ-server på telefonen (`http://<telefon-ip>:8765/...`) serverer den lokale fil
  til Nest'en. Nest'en får tracket som en kø med ét nummer og *repeat single*, så den looper selv.
- En baggrundsservice holder øje hele natten: melder Nest'en "færdig" eller "fejl", bliver
  tracket indlæst igen; falder cast-forbindelsen fra telefonen ud, genopretter appen den selv;
  bliver appen genstartet af Android, fortsætter den hvor den slap. Den stopper først, når du
  trykker **Stop** (i appen eller i notifikationen).
- Telefonen skal derfor blive på Wi‑Fi og være tændt (skærmen må gerne være slukket).
  Menupunktet **Cast direkte (uden relæ)** sender SoundCloud's eget link til Nest'en i stedet –
  så er telefonen ikke nødvendig, men loopet stopper når linket udløber.

## Hvis loopet stopper om natten

1. Menu (⋮) → **Undtag fra batterioptimering** og sig ja.
2. Samsung: Indstillinger → Batteri → Baggrundsbegrænsninger → **Apps der aldrig sover** → tilføj
   LoopCast. Slå også "Sæt ubrugte apps i dvale" fra for LoopCast.
3. Sørg for at Wi‑Fi ikke slukkes i dvale (Indstillinger → Wi‑Fi → Avanceret på de fleste telefoner).
4. Lad LoopCast-notifikationen blive stående – den er tegnet på, at baggrundsservicen kører.

## Byg selv

Kræver Android SDK (compileSdk 35) og JDK 17:

```
./gradlew assembleRelease
```

APK'en lander i `app/build/outputs/apk/release/app-release.apk`.

Signeringsnøglen i `app/keystore/loopcast.jks` (kodeord `loopcast`) er kun til denne
side-loadede hobby-app og er bevidst ikke hemmelig.
