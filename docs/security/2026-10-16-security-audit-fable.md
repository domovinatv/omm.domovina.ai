# Sigurnosni audit omm.domovina.ai — 2026-10-16

- **Datum:** 2026-10-16
- **Autor:** Claude Fable 5.1 (read-only pregled koda; ništa nije pokretano protiv produkcije)
- **Pregledan commit:** `e08cc5482d15bdc04e1633850b0cc6b0abab3377` (`origin/main`, „chore(oznaka): obnovljen hep-uvoz.js …“)
- **Čitatelj:** Claude Opus 5.5, kao ulaz za popravke. Svaki nalaz ima `putanja:linija` u ovom commitu.

## Opseg

Pregledano: cijeli `src/` (API rute, middleware, admin, izvještaj, mail, OCR), `public/hep-uvoz.js`
(bookmarklet), `migrations/`, `wrangler.jsonc`, `public/_headers`, `package.json` + `npm audit --omit=dev`
(lokalno, nad `package-lock.json`), git povijest (31 commit) grepom za tajne, te način na koji
Astro 7.3.8 dekodira putanju prije middlewarea (`node_modules/astro/dist/core/fetch/fetch-state.js`,
`dist/core/util/pathname.js`).

Nije pregledano: izvor bookmarkleta u `flutter_moja_mreza` (ovdje je samo generirani artefakt),
Flutter aplikacija (kako generira ključ), konfiguracija Cloudflare računa (Access aplikacija,
Email Routing, WAF, rate limiting, `workers.dev` ruta), produkcijski podaci. Ništa nije testirano
uživo: svi koraci „kako provjeriti“ su za Opusa.

## Sažetak

Ukupna ocjena: **srednje rizično, prikladno za pilot, nije spremno za širu javnu upotrebu bez popravaka.**
Osnove su dobre: svi D1 upiti su parametrizirani, svaki korisnički upit filtrira po ključu uređaja
(nema IDOR-a u klasičnom smislu), admin je solidno zaštićen (Access JWT se provjerava na serveru,
passkey s UV, `__Host-` kolačić s hashom u bazi, CSRF preko `Origin`, CSP s nonceom), izvještaj
escapea sve stringove, PDF računa i mail se ne čuvaju. Slabe točke nisu u kriptografiji ni u
upitima nego u modelu: **ključ uređaja je jedina vjerodajnica, putuje kroz URL-ove, ne registrira
se, ne može se rotirati ni obrisati**, a sve što ključ štiti su podaci iz HEP-a (ime, adresa, OMM,
računi, uplate, saldo, GPS).

Tri najvažnija nalaza:

1. **SEC-01 (Visoko) – fiksacija ključa preko `/?k=`**: poveznica `https://omm.domovina.ai/?k=<napadačev ključ>`
   tiho zamijeni ključ u pregledniku žrtve; svaka oznaka napravljena nakon toga nosi napadačev ključ
   i svi uvozi s HEP-a odlaze njemu.
2. **SEC-02 (Visoko) – nema ograničenja brzine ni troška**: bilo tko s nasumičnim 22-znakovnim nizom
   može neograničeno trošiti Workers AI (bira i model), Browser Rendering, R2 i D1.
3. **SEC-03 (Visoko) – GDPR: nema brisanja, sirovi dnevnik duplicira osobne podatke, slike ostaju
   u R2 zauvijek**: `DELETE /api/snimak/:id` ne dira `dogadaji` (koji sadrži cijeli uvoz), ne postoji
   brisanje po ključu, slike iz `/api/ocitaj` koje nisu ušle u snimak nitko ne briše, nema politike
   privatnosti ni roka čuvanja.

Nalaza: Kritično 0, Visoko 3, Srednje 4, Nisko 5, Info 4.

## Model prijetnji ukratko

**Imovina.** Podaci kupaca HEP-a po ključu uređaja: ime i adresa (`kupci[].ime`, `adresa`,
`korisnik`), OMM, broj brojila, ugovorni račun, šifra kupca, očitanja i potrošnja, računi i uplate
s pozivom na broj, saldo/dug, GPS lokacija očitanja (`snimci.lat/lon`), slike brojila u R2,
User-Agent i država u `dogadaji`. Admin sesije i passkeyi. Sredstva na Cloudflare računu
(Workers AI, Browser Rendering). Integritet `hep-uvoz.js`, koji se izvršava u prijavljenoj
HEP sesiji korisnika.

**Napadači.** (a) Anonimni s interneta: API je otvoren svakome tko pošalje bilo koji
`Authorization: Bearer <22–64 base64url znaka>` (`src/lib/http.ts:24-27`); cilj su trošak i
spam. (b) Netko tko dozna tuđi ključ (iz oznake, sync-a preglednika, logova, skripte na HEP-ovoj
stranici): čita i piše sve pod tim ključem, uključujući slanje lažnih računa mailom. (c) Phisher
koji šalje `/?k=` poveznicu (SEC-01). (d) Tko kompromitira Cloudflare/GitHub račun ili DNS
omm.domovina.ai: kontrolira `hep-uvoz.js`, dakle i korisnikovu HEP sesiju. (e) Zlonamjeran
korisnik koji u uvoz upiše tuđi OMM da zagadi admin pregled.

**Ulazne točke.** `POST/GET /api/snimak`, `PATCH/DELETE /api/snimak/:id`, `POST /api/ocitaj`
(multipart slika), `GET /api/slika/<ključ>/<uuid>`, `GET/POST /api/racun` (PDF), `GET /api/mail`,
`GET /api/izvjestaj[/:omm]` (Browser Rendering), e-mail na `racuni+<ključ>@omm.domovina.ai`
(`src/worker.ts:7` → `src/lib/mail.ts:42`), `/?k=` i `/?primi=1` (postMessage), `/admin/*`,
`/hep-uvoz.js?k=` učitan u HEP-ovu stranicu.

