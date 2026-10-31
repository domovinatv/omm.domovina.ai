/**
 * Priključna snaga i broj faza. Ne piše ni na jednom HEP-ovu portalu ni računu, ali
 * Elektra je kaže na upit mailom (#ODS:10641937, 23.10.2026., odgovor za 4 sata):
 * „na Vašem mjernom mjestu 0100031779 priključna snaga je 11,04 kW (3F) - 3x16 A.“
 * Upit šalje korisnik iz svog maila (`upitHepu`), a odgovor proslijedi na
 * racuni+<ključ>@ (`procitajPrikljucak` u src/lib/mail.ts).
 * Istraživanje: docs/2026-10-31-prikljucna-snaga.md.
 *
 * Bez importa iz cloudflare:workers: koristi ga i skripta na naslovnici.
 */

export type Elektra = { naziv: string; email: string };

/** Adrese s hep.hr/ods (stranica svake Elektre), 2026-10-31. */
export const ELEKTRE: Record<string, Elektra> = {
  zagreb: { naziv: "Elektra Zagreb", email: "info.dpzagreb@hep.hr" },
  zabok: { naziv: "Elektra Zabok", email: "info.dpzabok@hep.hr" },
  varazdin: { naziv: "Elektra Varaždin", email: "info.dpvarazdin@hep.hr" },
  cakovec: { naziv: "Elektra Čakovec", email: "info.dpcakovec@hep.hr" },
  koprivnica: { naziv: "Elektra Koprivnica", email: "info.dpkoprivnica@hep.hr" },
  bjelovar: { naziv: "Elektra Bjelovar", email: "info.dpbjelovar@hep.hr" },
  kriz: { naziv: "Elektra Križ", email: "info.dpkriz@hep.hr" },
  osijek: { naziv: "Elektroslavonija Osijek", email: "info.dposijek@hep.hr" },
  vinkovci: { naziv: "Elektra Vinkovci", email: "info.dpvinkovci@hep.hr" },
  slavonskibrod: { naziv: "Elektra Slavonski Brod", email: "info.dpslavonskibrod@hep.hr" },
  pula: { naziv: "Elektroistra Pula", email: "info.dppula@hep.hr" },
  rijeka: { naziv: "Elektroprimorje Rijeka", email: "info.dprijeka@hep.hr" },
  split: { naziv: "Elektrodalmacija Split", email: "info.dpsplit@hep.hr" },
  zadar: { naziv: "Elektra Zadar", email: "info.dpzadar@hep.hr" },
  sibenik: { naziv: "Elektra Šibenik", email: "info.dpsibenik@hep.hr" },
  dubrovnik: { naziv: "Elektrojug Dubrovnik", email: "info.dpdubrovnik@hep.hr" },
  karlovac: { naziv: "Elektra Karlovac", email: "info.dpkarlovac@hep.hr" },
  sisak: { naziv: "Elektra Sisak", email: "info.dpsisak@hep.hr" },
  gospic: { naziv: "Elektrolika Gospić", email: "info.dpgospic@hep.hr" },
  virovitica: { naziv: "Elektra Virovitica", email: "info.dpvirovitica@hep.hr" },
  pozega: { naziv: "Elektra Požega", email: "info.dppozega@hep.hr" },
};

/** Središnja služba HEP ODS-a; proslijedi upit Elektri (jedan dan više). */
export const HEP_ODS: Elektra = { naziv: "HEP ODS", email: "info.ods@hep.hr" };

/**
 * Prve dvije znamenke OMM-a su distribucijsko područje (HO CIRED SO6-12, HEP-ova Pravila o
 * mjernim podacima): redni broj Elektre istim redom kojim ih HEP ODS navodi (gore). Javnog
 * popisa nema; provjereno na OMM-ovima s adresama iz HZZO-ove nabave struje 2017.
 * (hzzo.hr/wp-content/uploads/2017/06/Prilog_8_2_MM.pdf): sigurno 01, 03, 05, 09–17, 19,
 * po jednoj lokaciji 02, 04, 18, 20, 21, a 06 (Bjelovar), 07 (Križ: Popovača) i 08 (Osijek:
 * Našice) samo po redoslijedu. Šifra prati stari pogon, ne današnju Elektru: Jastrebarsko je
 * 17, Metković 13. Za upit to ne smeta, Elektra ga proslijedi.
 */
const PODRUCJA = Object.keys(ELEKTRE);

