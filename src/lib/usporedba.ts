/**
 * Usporedba pročitanog broja sa zadnjim poznatim stanjem brojila.
 *
 * Model zna pogriješiti položaj decimalnog zareza (zaslon 0009062.6 pročitan
 * kao 906.25) i ne vidi uvijek oznaku tarife. Stanje brojila samo raste, pa uz
 * zadnje poznato stanje biramo položaj zareza i tarifu koji daju vrijednost
 * odmah iznad njega.
 */
import { env } from "cloudflare:workers";
import type { Registar } from "./ocr";

export interface Zadnje {
  t1: number | null;
  t2: number | null;
  datum: string; // YYYY-MM-DD
  izvor: string; // 'hep' (Moja mreža), 'hep-moj-racun' (Moj račun), 'hep-hepi' (Hepi) ili 'dostava' (naše poslano očitanje)
}

/** Najviše kWh dnevno po tarifi koje još smatramo uvjerljivim. */
const MAX_DNEVNO = 150;

type Ocitanje = { datum?: string; opis?: string; t1_kwh?: number; t2_kwh?: number };
type Mjesto = { omm?: string | null; ocitanja?: Ocitanje[] };
/** Moja mreža daje `mjesta[]`, Moj račun `kupci[]`; retci očitanja su istog oblika. */
type Uvoz = { mjesta?: Mjesto[]; kupci?: Mjesto[] };

/** Najnovije stanje iz uvoza s HEP-a i iz očitanja koja je HEP prihvatio. */
export async function zadnjeStanje(uredaj: string, omm: string | null): Promise<Zadnje | null> {
  const kandidati: Zadnje[] = [];

  // Zadnji uvoz iz svakog izvora: Moja mreža i Moj račun se ne sakrivaju.
  for (const izvor of ["hep", "hep-moj-racun", "hep-hepi"]) {
    const hep = await env.DB.prepare(
      `SELECT uvoz FROM snimci WHERE uredaj = ? AND izvor = ? ORDER BY stvoren DESC LIMIT 1`,
    )
      .bind(uredaj, izvor)
      .first<{ uvoz: string }>();
    if (!hep) continue;
    const u = JSON.parse(hep.uvoz) as Uvoz;
    for (const m of u.mjesta ?? u.kupci ?? []) {
      if (omm && m.omm !== omm) continue;
      // Procjena ODS-a nije stanje brojila i zna biti iznad stvarnog.
      const o = m.ocitanja?.find((o) => o.datum && !/^procijenjeno/i.test(o.opis ?? ""));
      if (o?.datum) kandidati.push({ t1: o.t1_kwh ?? null, t2: o.t2_kwh ?? null, datum: o.datum, izvor });
      if (!omm) break; // bez OMM-a uzmi prvo mjesto
    }
  }

  const dostava = await env.DB.prepare(
    `SELECT t1, t2, stvoren FROM snimci
      WHERE uredaj = ? AND izvor IN ('foto', 'rucno') AND json_extract(hep_dostava, '$.Status') = 1
        AND (? IS NULL OR omm = ?)
      ORDER BY stvoren DESC LIMIT 1`,
  )
    .bind(uredaj, omm, omm)
    .first<{ t1: number | null; t2: number | null; stvoren: string }>();
  if (dostava) kandidati.push({ t1: dostava.t1, t2: dostava.t2, datum: dostava.stvoren.slice(0, 10), izvor: "dostava" });

  kandidati.sort((a, b) => b.datum.localeCompare(a.datum));
  return kandidati[0] ?? null;
}

export interface Prijedlog {
  tarifa: "t1" | "t2";
  vrijednost: number; // s decimalama
  procitano: number; // kako je model pročitao
  zadnje: number;
  razlika: number; // kWh od zadnjeg stanja
  ispravljenZarez: boolean;
  tarifaPoUsporedbi: boolean; // oznaka nije bila vidljiva, tarifa određena usporedbom
}

/** Najbolji položaj zareza za `v` uz zadnje stanje `r`, ili null ako nijedan nije uvjerljiv. */
function skaliraj(v: number, r: number, dana: number): { c: number; razlika: number } | null {
  const gornja = MAX_DNEVNO * Math.max(dana, 1) + 50;
  let najbolji: { c: number; razlika: number } | null = null;
  for (const k of [0, 1, 2, 3, -1, -2]) {
    const c = Math.round(v * 10 ** k * 100) / 100;
    const razlika = c - r;
    // Stanje ne pada; 1 kWh tolerancije za decimalu koju HEP odreže.
    if (razlika < -1 || razlika > gornja) continue;
    if (!najbolji || razlika < najbolji.razlika) najbolji = { c, razlika };
  }
  return najbolji;
}

export function usporedi(registri: Registar[], zadnje: Zadnje): { prijedlozi: Prijedlog[]; upozorenja: string[] } {
  const dana = Math.round((Date.now() - Date.parse(zadnje.datum)) / 86_400_000);
  const prijedlozi: Prijedlog[] = [];
  const upozorenja: string[] = [];

  for (const reg of registri) {
    if (reg.obis.startsWith("2.")) continue;
    const poznata: "t1" | "t2" | null = reg.obis === "1.8.1" ? "t1" : reg.obis === "1.8.2" ? "t2" : null;
    const sve: ("t1" | "t2")[] = poznata ? [poznata] : ["t1", "t2"];
    const tarife = sve.filter((t) => zadnje[t] != null);

    let najbolji: Prijedlog | null = null;
    for (const t of tarife) {
      const r = zadnje[t]!;
      const s = skaliraj(reg.vrijednost, r, dana);
      if (s && (!najbolji || s.razlika < najbolji.razlika)) {
        najbolji = {
          tarifa: t,
          vrijednost: s.c,
          procitano: reg.vrijednost,
          zadnje: r,
          razlika: Math.round(s.razlika),
          ispravljenZarez: s.c !== reg.vrijednost,
          tarifaPoUsporedbi: !poznata,
        };
      }
    }
    if (najbolji) prijedlozi.push(najbolji);
    else if (poznata && zadnje[poznata] != null) {
      upozorenja.push(
        `${reg.obis}: pročitano ${reg.vrijednost}, a zadnje stanje (${zadnje.datum}) je ${zadnje[poznata]} kWh. Provjeri broj.`,
      );
    }
  }
  return { prijedlozi, upozorenja };
}
