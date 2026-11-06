# Admin — Cloudflare Access (OTP) + passkey

`https://omm.domovina.ai/admin`. Model i kod preneseni su iz pay.domovina.ai
(`backend/src/admin/auth/*`, `docs/admin-auth.md` tamo); držati ih u skladu.

## Što ima

| Stranica | Što |
|---|---|
| `/admin` | pločice (OMM-ovi, korisnici, aktivni u 7 dana, uvozi), tablica OMM-ova s filtrom: adresa i kupac iz najnovijeg uvoza, korisnici (ključevi), izvori, broj uvoza i očitanja, izvještaj PDF/HTML/anonimno |
| `/admin/omm/:omm` | korisnici tog OMM-a (ključ, izvori, prvi/zadnji upis, uređaj i država iz `dogadaji`), izvještaj iz svih uvoza ili po korisniku |
| `/admin/izvjestaj/:omm` | isti izračun i izgled kao `/api/izvjestaj/:omm`, ali iz snimaka **svih** ključeva (ili `?kljuc=`); `?oblik=pdf\|html\|json`, `?anonimno=1` |
| `/admin/passkeys` | passkeyi prijavljenog admina |

„Korisnik“ je ključ uređaja (`snimci.uredaj`), jer korisnici nemaju prijavu. Podaci se
čitaju pri svakom zahtjevu (`src/lib/admin/pregled.ts`, `json_each` po `mjesta[]`/`kupci[]`).

## Prijava

- `/admin/sso` štiti Access aplikacija „OMM admin (sso)“ (One-time PIN na e-mail);
  Worker dodatno provjerava JWT (potpis, issuer, `ACCESS_AUD`) i `ADMIN_EMAILS`.
- Passkey se dodaje nakon ulaska preko Accessa (prijava mlađa od 10 min, najviše 5).
- Sesija: kolačić `__Host-omm_admin`, u D1 samo sha-256 (`admin_sessions`), 12 h,
  2 h neaktivnosti. CSRF: POST mora imati `Origin` jednak originu. CSP s nonceom.
  Sve u `src/middleware.ts` i `src/lib/admin/`.

## Konfiguracija

`wrangler.jsonc` → `vars`: `ADMIN_EMAILS`, `ADMIN_HOST`, `ACCESS_TEAM_DOMAIN`
(`domovina.cloudflareaccess.com`), `ACCESS_AUD`. Access aplikacija: self-hosted,
destinacija `omm.domovina.ai/admin/sso`, IdP One-time PIN, sesija 24 h, politika s istim
e-mailovima (kao „MPT admin (sso)“). Dok je `ACCESS_AUD` prazan, `/admin/sso` vraća 503.

**Oduzimanje pristupa:** makni e-mail iz `ADMIN_EMAILS` (odmah, i za postojeće sesije) i iz politike.

**Admini (2026-11-02):** stepanic.matija@gmail.com, ms@ff.hr, stepanic.ivan@gmail.com (dodan
2026-11-02, u oba mjesta). Politika „OMM admini“ je od tada reusable i dijeli je i aplikacija
„LogoMedo admin (sso)“: tko je u njoj, prolazi Access i na `logomedo.com/admin/sso`
(korisnik je to izričito prihvatio za Ivana); LogoMedo Worker ima svoj popis admina.

**Partneri (2026-11-06):** matej.galic988@gmail.com, solardei.elektrane@gmail.com. U `ADMIN_EMAILS`
i u posebnoj politici „OMM partneri“ (reusable, vezana **samo** uz „OMM admin (sso)“), ne u
„OMM admini“, da ne prolaze Access na LogoMedu. Oduzimanje: iz `ADMIN_EMAILS` i iz te politike.
Politike i aplikacija se mogu mijenjati iz konzole na dashboardu (`fetch('/api/v4/accounts/<račun>/access/…',
{headers:{'x-cross-site-security':'dash'}})`); wrangler OAuth nema Access scope.

## Lokalno

Access lokalno ne radi. Upiši sesiju u lokalni D1 (`admin_sessions`, `token_hash` =
sha-256 tokena) i pošalji kolačić `__Host-omm_admin=<token>`; `wrangler dev --local-upstream localhost`.
PDF lokalno visi (Browser Rendering), `?oblik=html` radi.

## Postavljanje (2026-10-15)

- Access aplikacija „OMM admin (sso)“ napravljena je u dashboardu (Zero Trust →
  Access controls → Applications, `dash.cloudflare.com/<račun>/one/access-controls/apps`;
  stari `one.dash.cloudflare.com/…/access/apps` vraća 404). Politika „OMM admini“ je
  vezana uz aplikaciju (nije reusable), IdP „Select all“ = samo One-time PIN, instant auth.
- Access sesija je po timu (`domovina.cloudflareaccess.com`): tko je već prijavljen u
  MPT ili pipeline admin, na `/admin/sso` uđe bez novog koda.
- Admin PDF na produkciji: ~330 kB, ~3,5 s (Browser Rendering), isto kao korisnički.

## Uživo (od 2026-11-03)

Pregled i detalj OMM-a osvježe se sami kad se baza promijeni: točka „uživo“ u zaglavlju je
zelena dok je WebSocket na `/admin/uzivo` otvoren. Durable Object `AdminUzivo` (jedan za sve
admine, hibernacijski WebSocketi, ping bez buđenja) prima `javiAdminu()` nakon svakog upisa
(`dogadaji` osim OCR-a i duplikata, `mailovi`, `prikljucci`, rotacija ključa) i svim vezama
pošalje samo vrstu događaja. Stranica zatim dohvati svoj HTML i zamijeni dijelove s
`data-uzivo` (bez njih cijeli `<main>`, zato passkeyi to nemaju); novi retci zasvijetle.
Ruta ide mimo Astra (`src/worker.ts`), pa sama provjerava host, `Origin` (CSWSH) i sesiju;
veza se zatvara (4001) pri prvom događaju nakon isteka sesije.

Provjera i zamke:

- `curl` na produkciji ide preko HTTP/2 i ne šalje `Upgrade`, pa dobiješ 426 kao da ruta ne
  radi. Treba `--http1.1` uz `Sec-WebSocket-Key`/`-Version`: bez sesije 401, tuđi `Origin` 403.
- Lokalno (`wrangler dev`): upiši sesiju u lokalni D1 (`admin_sessions.token_hash` = sha256
  tokena, `expires_at` u budućnosti), pa Nodeov globalni `WebSocket` prima
  `{ headers: { Origin, Cookie: "__Host-omm_admin=<token>" } }`. `POST /api/prikljucak`
  tada mora stići kao `{"vrsta":"prikljucak",…}`. Testiran tako 2026-11-03.
- Odmah nakon deploya jedan zahtjev je još dobio staru verziju (302 na prijavu).
- Cijeli tijek na produkciji (prava sesija + pravi mail) još nije gledan u pregledniku.

## Otvoreno

- Telegram/mail alarm kad se doda passkey (pay ga ima, ovdje je samo `console.warn`).
- Nema crona koji briše istekle sesije i izazove; brišu se pri sljedećoj prijavi/izazovu.
- „Korisnik“ je ključ uređaja; kad korisnici dobiju prijavu, pregled treba grupirati po računu.
