# Arhitektura: sve komponente i njihovi odnosi

Stanje 2026-11-03. Pregled cijelog sustava na jednom mjestu. Detalji pojedinih tokova su
u dokumentima iz „Vezani dokumenti” na kraju; ovdje je samo tko s kim razgovara, čime i zašto.

Dva pravila oblikuju sve ispod:

1. **Server nikad ne ulazi na HEP-ove portale** i ne vidi HEP-ove kolačiće. Podatke s
   Moje mreže, Mojeg računa i Hepija čita kod koji radi u korisnikovoj prijavljenoj
   kartici (ekstenzija, oznaka, aplikacija) i šalje ih na `omm.domovina.ai`.
   Jedina iznimka je javni cjenik HEP Elektre, za koji prijava ne treba.
2. **Nema korisničke prijave.** Klijent ima nasumični ključ uređaja i šalje ga kao
   `Authorization: Bearer <ključ>`. Prijavu ima samo admin (Cloudflare Access ili passkey).

## Komponente

| # | Komponenta | Gdje živi | Uloga |
|---|---|---|---|
| 1 | Preglednik: naslovnica `/`, `/ocitaj`, `/privatnost` | Astro SSR stranice, ključ u `localStorage` | korisnik dobije ključ, instalira ekstenziju ili oznaku, vidi snimke, preuzme izvještaj, šalje upit Elektri |
| 2 | Preglednik: `/admin` | Astro SSR + `uzivo-klijent.ts` | pregled svih OMM-ova, izvještaj za bilo koji ključ, osvježava se uživo |
| 3 | Chrome ekstenzija „HEP uvoz” | `flutter_moja_mreza/extension`, Web Store `eaepdcjo…` | glavni put uvoza (od 2026-10-30): popup ubaci parser u HEP-ovu karticu, service worker šalje na API |
| 4 | Oznaka (bookmarklet) „Uvezi iz HEP-a” | `/hep-uvoz.js` (generiran u `flutter_moja_mreza`) + iframe `/oznaka` | rezervni put za preglednike bez ekstenzije |
| 5 | Flutter aplikacija | `flutter_moja_mreza/example` | uvoz u WebViewu, fotografija brojila, dostava očitanja HEP-u |
| 6 | HEP Moja mreža (ODS) | `mojamreza.hep.hr` | OMM-ovi, očitanja, potrošnja; `POST /Omm/Dostava` za predaju očitanja |
| 7 | HEP Moj račun (Elektra) | `mojracun.hep.hr/elektra` | kupci, saldo, očitanja; javni cjenik |
| 8 | HEP Hepi (Opskrba) | `mojracun.hep.hr/hepi` | računi u PDF-u, očitanja |
| 9 | Cloudflare Worker `omm-domovina-ai` | `src/worker.ts` (Astro `handle` + `email` + `scheduled`) | sav HTTP, API, admin, webhook, cron |
| 10 | D1 `omm-domovina-ai` | `migrations/` | sve trajne tablice (vidi „Podaci”) |
| 11 | R2 `omm-domovina-ai-slike` | `<ključ>/<uuid>.jpg`, `tmp/` | slike brojila; lifecycle briše `tmp/` nakon dana |
| 12 | Durable Object `AdminUzivo` | `src/lib/admin/uzivo.ts` | WebSocketi otvorenih admin stranica; javlja svaki upis |
| 13 | Workers AI | `OCR_MODEL` (llama-4-scout) | čitanje zaslona brojila |
| 14 | Browser Rendering | `BROWSER` | PDF izvještaja potrošnje |
| 15 | Rate limiting | `LIMIT_API`, `LIMIT_SKUPO` | zaštita `/api/*` i skupih ruta |
| 16 | Cloudflare Access | `domovina.cloudflareaccess.com`, samo `/admin/sso` | admin prijava OTP-om (druga je passkey) |
| 17 | Resend (inbound) | MX `omm.domovina.ai` → `receive-euw1.forge.rmta.net` | prima mail na `racuni+<ključ>@omm.domovina.ai`, javlja webhookom |
| 18 | Korisnikov Gmail (ili drugi sandučić) | korisnikov račun | šalje upit Elektri, prima odgovor i račune, prosljeđuje ih na `racuni+<ključ>@` |
| 19 | Elektra (ODS područje, 21 komad) | mail adrese u `src/lib/prikljucak.ts` | ljudi odgovaraju na upit o priključnoj snazi |
| 20 | Chrome Web Store | `chromewebstore.google.com` | distribucija ekstenzije |