---

## Nalazi

### Visoko

#### SEC-01 — Fiksacija ključa uređaja preko `/?k=` (phishing poveznicom)

- `src/lib/kljuc-klijent.ts:8-16` — `?k=` iz adrese bezuvjetno prepiše `localStorage["omm-kljuc"]`
  i makne se iz URL-a; nema potvrde, nema prikaza da je ključ promijenjen.
- `src/pages/index.astro:253` — oznaka se gradi s trenutnim ključem `k`:
  `s.src='${location.origin}/hep-uvoz.js?k=${k}&v='…`.
- `public/hep-uvoz.js:551,823-828` — bookmarklet šalje uvoz s ključem iz vlastitog URL-a.

**Scenarij.** Napadač generira ključ A i pošalje žrtvi
`https://omm.domovina.ai/?k=A` („evo besplatan izvještaj potrošnje“). Stranica je legitimna, pa
žrtva slijedi upute: povuče oznaku (koja sad nosi A) u traku, prijavi se na HEP i klikne
„Pošalji“. Svi uvozi (ime, adresa, OMM, računi, uplate, saldo), PDF-ovi računa s Hepija i
izvještaji su pod ključem A, koji napadač čita s `GET /api/snimak`, `/api/izvjestaj/:omm` itd.
Žrtva ne primijeti ništa: „Moji uvozi“ joj uredno prikazuju podatke (jer i ona ima A).
Dodatno, tko već ima oznaku sa svojim ključem B, nakon klika oznake na naslovnici biva prebačen
natrag na B (`index.astro:307`), ali uvozi s HEP-a i dalje idu na ključ koji je u oznaci, pa je
napad siguran za sve nove korisnike (većina).

**Utjecaj.** Potpuno otkrivanje HEP podataka korisnika napadaču, bez ijednog upozorenja.

**Popravak.**
1. `?k=` prihvaćati samo uz izričitu potvrdu kad u `localStorage` već postoji drugi ključ
   („Ova poveznica mijenja ključ ovog preglednika. Dosadašnji uvozi više neće biti vidljivi. Nastavi?“),
   a kad ključa nema, prikazati jasnu traku „Ključ je preuzet iz poveznice“ s gumbom „Napravi novi“.
2. Oznaku ne graditi od ključa koji je stigao iz `?k=` u istoj sesiji: tek nakon potvrde iz točke 1.
3. Dugoročno (plan iz `flutter_moja_mreza/docs/2026-10-12-…-plan.md`): prijava ili barem
   „uparivanje“ ključa (server izdaje ključ, klijent ga ne može birati) i prikaz skraćenog
   ključa u sučelju da korisnik vidi koji je aktivan.

**Provjera.** U svježem profilu otvoriti `/?k=<22 znaka>`: mora se pojaviti potvrda/traka, a
`localStorage.getItem("omm-kljuc")` ne smije biti taj ključ bez klika. Napraviti oznaku i
provjeriti da `href` ne sadrži ključ iz poveznice.

#### SEC-02 — Nema ograničenja brzine ni troška: Workers AI, Browser Rendering, R2 i D1 otvoreni svakome

- `src/lib/http.ts:24-27` — bilo koji niz od 22–64 base64url znaka je valjan „račun“; ništa se ne
  registrira ni ne provjerava.
- `src/pages/api/ocitaj.ts:29,38-39,43-45` — do 8 MB po slici, slika se **prvo** sprema u R2, pa
  tek onda OCR; pozivatelj sam bira model (`model` polje, regex `^@cf\/[\w.\/-]+$`), dakle i najskuplji.
- `src/pages/api/izvjestaj/[omm].ts:23-29` + `src/lib/izvjestaj/odgovor.ts:23-31` — svaki GET
  pokreće `puppeteer.launch(env.BROWSER)` (~4 s po dokumentaciji); nema predmemorije ni limita.
- `src/pages/api/racun.ts:8,29-31` i `src/lib/mail.ts:45,56-61` — do 10 MB PDF-a parsira unpdf
  (pdf.js) na CPU-u Workera; `wrangler.jsonc` nema `limits.cpu_ms`.
- `src/pages/api/snimak/index.ts:56,113` — `uvoz`, `ocr`, `hep_dostava` su neograničen JSON koji
  se sprema cijeli, a `dogadaji.tijelo` ga sprema još jednom (`:89,120,123`).
- `wrangler.jsonc` — nema `ratelimits` bindinga, `limits`, ni spomena WAF/Rate Limiting pravila.

**Scenarij.** Skripta s nasumičnim ključem šalje u petlji `POST /api/ocitaj` s 8 MB slikom i
`model=@cf/<najskuplji vision model>`: svaki poziv trajno zauzme 8 MB R2 (slika se ne briše, v.
SEC-03) i naplati inference. Ili: upload jednog uvoza, pa petlja `GET /api/izvjestaj/<omm>` drži
Browser Rendering sesije (račun ima ograničen broj istovremenih preglednika → legitimni
korisnici dobiju greške). Ili: `POST /api/snimak` s 1 MB `uvoz` u petlji → D1 raste dvostruko.

**Utjecaj.** Neograničen trošak na D.O.M. računu, iscrpljivanje Browser Rendering kvote (DoS
izvještaja), rast D1/R2 bez čišćenja.

**Popravak.**
1. Rate limiting na rubu: Cloudflare WAF Rate Limiting pravilo za `omm.domovina.ai/api/*` po
   IP-u (npr. 60/min) i stroži za `/api/ocitaj` i `/api/izvjestaj/*` (npr. 10/min), ili Workers
   `ratelimits` binding s ključem `uredaj` + IP (`wrangler.jsonc` → `"ratelimits": [{ "name": "API", "namespace_id": "…", "simple": { "limit": 10, "period": 60 } }]`).