export const elektraZaOmm = (omm: string): Elektra | null => ELEKTRE[PODRUCJA[Number(omm.slice(0, 2)) - 1]] ?? null;

export type Podaci = { omm: string; ime?: string | null; adresa?: string | null; brojilo?: string | null; sifra_kupca?: string | null };

/**
 * Upit Elektri. Tijelo namjerno nema broja ispred „kW“: proslijeđeni odgovor citira
 * upit, a parser traži upravo taj oblik.
 */
export function upitHepu(p: Podaci): { naslov: string; tijelo: string } {
  const redovi = [
    p.ime && `Ime i prezime: ${p.ime}`,
    p.adresa && `Adresa mjernog mjesta: ${p.adresa}`,
    `Broj obračunskog mjernog mjesta (OMM): ${p.omm}`,
    p.brojilo && `Broj brojila: ${p.brojilo}`,
    p.sifra_kupca && `Šifra kupca: ${p.sifra_kupca}`,
  ].filter(Boolean);
  return {
    naslov: `Upit o priključnoj snazi – OMM ${p.omm}`,
    tijelo: [
      "Poštovani,",
      "",
      "molim podatak o priključnoj snazi u kilovatima i o vrsti priključka (jednofazni ili trofazni, glavni osigurač) za moje obračunsko mjerno mjesto.",
      "",
      ...redovi,
      "",
      "Unaprijed zahvaljujem.",
      "Srdačan pozdrav,",
      p.ime ?? "",
    ].join("\n"),
  };
}

export type Prikljucak = { snaga_kw: number; faze: 1 | 3 | null; osigurac_a: number | null };

const broj = (s: string) => Number(s.replace(",", "."));

/**
 * Iz teksta HEP-ova odgovora (i proslijeđenog) izvuče snagu, faze i osigurač.
 * Bez snage u kW, a s osiguračem (3x16 A), snaga se izračuna: 230 V × A × faze.
 */
export function procitajPrikljucak(tekst: string): (Prikljucak & { omm: string | null; recenica: string }) | null {
  const t = tekst.replace(/^[ \t]*>+[ \t]?/gm, "").replace(/\s+/g, " ");
  // Prvi spomen koji ima broj: proslijeđeni mail iza odgovora citira i naš upit.
  for (const m of t.matchAll(/priklju[čc]n\w*\s+sna[gz]\w*/gi)) {
    const okno = t.slice(m.index, m.index + 160);
    const kw = /(\d{1,4}(?:[.,]\d{1,3})?)\s*kW\b/i.exec(okno);
    const osig = /\b([13])\s*[x×*]\s*(\d{1,3})\s*A\b/i.exec(okno);
    const faze: 1 | 3 | null =
      /\(\s*3\s*F\s*\)|\btrofazn/i.test(okno) || osig?.[1] === "3" ? 3
      : /\(\s*1\s*F\s*\)|\b(?:jedno|mono)fazn/i.test(okno) || osig?.[1] === "1" ? 1
      : null;
    const osigurac_a = osig ? Number(osig[2]) : null;
    let snaga_kw = kw ? broj(kw[1]) : null;
    if (snaga_kw == null && osigurac_a && faze) snaga_kw = Math.round(0.23 * osigurac_a * faze * 100) / 100;
    if (snaga_kw == null || !(snaga_kw > 0 && snaga_kw <= 1000)) continue;
    const omm = /mjern\w*\s+mjest\w*\s*(?:broj\s*)?(?:\(OMM\)\s*)?:?\s*(\d{10})\b/i.exec(t)?.[1]
      ?? /\bOMM\b\D{0,20}(\d{10})\b/i.exec(t)?.[1] ?? null;
    // Rečenica za prikaz: od prethodne točke, najviše 60 znakova unatrag, od cijele riječi.
    const tocka = t.lastIndexOf(". ", m.index);
    let pocetak = Math.max(tocka < 0 ? 0 : tocka + 2, m.index - 60);
    if (pocetak > 0 && t[pocetak - 1] !== " ") pocetak = t.indexOf(" ", pocetak) + 1;
    const kraj = t.indexOf(". ", m.index + (kw ? kw.index + kw[0].length : 0));
    const recenica = t.slice(pocetak, kraj < 0 ? m.index + 160 : Math.min(kraj + 1, m.index + 240)).trim();
    return { snaga_kw, faze, osigurac_a, omm, recenica };
  }
  return null;
}