## Cjelina

```mermaid
flowchart LR
  subgraph Korisnik["Korisnikov uređaj"]
    WEB["Preglednik<br/>omm.domovina.ai /"]
    EXT["Chrome ekstenzija<br/>popup + service worker"]
    OZN["Oznaka (bookmarklet)<br/>+ iframe /oznaka"]
    APP["Flutter aplikacija"]
    GM["Gmail korisnika"]
  end

  subgraph HEP["HEP portali (korisnikova prijava)"]
    MM["Moja mreža<br/>mojamreza.hep.hr"]
    MR["Moj račun Elektra<br/>mojracun.hep.hr/elektra"]
    HP["Hepi<br/>mojracun.hep.hr/hepi"]
  end

  subgraph CF["Cloudflare (račun D.O.M.)"]
    W["Worker omm-domovina-ai<br/>Astro + email + cron"]
    D1[("D1<br/>omm-domovina-ai")]
    R2[("R2<br/>slike brojila")]
    DO["Durable Object<br/>AdminUzivo"]
    AI["Workers AI<br/>OCR"]
    BR["Browser Rendering<br/>PDF"]
    RL["Rate limit"]
    ACC["Access<br/>/admin/sso"]
  end

  ADM["Preglednik admina<br/>/admin"]
  RS["Resend inbound"]
  EL["Elektra (ODS)<br/>ljudi na mailu"]
  CWS["Chrome Web Store"]

  CWS -- instalacija --> EXT
  WEB -- "ključ (content script omm.js)" --> EXT
  EXT -- "ubaci parser u karticu" --> MM & MR & HP
  OZN -- "radi u kartici" --> MM & MR & HP
  APP -- WebView --> MM
  APP -- "POST /Omm/Dostava" --> MM

  EXT -- "POST /api/snimak, /api/racun" --> W
  OZN -- "postMessage kroz iframe /oznaka" --> W
  APP -- "/api/ocitaj, /api/snimak" --> W
  WEB -- "/api/* (Bearer ključ)" --> W

  GM -- "upit o snazi (mailto / Gmail)" --> EL
  EL -- odgovor --> GM
  GM -- "proslijedi na racuni+ključ@" --> RS
  RS -- "webhook email.received (Svix)" --> W
  W -- "GET /emails/receiving + raw" --> RS

  W --> RL
  W <--> D1
  W <--> R2
  W --> AI
  W --> BR
  W -- "javiAdminu()" --> DO
  W -- "javni cjenik" --> MR

  ADM -- "prijava OTP" --> ACC
  ACC --> W
  ADM -- "HTML stranice" --> W
  ADM <-. "WebSocket /admin/uzivo" .-> DO
```

## Tokovi

### 1. Uvoz s HEP-a ekstenzijom (glavni put)

Ključ nastaje na naslovnici i živi u `localStorage`; content script `omm.js` ekstenzije ga
preuzme (i postavi `data-omm-ekstenzija`, po čemu naslovnica zna da je ekstenzija tu).
Slanje ide s origina ekstenzije, pa HEP-ov CSP i COOP ne smetaju.