2. `ocitaj.ts`: maknuti izbor modela iz javnog API-ja (ili dopustiti samo popis iz koda);
   smanjiti limit na 2–3 MB (klijent ionako šalje ≤1600 px JPEG, `ocitaj.astro:692-700`);
   spremati sliku u R2 tek kad OCR uspije ili je staviti pod TTL (v. SEC-03).
3. `izvjestaj`: predmemorirati PDF po `(ključ, omm, anonimno, hash snimaka)` u R2/KV ili barem
   dopustiti jedan istovremeni PDF po ključu; `oblik=html` nema taj trošak.
4. `snimak/index.ts`: odbiti tijelo veće od npr. 512 kB (`request.headers.get("content-length")` i/ili
   duljina JSON-a) i `ocr` veći od npr. 32 kB.
5. `wrangler.jsonc`: `"limits": { "cpu_ms": 10000 }` (ili manje) da PDF parsiranje ne može
   trajati 30 s.

**Provjera.** `for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAA" -F "slika=@test.jpg" https://omm.domovina.ai/api/ocitaj; done`
mora nakon limita vraćati 429. `curl -F model=@cf/… ` mora biti ignoriran ili odbijen.

#### SEC-03 — GDPR: nema brisanja po ključu, sirovi dnevnik i R2 čuvaju osobne podatke zauvijek, nema politike privatnosti

- `src/lib/dnevnik.ts:20-35` + `src/pages/api/snimak/index.ts:89,120,123` — za svaki `snimak`
  događaj u `dogadaji.tijelo` ide **cijelo tijelo zahtjeva** uključujući `uvoz` (ime, adresa,
  ugovorni račun, promet s pozivima na broj, saldo). Isto za `dostava` (`[id].ts:18-24`) i
  `ocitaj` (`ocitaj.ts:70-75`, s `zadnje`/`usporedba`).
- `src/pages/api/snimak/[id].ts:29-41` — DELETE briše samo `snimci` i R2 slike snimka;
  `dogadaji` i `mailovi` ostaju. Ne postoji brisanje svih podataka ključa ni brisanje u sučelju
  (`index.astro`, `ocitaj.astro` nemaju gumb za brisanje).
- `src/pages/api/ocitaj.ts:38-39` — slika se sprema u R2 prije OCR-a; ako korisnik ne spremi
  snimak (ili OCR padne, `:89-91`), slika ostaje u R2 bez ikakve reference → nitko je nikad ne briše.
- `migrations/0003_dogadaji.sql`, `0004_mailovi.sql` — nema roka čuvanja; `docs/admin.md:55`
  spominje samo brisanje isteklih sesija.
- `src/components/Podnozje.astro:21-29` — poveznice: „Kako čitamo podatke“, kontakt; nema politike
  privatnosti, voditelja obrade, roka čuvanja ni načina brisanja. `index.astro:217` obećava samo
  „skripta nestane kad zatvoriš stranicu“.
- GPS: `ocitaj.astro:828-831` → `snimci.lat/lon/tocnost_m`; admin ga ne prikazuje, ali se čuva.

**Scenarij.** Korisnik traži brisanje („pravo na zaborav“): operater nema ni alat ni popis gdje
su mu podaci (`snimci`, `dogadaji.tijelo`, `mailovi`, R2 `<ključ>/*`, uključujući siročad).
Ili: netko dobije pristup D1 izvozu — `dogadaji` sadrži povijest svih uvoza čak i obrisanih.

**Utjecaj.** Pravni rizik (GDPR čl. 5(1)(c),(e), 13, 17), povećana površina curenja (dvije
kopije svakog uvoza + trajne slike).

**Popravak.**
1. `dnevnik.ts`: za `snimak` ne spremati `b` nego sažetak (`izvor`, `omm`, broj mjesta/kupaca,
   veličina u bajtovima, `otisak`); za `ocitaj` samo `slika`, `model`, `registri`; dnevnik je
   za otkrivanje duplikata, ne za podatke.
2. Novi `DELETE /api/snimak` (bez id) ili `DELETE /api/kljuc`: briše `snimci`, `dogadaji`,
   `mailovi` po `uredaj`, `env.SLIKE.list({ prefix: ključ + "/" })` + delete, i gumb „Obriši sve
   moje podatke“ na `/`. Postojeći `DELETE /api/snimak/:id` neka obriše i `dogadaji WHERE snimak_id = ?`.
3. R2: lifecycle pravilo (dashboard ili `wrangler r2 bucket lifecycle add omm-domovina-ai-slike --expire-days 30`)
   za siročad, ili spremati sliku s prefiksom `tmp/` i preseliti u `<ključ>/` tek u `POST /api/snimak`
   (gdje se `slike[]` već provjerava, `snimak/index.ts:63`).
4. Cron (`triggers.crons` + `scheduled` handler u `worker.ts`) koji briše `dogadaji` starije od
   npr. 90 dana i `mailovi` starije od 180.
5. `Podnozje.astro`: poveznica na politiku privatnosti (tko je voditelj, što se čuva, koliko,
   kako se briše, kontakt), i napomena da uvoz sadrži ime i adresu.

**Provjera.** Nakon brisanja ključa: `SELECT COUNT(*) FROM dogadaji WHERE uredaj = ?`,
`… FROM mailovi …`, `wrangler r2 object list omm-domovina-ai-slike --prefix <ključ>/` → sve 0.
`SELECT length(tijelo) FROM dogadaji WHERE vrsta='snimak' ORDER BY id DESC LIMIT 5` → mali brojevi.

### Srednje

#### SEC-04 — Ključ uređaja putuje kroz URL-ove: logovi, povijest, HEP-ova stranica, sync oznaka

