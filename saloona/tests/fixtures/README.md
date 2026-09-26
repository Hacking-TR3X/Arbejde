# Testdata (fixtures)

Filerne her bruges af unit tests (`src/domain/**/*.test.ts`, `tests/unit/`) og senere af e2e-testene. Alle navne er opdigtede.

| Fil | Indhold |
|---|---|
| `salonbog-backup.json` | Backup i prototypens format (`app: "salonbog"`, `version: 1`). Prototypens 13 startkunder, 28 besøg (et af dem booket til 2026-10-02), beløb som tal (fx `450` og `1250.5`), betalingsmåderne `kontant`, `mp_mig` og `mp_noah` samt `prices: { klip: 450, farve: 900 }`. Sirius har noten "Barn", som bliver til mærket "Barn" ved import. Farmor har en lang note, der forbliver en note. "Familie Køge" har intet køn. |
| `salonbog-backup-old.json` | Ældre prototype-fil uden `app`, `amount`, `pay` og `prices`. 4 kunder og 5 besøg. |

Forventede tal ved import med "i dag" = 2026-09-26:

- Over tid: Mads (Klip, 43 dage) og Lauge (Klip, 10 dage).
- Inden for 2 uger: Sirius (Børneklip, om præcis 14 dage).
- Senere: Morten (Klip, hver 35. dag, næste gang 2026-10-31).
- Kommende aftale: Hanne, Farve 2026-10-02. Hun er over tid, men vises ikke som over tid, fordi hun har en aftale.
- September 2026: 5 besøg, i alt 4.050 kr.

Tests skal altid give "i dag" med eksplicit og må aldrig bruge telefonens ur.

Tidszone: kør suiten med både `TZ=Europe/Copenhagen npx vitest run` og `TZ=America/Los_Angeles npx vitest run`. `src/domain/dates.tz.test.ts` skifter desuden selv mellem flere tidszoner.