```mermaid
sequenceDiagram
  actor K as Korisnik
  participant N as Naslovnica /
  participant E as Ekstenzija
  participant H as HEP portal (prijavljena kartica)
  participant W as Worker
  participant D as D1
  participant O as AdminUzivo DO

  N->>E: ključ iz localStorage (omm.js)
  K->>H: prijava na portal (sam)
  K->>E: klik na ikonu, Uvezi
  E->>H: executeScript(uvoz.js | mojracun.js | hepi.js)
  H-->>E: JSON uvoza (i PDF-ovi računa za Hepi)
  E->>W: POST /api/snimak (Bearer ključ)
  W->>D: snimci (otisak, duplikat?) + dogadaji
  W-)O: javi {snimak, novo}
  E->>W: POST /api/racun (PDF, samo novi pozivi na broj)
  W->>D: snimak hep-racun + dogadaji
```

### 2. Uvoz oznakom (rezerva)

HEP-ov CSP priječi fetch i `<script>` s tuđeg origina, a COOP (od 2026-10-30) popup. Zato
oznaka ubaci skriveni iframe `/oznaka`, jedinu stranicu s `frame-ancestors` HEP-ovih
portala; on pošalje kod `/hep-uvoz.js` i šalje zahtjeve na API. Detalji i dijagrami:
`flutter_moja_mreza/docs/2026-10-14-uvoz-bez-instalacije.md` § „HEP-ov CSP”.

### 3. Očitanje brojila sa slike

```mermaid
sequenceDiagram
  participant C as Klijent (/ocitaj ili aplikacija)
  participant W as Worker
  participant R as R2
  participant A as Workers AI
  participant D as D1
  participant H as Moja mreža

  C->>W: POST /api/ocitaj (slika, omm?)
  W->>R: tmp/<ključ>/<uuid>.jpg
  W->>A: OCR_MODEL
  W->>D: zadnje stanje (usporedba.ts)
  W-->>C: t1, t2, prijedlog, upozorenja
  Note over C: korisnik potvrdi brojeve
  C->>W: POST /api/snimak (izvor foto)
  W->>R: tmp/ → <ključ>/
  W->>D: snimci + dogadaji
  C->>H: POST /Omm/Dostava (samo aplikacija, korisnikova sesija)
  C->>W: PATCH /api/snimak/:id {hep_dostava}
```

### 4. Priključna snaga mailom i admin uživo

Snage nema ni na portalu ni na računu, pa je pitamo Elektru. Odgovaraju ljudi, pa odgovor
stiže za sate ili dane; admin ga vidi čim mail stigne, bez osvježavanja.

```mermaid
sequenceDiagram
  actor K as Korisnik
  participant N as Naslovnica /
  participant G as Gmail korisnika
  participant E as Elektra (ODS)
  participant R as Resend
  participant W as Worker
  participant D as D1
  participant O as AdminUzivo DO
  participant A as /admin u pregledniku

  A->>W: WebSocket /admin/uzivo (Origin + sesija)
  W->>O: fetch (101), acceptWebSocket
  N->>G: upit (Gmail compose ili mailto), adresa po prve 2 znamenke OMM-a
  G->>E: mail
  E-->>G: „priključna snaga je 11,04 kW (3F) - 3x16 A”
  K->>G: proslijedi na racuni+<ključ>@omm.domovina.ai
  G->>R: SMTP (MX omm.domovina.ai)
  R->>W: POST /api/resend (email.received, Svix potpis)
  W->>R: GET /emails/receiving/{id}, raw.download_url
  W->>D: prikljucci (procitajPrikljucak) + mailovi
  W-)O: javi {prikljucak}, javi {mail-prikljucak}
  O-)A: {"vrsta":"prikljucak",...}
  A->>W: GET /admin (svoj HTML)
  Note over A: zamijeni data-uzivo dijelove, red zasvijetli
```

Isti put (Gmail → `racuni+<ključ>@` → Resend → `/api/resend`) nose i **računi HEP Opskrbe u
PDF-u** (`hep-racun`, `src/lib/hep-racun.ts`) i **Gmailova potvrda prosljeđivanja** (kod koji
korisnik vidi kroz `GET /api/mail`, jer bez nje Gmail automatski ne prosljeđuje).
PDF ni tijelo maila se ne čuvaju (OIB).