- `src/pages/index.astro:253` — oznaka: `…/hep-uvoz.js?k=${k}&v=…`. Ključ je u URL-u skripte
  koja se učitava **unutar HEP-ove stranice**: svaki drugi skript na toj stranici (HEP-ov,
  analitika, kompromitirana treća strana) vidi ga kroz `document.scripts[i].src` i
  `performance.getEntriesByType("resource")` (isti mehanizam koji sam bookmarklet koristi,
  `hep-uvoz.js:324`).
- `public/hep-uvoz.js:885` — `window.open(`${SERVER}/?k=…`)` → ključ u povijesti preglednika
  (do `replaceState`), u `Referer`-u prema vlastitom originu i u zahtjevu koji Cloudflare bilježi.
- `src/pages/uvoz.astro:3` — `/uvoz?k=…` → 301 na `/?k=…`; 301 se trajno kešira s ključem u `Location`.
- `wrangler.jsonc:42` — `observability.enabled: true`: Workers Logs bilježe URL zahtjeva
  (uključujući `?k=`) u metapodacima poziva.
- Oznaka (`javascript:` URL s ključem) se sinkronizira s Google/Apple/Microsoft računom
  preglednika; to je trajna kopija tajne izvan korisnikova uređaja.

**Scenarij.** Treća strana s pravom na čitanje Cloudflare logova (ili bilo koji skript na
mojracun.hep.hr) pokupi ključeve i čita `GET /api/snimak` za svakoga.

**Utjecaj.** Otkrivanje ključa → svi podaci pod njim (v. model prijetnji).

**Popravak.**
1. Ključ prenositi u **fragmentu**: `hep-uvoz.js?v=<ts>#k=<ključ>`; fragment se ne šalje serveru ni u
   logove, a `document.currentScript.src` ga sadrži pa `hep-uvoz.js:548-551` samo zamijeni
   `searchParams.get('k')` s `new URL(src).hash` parsiranjem. (Skripta na HEP-ovoj stranici i
   dalje ga može pročitati iz `script.src`: to ostaje inherentno dok god je ključ u oznaci.)
2. Isto za `/?k=` → `/#k=` (`kljuc-klijent.ts` čita `location.hash`); `uvoz.astro` prosljeđuje hash
   nije moguće server-side, ali stara adresa može jednostavno vratiti stranicu koja na klijentu
   prepiše hash.
3. Kratkoročno: u Workers Logs isključiti bilježenje URL-a ili maskirati (`observability.logs.invocation_logs: false`),
   te `Referrer-Policy: no-referrer` na `/` i `/ocitaj` (v. SEC-06).

**Provjera.** `grep -c '?k=' public/hep-uvoz.js src/pages/index.astro src/lib/kljuc-klijent.ts` → 0;
u Workers Logs (dashboard) nijedan `request.url` ne sadrži 22+ base64url znakova iza `k=`.

#### SEC-05 — Ključ se ne registrira, ne može rotirati ni opozvati; server prihvaća bilo koji niz (i mailom)

- `src/lib/http.ts:24-27` — regex, bez provjere postojanja.
- `src/lib/kljuc-klijent.ts:19-20` — web generira 18 nasumičnih bajtova (144 bita, dobro), ali
  server prihvaća i `AAAAAAAAAAAAAAAAAAAAAA`; drugi klijenti (Flutter, extension) nisu ovdje
  pregledani, pa snaga ključa ovisi o svakom klijentu zasebno.
- `src/lib/mail.ts:18-21,42-47` — `racuni+<bilo koji 22–64 niz>@` se prihvaća, PDF se parsira i
  upisuje u `mailovi`/`snimci` pod nepostojeći ključ; jedina obrana od spama je `rawSize ≤ 10 MB`.
- Nema rute za zamjenu ključa (prenos snimaka na novi ključ) ni za opoziv; ako ključ procuri
  (SEC-01, SEC-04), korisnik može samo napraviti novi i izgubiti povijest, a stari ostaje čitljiv.

**Utjecaj.** (a) Spam/trošak: redci za nepostojeće ključeve (API i mail). (b) Curenje ključa je trajno.
(c) Slabi ključ iz nekog klijenta = pogodiv račun.

**Popravak.**
1. Tablica `kljucevi (kljuc PK, stvoren, zadnji_put, ...)`; `POST /api/kljuc` (ili prvi `POST /api/snimak`)
   registrira; `GET/PATCH/DELETE` i mail prihvaćaju samo registrirane; nasumičnost na serveru:
   `POST /api/kljuc` vraća ključ koji je server generirao (klijent ga ne bira).
2. `POST /api/kljuc/rotiraj` (Bearer stari → novi, `UPDATE snimci/dogadaji/mailovi SET uredaj = ?`,
   R2 objekte prepisati ili čuvati mapiranje), gumb „Novi ključ“ na `/` koji zatim traži da se oznaka
   ponovno povuče.
3. Mail: uz registraciju ključa, odbiti (`setReject`) mail za nepoznat ključ prije parsiranja.

**Provjera.** `curl -H "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAA" https://omm.domovina.ai/api/snimak` → 401/403, ne `[]`.

#### SEC-06 — Javne stranice nemaju CSP ni sigurnosna zaglavlja; ključ je u `localStorage`, a stranice koriste `innerHTML`

