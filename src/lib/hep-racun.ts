/**
 * HEP Opskrba (Hepi) PDF račun → JSON. Prijepis parsera iz
 * ~/git/stepanic/rezije/scripts/parse-hep-racune.py, koji radi na
 * `pdftotext -layout`. Ovdje se isti raspored redaka slaže iz položaja teksta
 * (unpdf), pa regexi ostaju isti. OIB i ime kupca se ne uzimaju.
 *
 * Zamke (rezije/docs/2026-09-21-hep-racuni-parsiranje.md): iznos računa je
 * samo na uplatnici iza `***`; dug ima dvije formulacije; tablica 12 mjeseci
 * parsira se po recima.
 */
import { getDocumentProxy } from "unpdf";

export type HepRacun = {
  broj: string | null;
  datum_racuna: string | null;
  izdan: string | null;
  dospijece: string | null;
  za_mjesec: string | null;
  razdoblje: { od: string; do: string } | null;
  sifra_kupca: string | null;
  omm: string | null;
  model: string | null;
  iznos: number | null;
  opskrba: number | null;
  mreza: number | null;
  dug: number | null;
  vt_kwh: number | null;
  nt_kwh: number | null;
  vt_cijena: number | null;
  nt_cijena: number | null;
  zadnjih12: Record<string, number>;
  uplate: { datum: string; iznos: number }[];
  brojilo: string | null;
  ocitanja: { datum: string; kanal: string; vt: number; nt: number }[];
};

type Stavka = { str: string; transform: number[]; width: number };

/** Redci stranice kao u `pdftotext -layout`: isti y u jedan redak, razmaci po x. */
async function stranice(pdf: Uint8Array): Promise<string[]> {
  const dok = await getDocumentProxy(pdf);
  const izlaz: string[] = [];
  for (let s = 1; s <= dok.numPages; s++) {
    const sadrzaj = await (await dok.getPage(s)).getTextContent();
    const redci = new Map<number, Stavka[]>();
    for (const st of sadrzaj.items as Stavka[]) {
      if (!st.str?.trim()) continue;
      const y = Math.round(st.transform[5] / 2) * 2;
      redci.set(y, [...(redci.get(y) ?? []), st]);
    }
    const linije = [...redci.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, st]) => {
        st.sort((a, b) => a.transform[4] - b.transform[4]);
        let red = "";
        let kraj = 0;
        for (const x of st) {
          // Razmak između stavki: barem jedan, a veći jaz daje više njih
          // (regexi traže `\s+`, pa je dovoljno da ga ima).
          if (red) red += x.transform[4] - kraj > 3 ? "   " : " ";
          red += x.str;
          kraj = x.transform[4] + x.width;
        }
        return red;
      });
    izlaz.push(linije.join("\n"));
  }
  return izlaz;
}

const num = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));
const prvi = (re: RegExp, t: string) => re.exec(t)?.[1] ?? null;
const bezTocke = (s: string | null) => (s ? s.replace(/\.$/, "") : null);
/** `dd.mm.yyyy` → `yyyy-mm-dd`, kao ostatak servisa. */
const iso = (s: string | null) => {
  const m = /(\d{2})\.(\d{2})\.(\d{2,4})/.exec(s ?? "");
  if (!m) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
};

