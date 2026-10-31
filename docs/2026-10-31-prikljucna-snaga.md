# Priključna snaga i vrsta priključka (istraživanje 2026-10-31)

Cilj: za svaki OMM znati priključnu snagu (kW) i broj faza (1F/3F, osigurač), jer o
tome ovisi kakva se elektrana smije spojiti i kakva se ponuda daje. Napravljeno istog dana
(tok niže, odjeljak „Prijedlog toka“): gumb na `/`, prijem na `racuni+<ključ>@` (ne na
posebnoj adresi, da ne treba novo pravilo u Email Routingu), ručni unos.

## Gdje taj podatak postoji

| Izvor | Ima li snagu | Napomena |
|---|---|---|
| Moja mreža (mojamreza.hep.hr) | ne | uvoz ima samo OMM, brojilo, korisnika, OIB, adresu, tarifni model (`flutter_moja_mreza/docs/hep-moja-mreza-recept.md`) |
| Račun HEP Elektre (BIJ1) | ne | |
| mjerenje.hep.hr | da | samo za snage iznad 20 kW i poduzetništvo |
| Elektroenergetska suglasnost (EES) | da | papir koji korisnik možda ima od priključenja |
| **Mail Elektri** | da | radi; vidi dolje |
| Ormarić (KPMO) na licu mjesta | djelomično | glavni osigurač / limitator (npr. 3×16 A) i natpisna pločica brojila (3×230/400 V = trofazno) |

## Provjereno: mail HEP-u

Upit #ODS:10641937, poslan 23.10.2026. 09:00 na `info.ods@hep.hr` i
`elektra.zagreb@hep.hr` (s OMM, brojem brojila, šifrom kupca, OIB-om i adresom).

- `elektra.zagreb@hep.hr` je **vratio mail** (mailbox full, 554 5.2.2). Prava adresa
  Elektre je `info.dp<grad>@hep.hr`.
- `info.ods@hep.hr` je u 10:12 odgovorio da je upit proslijeđen.
- `info.dpzagreb@hep.hr` (Elektra Zagreb, Odjel za odnose s korisnicima) je u 12:59
  odgovorio, **za 4 sata**, jednom rečenicom:

  > na Vašem mjernom mjestu 0100031779 priključna snaga je 11,04 kW (3F) - 3x16 A.

- Oba odgovora idu **samo pošiljatelju** (nema Cc ni Reply-To). Ako bi mi bili u Cc,
  odgovor nam ne bi stigao.

Oblik je lako parsirati: `(\d+[.,]\d+)\s*kW`, `\((1F|3F)\)`, `(\d)\s*x\s*(\d+)\s*A`.
Jedan uzorak, pa regex mora biti tolerantan, a ručna potvrda ostaje (kao kod OCR-a).

## E-mail adrese Elektri (hep.hr/ods, stranice Elektri, 2026-10-31)

| Elektra | E-mail |
|---|---|
| Elektra Zagreb | info.dpzagreb@hep.hr |
| Elektra Zabok | info.dpzabok@hep.hr |
| Elektra Varaždin | info.dpvarazdin@hep.hr |
| Elektra Čakovec | info.dpcakovec@hep.hr |
| Elektra Koprivnica | info.dpkoprivnica@hep.hr |
| Elektra Bjelovar | info.dpbjelovar@hep.hr |
| Elektra Križ | info.dpkriz@hep.hr |
| Elektroslavonija Osijek | info.dposijek@hep.hr |
| Elektra Vinkovci | info.dpvinkovci@hep.hr |
| Elektra Slavonski Brod | info.dpslavonskibrod@hep.hr |
| Elektroistra Pula | info.dppula@hep.hr |
| Elektroprimorje Rijeka | info.dprijeka@hep.hr |
| Elektrodalmacija Split | info.dpsplit@hep.hr |
| Elektra Zadar | info.dpzadar@hep.hr |
| Elektra Šibenik | info.dpsibenik@hep.hr |
| Elektrojug Dubrovnik | info.dpdubrovnik@hep.hr |
| Elektra Karlovac | info.dpkarlovac@hep.hr |
| Elektra Sisak | info.dpsisak@hep.hr |
| Elektrolika Gospić | info.dpgospic@hep.hr |
| Elektra Virovitica | info.dpvirovitica@hep.hr |
| Elektra Požega | info.dppozega@hep.hr |

Rezerva za sve: `info.ods@hep.hr` (prosljeđuje Elektri, +1 korak), tel. 0800 300 401.

## Koja Elektra za koji OMM

OMM ima 10 znamenki, **prve dvije su distribucijsko područje** (HO CIRED SO6-12, HEP-ova
Pravila o mjernim podacima). Šifra je **redni broj Elektre** istim redom kojim ih HEP ODS
navodi (tablica gore: 01 Zagreb … 21 Požega), a ne pozivni ni poštanski broj (Varaždin je
03, pozivni 042, poštanski 42xxx).