- `src/middleware.ts:22` — middleware se vraća prije zaglavlja za sve što nije `/admin`;
  `:47-66` postavlja CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options` samo za admin.
- `public/_headers` — samo `Cache-Control`; k tome, `_headers` u Workers Assets vrijedi samo za
  statičke datoteke, ne za SSR odgovore `/` i `/ocitaj`.
- `src/pages/ocitaj.astro:771,936,938` — `innerHTML` s podacima iz API-ja (`d.zadnje.datum`,
  `d.zadnje.t1/t2`, `s.t1/t2`). `zadnje.datum` dolazi iz korisnikova `uvoz` JSON-a
  (`src/lib/usporedba.ts:43-44`), koji server ne validira (`snimak/index.ts:113` sprema
  `JSON.stringify(b.uvoz)` kako je stiglo). Danas je to self-XSS (samo vlasnik ključa može upisati
  zlonamjeran `datum`), ali uz SEC-01/SEC-05 napadač može upisati pod tuđi ključ.
- `index.astro:267` — `innerHTML` samo sa statičnim stringom; u redu.
- `src/lib/kljuc-klijent.ts:11,21` — ključ u `localStorage`: svaki XSS na originu = krađa ključa.

**Utjecaj.** Bez CSP-a svaka buduća XSS greška (i ova u `ocitaj.astro`) daje ključ i sve podatke.

**Popravak.**
1. Proširiti `middleware.ts` da za **sve** HTML odgovore (ne samo `/admin`) postavi
   `Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (javne stranice nemaju
   form POST, pa prigovor iz `middleware.ts:61` ne vrijedi), `X-Frame-Options: DENY`.
   Napomena: `ocitaj.astro` koristi `URL.createObjectURL` za `img.src` → `img-src blob:`; inline
   `<script is:inline>` u `Tema.astro` već dobiva nonce kroz postojeći regex.
2. `ocitaj.astro:771,936,938` → `textContent`/`replaceChildren` kao u ostatku datoteke.
3. `snimak/index.ts`: validirati oblik `uvoz` (bar `mjesta[]/kupci[]` s `omm` `^\d{10}$`,
   `ocitanja[].datum` `^\d{4}-\d{2}-\d{2}$`, `t1_kwh/t2_kwh` brojevi) umjesto spremanja proizvoljnog JSON-a.

**Provjera.** `curl -sI https://omm.domovina.ai/ | grep -i -E "content-security|referrer|x-content"` → sva tri prisutna.
`grep -n innerHTML src/pages/*.astro` → samo statični stringovi.

#### SEC-07 — Korisnik može prisvojiti bilo koji OMM u admin pregledu i izvještaju „iz svih uvoza“

- `src/lib/admin/pregled.ts:22-30` — OMM, adresa i ime za admin tablicu vade se `json_extract`-om iz
  korisnikova `uvoz` JSON-a; `:76` — `instr(uvoz, ?1) > 0` bira snimke za izvještaj po **tekstu** OMM-a
  bilo gdje u JSON-u.
- `src/pages/admin/izvjestaj/[omm].ts:19` — izvještaj se računa iz snimaka **svih** ključeva.
- `src/pages/admin/index.astro:27-48` — adresa/ime iz **najnovijeg** uvoza bilo kojeg ključa.

**Scenarij.** Napadač zna OMM žrtve (piše na svakom računu) i pošalje `POST /api/snimak` s
`izvor: "hep"`, `uvoz: { mjesta: [{ omm: "<žrtvin>", adresa: "…", korisnik: "…", ocitanja: [...] }] }`.
U adminu se za taj OMM prikazuje napadačeva adresa i ime (jer je najnoviji), a „Izvještaj iz svih
uvoza“ (koji služi za ponudu za sunčanu elektranu) spaja izmišljena očitanja sa stvarnima.
Druga strana istog nalaza: napadač s `instr` pogotkom (OMM upisan u bilo koji string) vidi se u
tuđem OMM-u.

**Utjecaj.** Integritet podataka za ponude; mogućnost da admin kontaktira krivu osobu na krivoj
adresi. Nema XSS-a (Astro escapea `{o.adresa}`, `{o.ime}`, `data-trazi`), samo integritet.

**Popravak.**
1. U adminu označiti iz **koliko različitih ključeva** dolaze podaci za OMM i zadano raditi
   izvještaj po ključu (`?kljuc=`), ne spojeno; spojeni izvještaj samo uz izričit klik i upozorenje.
2. `snimciOmm`: umjesto `instr(uvoz, ?1)` koristiti `json_each` nad `mjesta`/`kupci` s
   `json_extract(value, '$.omm') = ?1` (isti obrazac kao `pregledOmm`).
3. Dugoročno: uparivanje ključa s identitetom (prijava), pa je prisvajanje OMM-a vidljivo.

**Provjera.** Upisati gornji snimak s test ključem i otvoriti `/admin/omm/<omm>`: mora biti
vidljivo da su dva ključa i koji je koji; `?kljuc=` izvještaj ne smije sadržavati tuđa očitanja.

### Nisko

#### SEC-08 — Admin stranice i rute oslanjaju se isključivo na middleware (obrana u dubini za `/%61dmin/`)

- `src/middleware.ts:16,22` — `jeAdmin(url.pathname)`; `src/pages/admin/index.astro:5`,
  `src/pages/admin/omm/[omm].astro:6`, `src/pages/admin/izvjestaj/[omm].ts:11-25` nemaju vlastitu
  provjeru `Astro.locals.admin`; `passkeys.astro:6` i `passkey/register/*.ts:5-6` koriste `locals.admin!`
  (bez middlewarea bi bacili TypeError → 500, ne curenje).
- **Provjereno u kodu Astra 7.3.8** (`node_modules/astro/dist/core/fetch/fetch-state.js:234-239` →
  `#normalizePathname` → `validateAndDecodePathname` u `dist/core/util/pathname.js`): `url.pathname`
  koji middleware vidi je višestruko dekodiran i s uklonjenim dvostrukim kosim crtama, a prekomjerno
  kodiranje daje 400. Dakle `/%61dmin/`, `/%2561dmin/` i `//admin` **danas ne zaobilaze**
  middleware. `%2F` se ne dekodira (`decodeURI`), pa `/admin%2Fizvjestaj%2F…` ne pogađa nijednu rutu (404).
- Zaštita ovisi o verziji frameworka (`package.json`: `"astro": "^7.3.8"`), ne o kodu projekta.