export function parsiraj(t1: string, t2: string): HepRacun {
  const iznosIza = (re: RegExp, t: string) => {
    const m = re.exec(t);
    return m ? num(m[1]) : null;
  };

  let dug: number | null = iznosIza(/nepodmireni iznos je\s*([\d.]+,\d\d)\s*eura/, t1);
  if (dug === null && /podmirili ste sve prethodne obaveze/i.test(t1)) dug = 0;

  const vt = /viša tarifa po ([\d.,]+) EUR\/kWh\s+(\d+)\s+([\d.,]+)/.exec(t2);
  const nt = /niža tarifa po ([\d.,]+) EUR\/kWh\s+(\d+)\s+([\d.,]+)/.exec(t2);

  // Zaglavlje pa prvi sljedeći neprazni redak = mjeseci, idući = kWh.
  const zadnjih12: Record<string, number> = {};
  const linije = t2.split("\n");
  const i12 = linije.findIndex((l) => l.includes("ZADNJIH 12 MJESECI"));
  if (i12 >= 0) {
    const ostatak = linije.slice(i12 + 1, i12 + 8).filter((l) => l.trim());
    if (ostatak.length >= 2) {
      const mj = ostatak[0].match(/\d+\/\d+/g) ?? [];
      const kw = ostatak[1].match(/-?\d+/g) ?? [];
      if (mj.length && mj.length === kw.length) mj.forEach((m, i) => (zadnjih12[m] = parseInt(kw[i], 10)));
    }
  }

  const uplate: HepRacun["uplate"] = [];
  const blok = /UPLATE([\s\S]*?)(?:VAŠA POTROŠNJA|Ukupno uplate)/.exec(t2);
  if (blok) {
    for (const m of blok[1].matchAll(/(\d{2}\.\d{2}\.\d{4})\s+([\d.]+,\d\d)(?=\s|$)/g)) {
      uplate.push({ datum: iso(m[1])!, iznos: num(m[2]) });
    }
  }

  const ocitanja = [...t2.matchAll(/(\d{2}\.\d{2}\.\d{4})\s+([A-Za-zČčĆćŠšŽžĐđ]+)\s+(\d+,\d+)\s+(\d+,\d+)/g)].map((m) => ({
    datum: iso(m[1])!,
    kanal: m[2],
    vt: num(m[3]),
    nt: num(m[4]),
  }));

  const raz = /Račun za razdoblje\s+(\d{2}\.\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2}\.\d{2})/.exec(`${t1}\n${t2}`);

  return {
    broj: prvi(/Broj računa:\s*([\d-]+)/, t1),
    datum_racuna: iso(bezTocke(prvi(/Datum računa:\s*([\d.]+)/, t1))),
    izdan: iso(bezTocke(prvi(/izdan u Zagrebu:\s*([\d.]+)/, t1))),
    dospijece: iso(bezTocke(prvi(/Platite do:\s*([\d.]+)/, t1))),
    za_mjesec: prvi(/Ukupni iznos računa za\s*(\d+\/\d+)/, t1),
    razdoblje: raz ? { od: iso(raz[1])!, do: iso(raz[2])! } : null,
    sifra_kupca: prvi(/Šifra kupca:\s*(\d+)/, t1),
    omm: prvi(/Broj obračunskog mjesta:\s*(\d{10})/, t2),
    model: prvi(/Model:\s*([^\n]+?)(?:\s{2,}|$)/m, t1),
    iznos: iznosIza(/\*\*\*([\d.]+,\d\d)/, t1),
    opskrba: iznosIza(/Ukupni iznos za opskrbu\s+([\d.]+,\d\d)/, t1),
    mreza: iznosIza(/Ukupni iznos za korištenje mreže i usluga\s+([\d.]+,\d\d)/, t1),
    dug,
    vt_kwh: vt ? parseInt(vt[2], 10) : null,
    nt_kwh: nt ? parseInt(nt[2], 10) : null,
    vt_cijena: vt ? parseFloat(vt[1].replace(",", ".")) : null,
    nt_cijena: nt ? parseFloat(nt[1].replace(",", ".")) : null,
    zadnjih12,
    uplate,
    brojilo: prvi(/Brojilo:\s*(\d+)/, t2),
    ocitanja,
  };
}

/** Je li PDF HEP-ov račun: bez toga se ne parsira (adresu za mail zna svatko tko je vidi). */
export const jeHepRacun = (t1: string) => /HEP - Opskrba d\.o\.o\./.test(t1) && /Broj računa:/.test(t1);

export async function procitajRacun(pdf: Uint8Array): Promise<HepRacun | null> {
  const [t1 = "", t2 = ""] = await stranice(pdf);
  return jeHepRacun(t1) ? parsiraj(t1, t2) : null;
}
