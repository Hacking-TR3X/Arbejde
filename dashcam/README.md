# Dashcam

Android-app til **YI Smart Dash Camera** (model YCS.1015), der erstatter den gamle YI-app.

## Download

- **Direkte link:** <https://github.com/Hacking-TR3X/Arbejde/releases/download/dashcam-latest/Dashcam.apk>
- Eller under **Releases → Dashcam – nyeste build**.

Installér APK'en på telefonen (tillad "installér ukendte apps" for din browser/filhåndtering).
Alle builds er signeret med samme nøgle, så nye versioner kan installeres oven på den gamle.

## Hvad den kan

- **Forbinder ordentligt.** Kameraets Wi‑Fi har ikke internet, så nyere Android sender den
  gamle apps trafik ud over mobildata i stedet – og så "kan den ikke finde kameraet". Dashcam
  binder sig fast til kameraets Wi‑Fi, så al trafik går derhen.
- **Husker dine indstillinger.** Det du vælger under *Kameraets indstillinger*, husker appen.
  Hver gang den forbinder, retter den kameraet tilbage, hvis det har glemt noget, og stiller
  kameraets ur efter telefonen.
- **Live-billede** fra kameraet, med knapper til at gemme et nødklip eller tage et billede.
- **Optagelser, nødklip og billeder** fra SD-kortet: se dem, afspil dem direkte, hent dem til
  telefonen (*Film/Dashcam* og *Billeder/Dashcam*) eller slet dem.
- **Bladr mellem videoerne** i afspilleren med *◀ Tidligere* / *Senere ▶* – de ligger i
  tidsrækkefølge og spiller videre i den næste, ligesom selve køreturen.
- **Klip:** vælg start og slut på en video og gem kun det stykke. Appen henter kun den del
  (plus filens indeks) fra kameraet, så et klip på 30 sekunder går mange gange hurtigere end at
  hente hele videoen. Kan kameraet ikke sende dele af filer, hentes hele videoen først.
- **Hent** giver valget mellem et klip, kameraets lille preview-kopi (hvis den findes) og hele
  videoen.
- **Skift kameraets Wi‑Fi-kode** (eksperimentelt, under ⋮).
- **Test forbindelsen** (under ⋮): måler kameraet – hvor lang tid fil-listen tager,
  overførselshastighed, om kameraet kan sende dele af en fil, hvordan MP4-filerne er bygget
  op, og hvad kameraet svarer på RTSP- og MJPEG-adresserne – og laver en rapport, du kan dele.

Live-billedet prøver RTSP over TCP, RTSP over UDP og MJPEG over HTTP efter tur og husker den
metode, der virker. Hvert forsøg står under *Hændelser* på forsiden.

Kameraets webserver kan kun én ting ad gangen, så fil-listen henter miniaturebilleder én ad
gangen og kun for de rækker, der er på skærmen, og holder pause, mens der hentes en video. Kan
kameraet ikke selv levere en miniature, laver appen den ud fra videoen (den læser kun filens
indeks og det første billede). Alle miniaturer gemmes på telefonen, så de kun hentes én gang.
De kan slås fra i fil-listens menu.

## Første gang

1. Tænd kameraet og slå dets Wi‑Fi til.
2. Åbn Dashcam og tryk **Forbind til kameraet**. Android viser en liste over Wi‑Fi-netværk,
   hvis navn begynder med `YI` – vælg kameraet. Appen bruger standardkoden `1234567890`.
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
Python-bibliotek [kwirk/yidashcam](https://github.com/kwirk/yidashcam).

- `app/src/main/java/dk/dashcam/cam/` – protokollen (ren Kotlin, ingen Android).
- `app/src/test/` – tests mod et falsk kamera, der opfører sig som det rigtige.
- `app/src/main/java/dk/dashcam/` – app, Wi‑Fi-håndtering og skærme.

Firmware-opdatering laver appen bevidst ikke – en fejl der kan gøre kameraet ubrugeligt.

## Byg selv

Kræver Android SDK (compileSdk 35) og JDK 17. Kør fra denne mappe:

```
./gradlew testReleaseUnitTest assembleRelease
```

APK'en lander i `app/build/outputs/apk/release/app-release.apk`.

Signeringsnøglen i `app/keystore/dashcam.jks` (kodeord `dashcam`) er kun til denne
side-loadede hobby-app og er bevidst ikke hemmelig.
