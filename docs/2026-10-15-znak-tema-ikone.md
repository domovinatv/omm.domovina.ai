# Znak, tema i ikone (2026-10-15)

Kako se OMM brendirao u sustav znakova iz mediakita (`~/git/domovinatv/mediakit.domovina.tv`,
README „Brand sustav“). Kako je to složeno u kodu: `CLAUDE.md`, poglavlje „Izgled“.

## Stanje

- **Dvije opcije uživo**, odluka još nije pala:
  - **B** (zadano, https://omm.domovina.ai): pločica u sustavu MPT/airKUNA. Tamnoplava pločica,
    bijeli prsten „O“, zlatna munja. Tema: svijetla bijela s tamnoplavim akcentom, tamna
    tamnoplava (`#001a3d`) sa zlatnim akcentom `#E3AF35`.
  - **A** (https://omm.domovina.ai/?znak=A, velika slova nisu bitna): D okvir s prstenom
    i munjom u sredini. Tema: neutralna bijela ili tamna (`#0e1014`), tamnoplavi ili bijeli gumbi,
    zastava kao traka od 6 px na vrhu. Tamna varijanta znaka ima tamnoplavu podlogu i bijeli
    obrub D-a, inače se donja plava pruga gubi.
- Prekidač svijetlo/tamno je na svim stranicama i vrijedi za obje opcije. Izbor se pamti u
  `localStorage` (`omm-tema`).
- `?znak=a` se ne pamti pri prelasku na `/ocitaj` ili `/admin`. Kolačić je ponuđen, ali nije
  napravljen.
- Ivan je 2026-10-15 na WhatsAppu dobio 4 snimke s pitanjem koju opciju bira. Odgovor čeka.
- Mediakit ima obje varijante (commit `51efaed`, drugi session). PDF izvještaj još nosi logo
  Domovina Energyja (`src/lib/izvjestaj/logo.svg`).

## Odbačene varijante

Prva ploča je imala četiri prijedloga s D okvirom i jedan s pločicom: A1 brojilo (kućište sa
zaslonom), A2 sunce, A3 brojilo s munjom, A4 slovo O s munjom i B pločicu. Matija je odabrao
A4 i B, a obje su crtane samo punim oblicima s ravnim krajevima (pravilo iz mediakita).

- **A4b** (tanji prsten 80/62 umjesto 74/52, munja 0,70 umjesto 0,62) nije se vidjela na
  ploči. Promjena ispod ~20 % veličine nije vrijedna prikazivanja kao zasebna opcija.
- **Na 16 px se simbol u D okviru ne vidi**, ni u logu Domovina Energyja. Na toj veličini
  ostane samo zastava. Pločica je jedina čitljiva na 16 px.
- **Pločica je u mediakitu rezervirana za platnu obitelj ITalka** (MPT, airKUNA, pay).
  Matija je unatoč tome sklon B-u („nekako mi se adekvatnije čini plava nego bijela“). Zato
  su obje opcije uživo.
- **Paleta Domovina Energyja** u aplikaciji je krem i zelena (`example/lib/tema.dart` u
  flutter_moja_mreza), pa nije uzeta za A. A je napravljen od boja zastave.

## Ikone: font umjesto emojija

Matija je tražio da u kodu nema emojija i da ikone budu font. U developmentu se koristi cijeli
font, a za deploy samo izrezane ikone.

- **Material Symbols Sharp**, a ne Lucide ili Font Awesome: Sharp ima ravno odrezane krajeve i
  oštre kutove kao znak. Lucide i Font Awesome crtaju okrugle kapice, a upravo zbog okruglih
  kapica je raniji € odbačen. Ikone su pune (`FILL 1`), u skladu s pravilom „puni oblici“.
- **Brojke**: cijeli varijabilni font ima 3,45 MB i 4301 ikonu. Za deploy ostaje 19 ikona,
  2,0 kB woff2 + 1,4 kB CSS. Režu se `subset-font` (harfbuzz wasm, bez Pythona), a osi
  `FILL 1, wght 400, GRAD 0, opsz 24` se fiksiraju.
- **Klase, ne ligature**: `i-<ime>::before { content: "\eXXX" }`. S ligaturama bi rezanje
  moralo zadržati GSUB za sva slova, pa ne bi ništa uštedjelo. Skripta imena nalazi u izvoru
  pa ih treba pisati cijela (`ikona("i-check")`, ne `"i-" + ime`).
- **Iznimka: ⚡ u oznaci „Uvezi iz HEP-a“.** Tekst linka postaje ime oznake u traci
  preglednika, gdje font ikona ne postoji. Na Windowsima 8.1+ (Segoe UI Emoji) i na macOS-u
  se emoji prikazuje u boji. Na Linuxu ovisi o Noto Color Emoji, a bez njega izađe
  crno-bijel ili kao kvadratić. Rad oznake to ne mijenja.
- `hep-uvoz.js` (generiran u flutter_moja_mreza) zadržava „✓“ u statusu. Matija je rekao
  da ostane.

## Zamke

- **Playwright iz Pythona** traži `chromium_headless_shell-1155`, a u cacheu su 1223 i 1243.
  Umjesto instalacije koristi `chromium.launch(executable_path="/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome")`. S `viewport` daje pravih 320 i 375 px.
- **Nakon `npm i` pada `astro dev`** koji već radi („file does not exist … .vite/deps_ssr“).
  Treba `npx astro dev stop` pa `npm run dev`.
- **Tamni mod mora gledati i prekidač, ne samo sustav.** `<picture><source media=…>` gleda
  samo sustav, pa se logo bira CSS varijablama `--dan`/`--noc` (klase `samo-dan`, `samo-noc`),
  koje postavljaju tokeni teme.
- **Traka zastave kao `border-top` na `body`** nestane ispod bočnog stupca (fixed). Zato je
  `body::before` s `position: fixed` i `z-index`.