**Popravak.** U `AdminOkvir.astro` (frontmatter) i u `admin/izvjestaj/[omm].ts` dodati
`if (!Astro.locals.admin) return new Response(null, { status: 401 })` (odnosno `locals.admin` u
API ruti); u `middleware.ts` usporediti i `decodeURIComponent(url.pathname)` radi neovisnosti o
Astru. Dodati test: `curl -sI https://omm.domovina.ai/%61dmin/izvjestaj/0000000000` → 302 na login
ili 401, nikad 200/400 iz rute.

#### SEC-09 — Gmailova potvrda: `/google\.com$/` prihvaća `attacker-google.com`; pohranjena poveznica je phishing vektor ako se ponovno prikaže

- `src/lib/mail.ts:52` — `/google\.com$/i.test(od)` nad `mail.from.address` (zaglavlje `From`,
  pod kontrolom pošiljatelja); `evil@notgoogle.com` prolazi. Kod ne gleda `Authentication-Results`
  (SPF/DKIM/DMARC) koje Email Routing dodaje.
- `:26,53` — `poveznica` (bilo koji `https://mail…google.com/mail/…vf-…` URL iz teksta) sprema se u
  `mailovi.poruka` i vraća preko `GET /api/mail` (`src/pages/api/mail.ts:9-15`). Trenutno je
  nijedna stranica ne prikazuje (`grep api/mail src/` → nema), pa je rizik uspavan.

**Popravak.** Regex `/(^|[.@])google\.com$/i`; uz to provjeriti `Authentication-Results`
(`poruka.headers.get("authentication-results")` sadrži `dmarc=pass`) prije nego se mail tretira
kao Googleov; kad se `/api/mail` ponovno prikaže, `poveznica` renderirati kao tekst ili barem s
`rel="noopener noreferrer"` i provjerom hosta na klijentu.

#### SEC-10 — Bookmarklet: integritet ovisi isključivo o omm.domovina.ai; nema procesa pregleda generirane datoteke

- `src/pages/index.astro:253` — oznaka učitava `/hep-uvoz.js?…&v=Date.now()` svaki put svježe;
  SRI nije moguć, nema verzioniranja.
- `public/hep-uvoz.js:1-2` — „Generirano … Ne mijenjati ovdje“; datoteka se u ovaj repo donosi
  kao binarni artefakt (42 kB), pa diff u PR-u nitko ne čita.
- Što skripta radi na HEP-u (provjereno): same-origin `fetch` s `credentials: 'same-origin'`
  (`:133-136, :311, :471-475`), Hepi token samo u `Authorization` prema `/hepi/api/` (`:461-475`),
  prema omm.domovina.ai `credentials: 'omit'` (`:827, :853, :863`), ništa se ne mijenja na portalu.
  Dakle, današnja verzija je u redu; rizik je u **budućoj** zamjeni (kompromis Cloudflare/GitHub
  računa, DNS-a, ili greška u generatoru).

**Popravak.** (1) U `flutter_moja_mreza` generator neka upiše SHA-256 u zaglavlje datoteke i u
`docs/`; ovdje CI korak koji odbija commit ako se hash u zaglavlju ne slaže sa sadržajem.
(2) 2FA/hardverski ključ na Cloudflare i GitHub računima koji mogu deployati; `wrangler deploy`
samo iz CI-ja. (3) Razmotriti verzionirane URL-ove (`/hep-uvoz-<hash>.js`) umjesto `?v=Date.now()`,
tako da se promjena vidi u oznaci.

#### SEC-11 — `/api/snimak` POST ne validira `uvoz`, a `GET /api/izvjestaj/:omm` koristi `url.origin` za fontove

- `src/pages/api/snimak/index.ts:67-70` — za uvozne izvore provjerava se samo da `uvoz` postoji
  i da `kupci` bude niz; sve ostalo (`mjesta[].omm`, datumi, brojevi) se vjeruje klijentu.
  Posljedice: SEC-06 (XSS sink), SEC-07 (prisvajanje OMM-a), i mogući `JSON.parse` padovi u
  `usporedba.ts:39`, `izvjestaj/snimci.ts:23`, `pregled.ts:27` (`json_valid` štiti samo tu).
- `src/lib/izvjestaj/odgovor.ts:12,17` — `o.origin` (iz `url.origin` zahtjeva) ulazi u CSS `url(…)` i
  u `env.ASSETS.fetch`; na Cloudflareu je `url` izveden iz `Host`, pa je vrijednost ograničena
  na hostove koji dolaze do Workera (vidi „Za provjeru“ o `workers.dev`). Nije eksploatabilno,
  ali je nepotrebna ovisnost: fontovi se mogu dohvatiti relativno (`/fonts/…`) i uvijek ugraditi.

**Popravak.** Shema za `uvoz` (ručna validacija ili mali validator) s odbijanjem 400; u
`odgovor.ts` koristiti fiksni origin iz `astro.config.mjs` (`site`) ili uvijek `data:` URL.

#### SEC-12 — CORS `*` i `Allow-Methods` bez DELETE; `/api/slika` bez `nosniff`

- `src/lib/http.ts:3-7` — `Access-Control-Allow-Origin: *` je namjeran (bookmarklet šalje s HEP-ovog
  origina), a autentikacija je Bearer, ne kolačić, pa `*` ne otvara CSRF. `Allow-Methods` nema
  `DELETE`, pa `DELETE /api/snimak/:id` s drugog origina ne prolazi preflight (danas ga nitko
  vanjski ne zove). `/api/slika` (`[...kljuc].ts:13-15`) vraća sliku bez `X-Content-Type-Options`;
  tip je iz magic bajtova (`ocitaj.ts:13-18`), pa nema polyglot rizika.

