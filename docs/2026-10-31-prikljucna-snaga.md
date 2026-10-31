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

OMM ima 10 znamenki, **prve dvije su distribucijsko područje** (HO CIRED, „Jedinstveni
sustav daljinski očitavanih mjernih mjesta HEP-ODS-a”, SO6-12). Potvrđeno samo
`01` = Elektra Zagreb (oba naša OMM-a, 0100031779 i 0112024676). Popis ostalih šifri
nisam našao javno. Prijedlog: tablica `01 → zagreb`, ostale šifre učiti iz uvoza
(prefiks OMM-a + mjesto iz adrese); dok šifra nije poznata, klijent nudi izbor Elektre
ili šalje na `info.ods@hep.hr`.

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
