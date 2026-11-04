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

---

# Dashcam

Erstatning for den gamle YI-app til **YI Smart Dash Camera** (model YCS.1015). Koden ligger i
`dashcam/`.

## Download

- **Direkte link:** <https://github.com/Hacking-TR3X/Arbejde/releases/download/dashcam-latest/Dashcam.apk>
- Eller under **Releases → Dashcam – nyeste build**.

## Hvad den kan

- **Forbinder ordentligt.** Kameraets Wi‑Fi har ikke internet, så nyere Android sender den
  gamle apps trafik ud over mobildata i stedet, og så "kan den ikke finde kameraet". Dashcam
  binder sig fast til kameraets Wi‑Fi, så al trafik går derhen.
- **Husker dine indstillinger for kameraet.** Det du vælger under *Kameraets indstillinger*,
  husker appen, og hver gang den forbinder, retter den kameraet tilbage, hvis det har glemt
  noget. Den stiller også kameraets ur efter telefonen.
- **Live-billede** fra kameraet, med knapper til at gemme et nødklip eller tage et billede.
- **Optagelser, nødklip og billeder** fra SD-kortet: se dem, afspil dem direkte, hent dem til
  telefonen (*Film/Dashcam* og *Billeder/Dashcam*) eller slet dem.
- **Skift kameraets Wi‑Fi-kode** (eksperimentelt, under ⋮).

## Første gang

1. Tænd kameraet og slå dets Wi‑Fi til.
2. Åbn Dashcam og tryk **Forbind til kameraet**. Android viser en liste over Wi‑Fi-netværk, hvis
   navn begynder med `YI` – vælg kameraet. Appen bruger standardkoden `1234567890`.
3. Hedder kameraets Wi‑Fi noget andet, eller har det en anden kode: ⋮ → **Wi‑Fi-navn og kode**.
   Du kan også bare gå på kameraets Wi‑Fi i telefonens indstillinger – så finder appen det selv.
4. Gå til **Kameraets indstillinger**, sæt kameraet op som du vil have det, og tryk
   **Husk alt som det er nu**.

Mens du kigger på filer, optager kameraet ikke (det kan det ikke samtidig). Appen starter
optagelsen igen, når du går ud af fil-listen eller afbryder.

## Sådan virker det

Kameraet kører Novatek-firmware og styres med simple HTTP-kald til `192.168.1.254`
(`/?custom=1&cmd=<nr>&par=<værdi>`) plus et "hjerteslag" på TCP-port 3333. Live-billedet er
RTSP på `rtsp://192.168.1.254/xxx.mov`. Kommandoerne stammer fra det reverse-engineerede
Python-bibliotek [kwirk/yidashcam](https://github.com/kwirk/yidashcam). Protokol-koden ligger i
`dashcam/src/main/java/dk/dashcam/cam/` og har ingen Android-afhængigheder.

Firmware-opdatering laver appen bevidst ikke – en fejl der kan gøre kameraet ubrugeligt.