**Popravak.** Dodati `DELETE` u `Allow-Methods` samo ako je potreban; `nosniff` na sve API odgovore
(u `json()` i u `/api/slika`).

### Info

#### SEC-13 — `npm audit --omit=dev`: 7 „high“, sve u lancu `@cloudflare/puppeteer@1.4.0` → `@puppeteer/browsers` → `extract-zip`, `basic-ftp`

Te ovisnosti služe za preuzimanje preglednika na razvojnom stroju i **ne izvršavaju se u Workeru**
(u produkciji se koristi `env.BROWSER` binding). Nije rizik za produkciju; pratiti nadogradnju
`@cloudflare/puppeteer`. Ostalo: `astro 7.3.8`, `@astrojs/cloudflare 14.3.4`, `@simplewebauthn/server 14.0.3`,
`jose 5.10.0`, `postal-mime 4.0.6`, `unpdf 1.8.1`, `qrcode-generator 2.0.4` — bez prijavljenih ranjivosti.

#### SEC-14 — Tajne i osobni podaci u repou

Grep povijesti (`git log -p --all`) nije našao API ključeve, tokene ni privatne ključeve.
`wrangler.jsonc:9,17,38` sadrži `account_id`, `database_id` i `ACCESS_AUD` (javni identifikatori,
nisu tajne). `wrangler.jsonc:34` sadrži dva admin e-maila (osobni podaci admina; prihvatljivo u
privatnom repou, premjestiti u `wrangler secret` ako repo ikad postane javan). `Podnozje.astro:61`
ima OIB tvrtke iz impresuma (javni podatak). `.dev.vars` je u `.gitignore`.

#### SEC-15 — Dnevnik i alarmi

`console.warn` za `access_login_rejected` (`sso.ts:12`) i `admin_passkey_added`
(`register/verify.ts:13`) idu samo u Workers Logs; `docs/admin.md:54` to već navodi kao otvoreno.
Nema alarma na nagli rast `dogadaji`/R2 (povezano sa SEC-02).

#### SEC-16 — `public/_headers` ne djeluje na SSR odgovore

`_headers` u Workers Assets vrijedi samo za statičke datoteke; `Cache-Control: no-cache` za `/` i
`/ocitaj` (`public/_headers:2-5`) se ne primjenjuje na odgovore Workera. Nije sigurnosni problem
(nema osjetljivog HTML-a koji bi se keširao), ali objašnjava zašto `middleware.ts:65` mora sam
postavljati `cache-control` za admin; isto bi trebalo za javne stranice ako se želi „bez predmemorije“.

---

## Za provjeru (sumnje koje nisam mogao potvrditi iz koda)

- **`workers.dev` ruta.** `wrangler.jsonc` nema `"workers_dev": false` ni `"preview_urls": false`.
  Ako je `omm-domovina-ai.<subdomena>.workers.dev` aktivna, API je dostupan i na drugom originu
  (admin se preusmjerava na `ADMIN_HOST`, `middleware.ts:25-29`, pa je on siguran). Provjeriti u
  dashboardu i dodati `"workers_dev": false`.
- **Workers Logs i `?k=`.** Pretpostavka u SEC-04 da invocation log bilježi puni URL s upitom:
  otvoriti Workers Logs za jedan poziv `/hep-uvoz.js?k=…` i vidjeti.
- **Email Routing i DMARC.** Ne znam odbija li Email Routing na računu mailove s `dmarc=fail`
  prije Workera; ako ne, SEC-09 je lakše iskoristiv. Provjeriti `Authentication-Results` zaglavlje
  u jednom primljenom mailu (`poruka.headers`).
- **Flutter/extension ključ.** `http.ts:24-27` prihvaća 22–64 znaka; provjeriti da svi klijenti
  generiraju ≥128 bita nasumičnosti (web: 144 bita, `kljuc-klijent.ts:19`).
- **Access aplikacija.** `docs/admin.md:20-32` opisuje da Access štiti samo `/admin/sso`; provjeriti
  u Zero Trustu da je politika vezana na iste e-mailove kao `ADMIN_EMAILS` i da nema „bypass“ pravila.
- **D1 veličina retka.** SEC-02 pretpostavlja da je jedini limit za `uvoz` D1-ov limit po stupcu
  (reda MB); provjeriti stvarne najveće `length(uvoz)` i `length(tijelo)` u produkciji:
  `SELECT MAX(length(uvoz)), AVG(length(uvoz)) FROM snimci; SELECT MAX(length(tijelo)) FROM dogadaji;`.
- **Browser Rendering kvota.** Koliko istovremenih sesija račun ima i hoće li `odgovor.ts:23` baciti
  grešku ili čekati; određuje koliko je DoS iz SEC-02 lak.

## Što je dobro napravljeno (ne razvaliti)

- Svi D1 upiti su parametrizirani (`.bind`), uključujući `IN (?,?,…)` u `pregled.ts:61-67`; nema
  ljepljenja stringova u SQL.
- Svaki korisnički upit filtrira po `uredaj = ?` (`snimak/index.ts:85,134`, `[id].ts:14,32,38`,
  `racun.ts:15`, `mail.ts:10-11`, `izvjestaj/snimci.ts:10-13`, `usporedba.ts:34,50`); `slike[]` u
  snimku mora počinjati ključem (`snimak/index.ts:63`); `/api/slika` traži točan oblik
  `<ključ>/<uuid>.(jpg|png)` (`[...kljuc].ts:10`).
- Slika: tip po magic bajtovima, 8 MB limit, samo JPEG/PNG/WebP (`ocitaj.ts:13-18,29-36`); PDF: 10 MB,
  potpis „HEP - Opskrba d.o.o.“ prije parsiranja (`hep-racun.ts:149`), PDF i mail se ne čuvaju, OIB se
  ne vadi (`hep-racun.ts:5`, `mail.ts:6-7`).