### 5. Izvještaj potrošnje

```mermaid
sequenceDiagram
  participant C as Korisnik ili admin
  participant W as Worker
  participant D as D1
  participant M as Moj račun (javni cjenik)
  participant B as Browser Rendering

  C->>W: GET /api/izvjestaj/:omm (ili /admin/izvjestaj/:omm)
  W->>D: svi uvozi + rucno/foto očitanja ključa
  W->>M: cjenik (cacheTtl dan)
  Note over W: izracun.ts + html.ts (Inter kao data: URL)
  W->>B: setContent, pdf (footerTemplate)
  B-->>W: PDF
  W-->>C: PDF | HTML | JSON
```

### 6. Admin prijava

```mermaid
flowchart LR
  A["/admin/*"] --> M{"middleware:<br/>host, Origin, sesija"}
  M -- "nema sesije" --> L["/admin/login"]
  L -- passkey --> PK["/admin/passkey/login/*<br/>(admin_passkeys)"]
  L -- "OTP" --> SSO["/admin/sso<br/>iza Cloudflare Accessa"]
  PK --> S[("admin_sessions<br/>sha256 tokena")]
  SSO --> S
  S --> M
  U["/admin/uzivo"] -- "worker.ts, mimo Astra:<br/>iste provjere" --> DO["AdminUzivo"]
```

## Podaci

```mermaid
erDiagram
  kljucevi ||--o{ snimci : "uredaj"
  kljucevi ||--o{ dogadaji : "uredaj"
  kljucevi ||--o{ mailovi : "uredaj"
  kljucevi ||--o{ prikljucci : "uredaj"
  snimci ||--o{ dogadaji : "snimak_id"
  snimci ||--o| mailovi : "snimak_id"
  admin_passkeys }o--|| admin_sessions : "email"
```

| Tablica | Što |
|---|---|
| `snimci` | pročišćeno: jedan redak po otisku sadržaja (uvoz, očitanje, račun) |
| `dogadaji` | sirovi dnevnik svakog upisa s ishodom; sažetak, ne sadržaj |
| `mailovi` | svaki primljeni mail: vrsta (`racun`, `prikljucak`, `gmail-potvrda`, `ostalo`) i ishod |
| `prikljucci` | priključna snaga po (ključ, OMM), iz maila ili ručno |
| `kljucevi` | poznati ključevi, `zamijenjen` nakon rotacije (401) |
| `admin_passkeys`, `admin_sessions`, `admin_challenges` | admin prijava |
| R2 | slike brojila; `tmp/` dok snimak ne preseli |
| DO `AdminUzivo` | nema trajnog stanja, samo otvorene WebSocket veze |

Dnevni cron (`17 3 * * *`, `src/lib/ciscenje.ts`) briše stari dnevnik i mailove po rokovima
iz `/privatnost`.

## Vezani dokumenti

- `CLAUDE.md` — tablica API-ja i pravila
- `docs/admin.md` — admin, prijava, uživo
- `docs/2026-10-31-prikljucna-snaga.md` — Elektre, prijem maila (Resend umjesto Email Routinga)
- `docs/security/2026-10-16-security-audit-fable.md` — prijetnje i popravci
- `flutter_moja_mreza/docs/2026-10-05-uvoz-arhitektura-i-povjerenje.md` — model povjerenja klijenata
- `flutter_moja_mreza/docs/2026-10-14-uvoz-bez-instalacije.md` — oznaka, iframe, HEP-ov CSP, ekstenzija
- `flutter_moja_mreza/docs/2026-10-12-omm-domovina-ai-plan.md` — izvorni plan
- `flutter_moja_mreza/docs/2026-10-13-izvjestaj-potrosnje.md` — izvještaj