Dokaz: OMM-ovi bolnica i ureda s adresama iz HZZO-ove nabave struje 2017.
([Prilog 8.2 MM](https://hzzo.hr/wp-content/uploads/2017/06/Prilog_8_2_MM.pdf)), npr. 0171010038
KBC Sestre milosrdnice, 0301218450 Varaždinske Toplice, 1305698243 KBC Split, 1610002700
OB Dubrovnik, 2103015805 OŽB Požega. Elektrojug je 2017. pisao da OMM nastaje tako da se
staroj šifri kupca doda 1600 (dulist.hr).

- Sigurno (više lokacija): 01, 03, 05, 09–17, 19.
- Po jednoj lokaciji: 02 Zabok, 04 Čakovec, 18 Sisak, 20 Virovitica, 21 Požega.
- Samo po redoslijedu: 06 Bjelovar (nijedan nalaz), 07 Križ (Popovača, Pakrac), 08 Osijek
  (Našice; KBC Osijek u HZZO-ovu popisu ima šifre s izgubljenim nulama).
- Šifra prati stari pogon: Jastrebarsko je 17 (Karlovac), Metković i Ploče 13 (Split). Za
  upit to ne smeta, Elektra ga proslijedi.

U kodu: `elektraZaOmm` u `src/lib/prikljucak.ts`; nepoznata šifra (00, 22+) ide na
`info.ods@hep.hr`.

## Prijedlog toka u aplikaciji

1. Uz OMM bez poznate snage: gumb „Saznaj priključnu snagu”. Otvara `mailto:` na
   Elektru po prefiksu, s gotovim naslovom i tijelom (OMM, broj brojila, ime, adresa iz
   uvoza; OIB samo ako ga korisnik želi dodati). Šalje korisnik iz svog maila, jer HEP
   podatak daje kupcu, a server ne komunicira s HEP-om (isto pravilo kao za Moju mrežu).
2. Odgovor korisnik **proslijedi** na `prikljucak+<ključ>@omm.domovina.ai` (ili isti
   `racuni+<ključ>@`, pa `primiMail` razlikuje po sadržaju). Worker izvuče kW, faze i
   osigurač i spremi uz OMM; korisnik potvrdi na `/`.
3. Rezerva: ručni unos (kW, 1F/3F, A) ili fotografija osigurača/pločice brojila.
4. U tijelo maila može ići molba „odgovor molim poslati i na prikljucak+…@”, ali na to
   ne računamo: oba odgovora iz #ODS:10641937 išla su samo pošiljatelju.

Gmail Forward ne mijenja tekst odgovora, ali omota poveznice; parser čita samo tekst
pa to ne smeta.

## Prijem maila: omm.domovina.ai nema MX (2026-10-31)

Prvo pravo prosljeđivanje (06:22 UTC) nije stiglo: `omm.domovina.ai` nema MX zapis, a Email
Routing za `domovina.ai` je isključen. Prosljeđivanje računa na `racuni+…@` zato nikad nije
radilo u produkciji. Cloudflare poddomenu dodaje samo kad je Email Routing uključen na
korijenu, a uključivanje traži Cloudflareove MX na `domovina.ai` (greška 2008 „Non-Cloudflare
MX records exist“), gdje je Google Workspace. Samostalna poddomena kao zona je Enterprise.
Ostaje: druga domena bez maila na D.O.M. računu (Cloudflare) ili Resend s MX samo na `omm`.

**Odluka: Resend.** Domena `omm.domovina.ai` u Resendu (eu-west-1, slanje i primanje), MX
`receive-euw1.forge.rmta.net`, webhook `1b649021-…` → `https://omm.domovina.ai/api/resend`
(samo `email.received`). Test 2026-10-31 06:48 UTC: mail poslan preko Resenda na
`racuni+<testni ključ>@` spremljen kao 11,04 kW / 3F / 16 A za 2 s; testni podaci obrisani.

## Pravo prosljeđivanje iz Gmaila (2026-10-31)

- **Kašnjenje**: korisnik je ponovno proslijedio u 06:51 UTC (nakon postavljanja MX-a), stiglo je
  u 06:59:54. Vjerojatno Gmailov negativni MX cache od prvog pokušaja (SOA minimum 1800 s).
  Resendu ne treba „inbox“: domena s uključenim primanjem i webhook su dovoljni.
- **Zamka parsera**: Gmailov Forward u tekst ubaci zaglavlje izvornog maila, a naslov upita
  („Upit o priključnoj snazi – OMM …“) sadrži isti izraz. Prvi spomen „priključn… snag…“ bio je
  naslov, okno od 160 znakova odrezalo je „(3F) - 3x16 A“, pa je spremljeno samo 11,04 kW.
  Popravak (`49abf9b`): ako između spomena i broja kW stoji još jedan spomen, preskoči na njega.
  Zapis korisnika ručno dopunjen u D1 (faze 3, osigurač 16).
- Novi oblik odgovora (druga Elektra, drugačija rečenica) testirati na **proslijeđenom** tekstu,
  ne samo na izvornom odgovoru.