- Admin: Access JWT se provjerava na serveru (potpis, issuer, `aud`, RS256, `access.ts:20-24`) i
  e-mail protiv `ADMIN_EMAILS` pri **svakom** zahtjevu (`sesija.ts:81`); `__Host-` kolačić,
  HttpOnly/Secure/Lax (`sesija.ts:54`), u bazi samo SHA-256 tokena, 12 h + 2 h neaktivnosti; CSRF
  preko `Origin` za sve ne-GET (`middleware.ts:32-35`); CSP s nonceom, `frame-ancestors 'none'`,
  `noindex`, `no-store` (`middleware.ts:55-65`); passkey s `userVerification: required`,
  jednokratni izazovi s TTL-om, registracija samo uz prijavu < 10 min i najviše 5 ključeva
  (`passkey.ts:36,49,86,98-111`); `safeNext` bez open redirecta (`sesija.ts:121`).
- Astro 7.3.8 dekodira putanju prije middlewarea, pa `/%61dmin/` ne prolazi (SEC-08).
- HTML izvještaj escapea svaki string (`html.ts:11-12`, korišten na svim mjestima s korisničkim
  tekstom); anonimna verzija briše ime, brojilo, ugovorni račun i punu adresu (`izracun.ts:403-413,432-433`).
- Bookmarklet: prvo objasni što čita i šalje, šalje tek na drugi klik, `credentials: 'omit'` prema
  nama, Hepi token ne napušta stranicu, `postMessage` rezerva provjerava `origin` i `source`
  (`hep-uvoz.js:907`, `index.astro:409`); zatvoreni shadow DOM; sve korisničke vrijednosti idu kroz
  `textContent`.
- Deduplikacija po otisku sadržaja (`snimak/index.ts:76-83`, `UNIQUE (uredaj, otisak)`) sprječava
  nenamjerno gomilanje.
- Nema tajni u gitu; `.dev.vars` ignoriran.

## Zadaci za Opus 5.5 (po prioritetu)

Stanje 2026-10-17 (Opus 5.5): SEC-01 do SEC-06 popravljeni i commitani, **nisu deployani**
(`npm run db:migrate` za 0006 i 0007, pa `npm run deploy`; prije toga u pregledniku provjeriti
oznaku na naslovnici pod novim CSP-om). R2 lifecycle `tmp` je već na bucketu. Odstupanja:
ključ i dalje generira klijent (server samo pamti, rotacija daje serverski ključ); GET nepoznatim
ključem vraća prazno, ne 401 (oznaka zove GET /api/racun prije prvog upisa); WAF pravilo nije
dodano, koristi se `ratelimits` binding; stare slike-siročad u R2 nisu obrisane (wrangler nema
popis objekata). Kopija `dogadaji` prije 0006: `data/backup/2026-10-17-dogadaji.sql` (gitignored).
SEC-11 shema uvoza je napravljena (`src/lib/uvoz.ts`), fiksni origin u `odgovor.ts` nije.
SEC-12 `nosniff` je napravljen.

- [x] SEC-01 `kljuc-klijent.ts`/`index.astro`: `?k=` ne smije tiho zamijeniti postojeći ključ; potvrda + vidljiva traka; oznaka se gradi tek nakon potvrde.
- [x] SEC-02 Rate limiting (WAF pravilo ili `ratelimits` binding) na `/api/*`, stroži na `/api/ocitaj` i `/api/izvjestaj/*`; maknuti javni izbor `model`; limit slike 3 MB; `limits.cpu_ms`; limit veličine JSON tijela u `/api/snimak`.
- [x] SEC-03 `dnevnik.ts`: u `tijelo` samo sažetak, ne cijeli uvoz; `DELETE` po ključu (snimci + dogadaji + mailovi + R2 prefiks) i gumb „Obriši sve moje podatke“; `DELETE /api/snimak/:id` briše i `dogadaji`; R2 lifecycle ili `tmp/` prefiks za slike prije snimka; cron za stare `dogadaji`/`mailovi`; politika privatnosti u podnožju.
- [x] SEC-04 Ključ u fragment (`#k=`) u oznaci, `window.open` i `/`; `Referrer-Policy: no-referrer` na javnim stranicama; provjeriti/isključiti URL u Workers Logs.
- [x] SEC-05 Registracija ključeva na serveru (server generira), odbijanje nepoznatih (API i mail), rotacija ključa s prijenosom podataka.
- [x] SEC-06 CSP + `nosniff` + `Referrer-Policy` + `X-Frame-Options` za sve HTML odgovore u `middleware.ts`; `innerHTML` → `textContent` u `ocitaj.astro:771,936,938`; validacija oblika `uvoz`.
- [ ] SEC-07 Admin: izvještaj zadano po ključu, jasna oznaka kad više ključeva prisvaja isti OMM; `snimciOmm` preko `json_each` umjesto `instr`.
- [ ] SEC-08 `Astro.locals.admin` provjera u `AdminOkvir.astro` i `admin/izvjestaj/[omm].ts`; test `curl /%61dmin/…`.
- [ ] SEC-09 `mail.ts:52` regex `/(^|[.@])google\.com$/i` + provjera `Authentication-Results`.
- [ ] SEC-10 Hash `hep-uvoz.js` u zaglavlju + CI provjera; 2FA na Cloudflare/GitHub; verzionirani URL skripte.
- [ ] SEC-11 Shema za `uvoz`; fiksni origin za fontove u `odgovor.ts`.
- [ ] SEC-12 `nosniff` na API odgovore; `DELETE` u `Allow-Methods` samo ako treba.
- [ ] Za provjeru: `workers_dev: false`, Workers Logs i `?k=`, Email Routing DMARC, nasumičnost ključa u Flutter/extension klijentima, veličine `uvoz`/`tijelo` u produkciji.
