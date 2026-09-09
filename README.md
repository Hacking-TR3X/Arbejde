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
  og finder MP3-streamen.
- SoundCloud's stream-links udløber efter et stykke tid. Derfor kører appen en lille relæ-server
  på telefonen (`http://<telefon-ip>:8765/...`), som Nest'en afspiller fra. Relæet henter et nyt
  stream-link, hver gang det gamle udløber, så loopet kører hele natten.
- Nest'en får tracket som en kø med ét nummer og *repeat single*, så den looper selv. Appen
  genstarter desuden afspilningen, hvis Nest'en alligevel melder "færdig".
- Telefonen skal derfor blive på Wi‑Fi og være tændt (skærmen må gerne være slukket).
  Menupunktet **Cast direkte (uden relæ)** sender SoundCloud's eget link til Nest'en i stedet –
  så er telefonen ikke nødvendig, men loopet stopper når linket udløber.

## Byg selv

Kræver Android SDK (compileSdk 35) og JDK 17:

```
./gradlew assembleRelease
```

APK'en lander i `app/build/outputs/apk/release/app-release.apk`.

Signeringsnøglen i `app/keystore/loopcast.jks` (kodeord `loopcast`) er kun til denne
side-loadede hobby-app og er bevidst ikke hemmelig.
