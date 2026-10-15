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

## Otvoreno

- Telegram/mail alarm kad se doda passkey (pay ga ima, ovdje je samo `console.warn`).
- Nema crona koji briše istekle sesije i izazove; brišu se pri sljedećoj prijavi/izazovu.
- „Korisnik“ je ključ uređaja; kad korisnici dobiju prijavu, pregled treba grupirati po računu.
