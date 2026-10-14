# CLAUDE.md — omm.domovina.ai

Servis koji sprema **snimke** stanja struje: očitanje brojila (slika zaslona →
1.8.1 / 1.8.2) i/ili uvoz OMM-ova s Moje mreže (HEP ODS). Podaci služe za ponudu
za sunčanu elektranu. Live: https://omm.domovina.ai (Worker `omm-domovina-ai`,
D.O.M. račun).

Klijenti i parser žive u `~/git/stepanic/flutter_moja_mreza` (Flutter plugin +
example app, Chrome ekstenzija). Plan i odgođena sigurnost:
`flutter_moja_mreza/docs/2026-10-12-omm-domovina-ai-plan.md`.

## Pravila

- **Server nikad ne ulazi na mojamreza.hep.hr** i ne prima HEP kolačiće. Uvoz i
  dostava očitanja (`POST /Omm/Dostava`) idu iz aplikacije u korisnikovoj sesiji.
- **Prvo da radi, sigurnost kasnije** (odluka 2026-10-12). Nema prijave: klijent
  generira nasumični ključ uređaja i šalje `Authorization: Bearer <ključ>`.
- OCR je prijedlog; korisnik uvijek potvrđuje brojeve.

## Stack

Astro 7 SSR + `@astrojs/cloudflare` 14, D1 `omm-domovina-ai` (`migrations/`),
R2 `omm-domovina-ai-slike` (slike `<ključ>/<uuid>.jpg`), Workers AI (`OCR_MODEL`
u `wrangler.jsonc`, usporedba modela je u komentaru). Bindingi se čitaju s
`import { env } from "cloudflare:workers"`.

```bash
npm run deploy          # astro build && wrangler deploy
npm run db:migrate      # D1 migracije (remote)
```

Usporedba modela: `curl -F "slika=@x.jpg;type=image/jpeg" --form-string "model=@cf/…"`
(`--form-string`, jer `-F model=@cf/…` curl čita kao datoteku). Testne slike u
`data/` (gitignored).

## Baza: pročišćeno + sirovi dnevnik

- **`snimci`** je pročišćena tablica: jedan redak po otisku sadržaja
  (`UNIQUE (uredaj, otisak)`). Otisak uvoza s HEP-a je `uvoz` bez `dohvaceno`
  (od 2026-10-13; prije je trenutak dohvata činio svaki uvoz novim), a otisak
  očitanja je OMM + t1 + t2 + dan (UTC). Ponovljeni
  `POST /api/snimak` vraća postojeći snimak (200, `duplikat: true`).
- **`dogadaji`** je sirovi dnevnik svakog upisa (`snimak`, `ocitaj`, `dostava`,
  `brisanje`) s ishodom (`novo`, `duplikat`, `ok`, `greska`), tijelom zahtjeva,
  User-Agentom i državom. Tu se vidi koliko je puta isti snimak stigao.
  Uzrok: 2026-10-12 je isti uvoz stigao 4 puta u 37 s (gumb je ostao aktivan).

## API

| Ruta | Što |
|---|---|
| `POST /api/ocitaj` | multipart `slika` (+ opcionalno `model`) → `{slika, t1, t2, neodredeno, registri, napomena, sirovo}` |
| `POST /api/snimak` | (201 novi, 200 + `duplikat: true` postojeći) JSON `{izvor: foto\|rucno\|hep\|hep-moj-racun, t1, t2, omm, slike[], ocr, lokacija{lat,lon,tocnost_m}, uvoz, hep_dostava}` |
| `GET /api/snimak` | snimci ovog ključa |
| `PATCH /api/snimak/:id` | `{hep_dostava, omm?}` nakon slanja HEP-u |
| `DELETE /api/snimak/:id` | briše snimak i slike |
| `GET /api/slika/<ključ>/<uuid>.jpg` | slika |
| `GET /api/mail` | zadnji primljeni mailovi ovog ključa (računi, Gmailov kod potvrde) |
| `/uvoz` | uvoz bez instalacije: bookmarklet „Uvezi iz HEP-a“ i adresa za račune mailom |
| `/hep-uvoz.js` | kod bookmarkleta; **generiran** u flutter_moja_mreza (`cd extension && npm run bookmarklet`), ne mijenjati ovdje |

## Računi mailom

`racuni+<ključ>@omm.domovina.ai` (Email Routing poddomena `omm`, subaddressing,
pravilo `racuni@` → ovaj Worker). Zato je `main` u `wrangler.jsonc`
`src/worker.ts` (Astro `handle` + `email()`), ne adapterov ulaz.
`src/lib/mail.ts` parsira PDF prilog (`src/lib/hep-racun.ts`, unpdf; prijepis
`~/git/stepanic/rezije/scripts/parse-hep-racune.py`) i sprema snimak
`hep-racun`; svaki mail ide u tablicu `mailovi`. PDF ni mail se ne čuvaju (OIB).
Lokalni test: `wrangler dev`, pa
`curl -X POST "localhost:8787/cdn-cgi/handler/email?from=a@b.hr&to=racuni%2B<ključ>@omm.domovina.ai" --data-binary @racun.eml`.

**Usporedba sa zadnjim stanjem** (`src/lib/usporedba.ts`): zadnje stanje je
najnovije od (a) zadnjeg očitanja u zadnjem uvozu s Moje mreže (`hep`, `mjesta[]`)
odnosno Mojeg računa HEP Elektre (`hep-moj-racun`, `kupci[]`), bez procjena ODS-a, i (b) našeg očitanja koje je HEP
prihvatio (`hep_dostava.Status = 1`). Za svaki pročitani registar probaju se
položaji decimalnog zareza (×10^k) i, ako oznaka tarife nije vidljiva, obje
tarife; bira se vrijednost odmah iznad zadnjeg stanja (najviše 150 kWh/dan).
Primjer 2026-10-12, AM550: zaslon 0009062.6, model 906.25, usporedba 9062.5.
`/api/ocitaj` prima opcionalno `omm` i vraća `zadnje`, `usporedba`, `upozorenja`.

`t1`/`t2` su cijeli kWh (decimale se odbacuju). `neodredeno` je vrijednost bez
sigurne oznake tarife; klijent je stavlja u prvo prazno polje (prva slika 1.8.1,
druga 1.8.2) i upozori.
