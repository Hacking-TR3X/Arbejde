# Spøgelsesjæger

En Android-app, der hjælper dig med at finde spøgelset i **Phasmophobia**. Læg telefonen ved
siden af tastaturet, og markér beviser og adfærd, mens I spiller. Appen viser løbende, hvilke
spøgelser det stadig kan være.

Data er opdateret til Phasmophobia **v0.19** (september 2026). Det dækker alle **30 spøgelser**,
også Dayan, Gallu, Obambo, Kormos, Aswang og Deildegast.

## Download

- **Direkte link:** <https://github.com/Hacking-TR3X/Arbejde/releases/download/spoegelsesjaeger-latest/Spoegelsesjaeger.apk>
- Eller under **Releases → Spøgelsesjæger – nyeste build**.

Installér APK'en på telefonen. Du skal tillade "installér ukendte apps" for din browser eller
filhåndtering. Nye builds er signeret med samme nøgle og kan installeres oven på den gamle.

## Find spøgelset

- **Beviser:** Tryk på et bevis for at sætte det til fundet (grønt ✓). Tryk igen for udelukket
  (rødt ✗), og en tredje gang for ukendt.
  - Beviser, som ingen af de mulige spøgelser kan have, bliver grå. Så ved du, at du ikke behøver
    lede efter dem.
  - Hold fingeren på et bevis for at se, hvordan du finder det.
- **Antal beviser:** Vælg 3, 2 (Nightmare), 1 (Insanity) eller 0. Appen tager højde for, at
  beviser kan være skjult. Den ved også, at nogle spøgelser altid viser et bestemt bevis:
  - Goryo viser altid D.O.T.S.
  - Hantu viser altid Freezing.
  - Obake viser altid UV.
  - Moroi og Deogen viser altid Spirit Box.
  - Mimic viser altid falske Ghost Orbs.
- **Adfærd og fart:** Udeluk spøgelser ud fra, hvad I har set. For eksempel:
  - "Spøgelset tændte et lys" udelukker Mare.
  - "Tåge-event" udelukker Oni og Kormos.
  - "Jagt under 90 s efter røgelse" betyder, at det er en Demon.
  - "Spøgelset har et mandenavn" udelukker Banshee og Dayan.
  - Du kan også markere, om jagt-farten var langsom, normal eller hurtig.
- **Listen:** Tryk på et spøgelse for at se dets jagt-sanity, hastighed, kendetegn og tests. Hold
  fingeren på et spøgelse for at strege det ud selv.
- **Nulstil** øverst starter en ny opgave. Du kan fortryde det lige bagefter.

## Værktøjer

- **Smudge-timer:** Start den, når du bruger røgelse. Telefonen bipper og vibrerer ved 60, 90 og
  180 s.
  - Trykker du **"Den jagter nu!"**, markerer appen selv, hvad det betyder. En jagt før 90 s
    betyder Demon. En jagt før 180 s betyder, at det ikke er en Spirit.
- **Pause efter jagt:** Start den, når en jagt slutter. Jager spøgelset igen inden 25 s, er det en
  Demon.
- **Fodtrin → hastighed:** Tryk i takt med spøgelsets skridt under en jagt. Appen regner farten
  ud i m/s og viser, hvilke af de mulige spøgelser der passer.
  - Husk at sætte spøgelsesfarten, hvis I spiller med en tilpasset sværhedsgrad.
- Timerne holder skærmen tændt, mens de kører. Under menuen (⋮) kan du vælge, at skærmen altid
  skal holdes tændt.

## Byg selv

Kræver Android SDK (compileSdk 35) og JDK 17:

```
./gradlew :spoegelsesjaeger:testDebugUnitTest :spoegelsesjaeger:assembleRelease
```

APK'en lander i `spoegelsesjaeger/build/outputs/apk/release/spoegelsesjaeger-release.apk`.

Signeringsnøglen `keystore/spoegelsesjaeger.jks` har kodeordet `spoegelse`. Den er kun til denne
side-loadede hobby-app og er bevidst ikke hemmelig.

## Kilder

Spøgelsesdata er samlet fra Kinetic Games' patch notes, Phasmophobia-wikien og community-trackere
som Zero-Network. Omregningen fra fodtrin til hastighed bruger samme model som Zero-Network.
