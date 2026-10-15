/**
 * Godišnji izvještaj potrošnje struje za jedan OMM, iz svih snimaka jednog ključa.
 *
 * Prijepis `flutter_moja_mreza/tools/izvjestaj/izvjestaj.py` (funkcija `izvjestaj`):
 * ista metoda, isti tekstovi, isti JSON za predložak. Promjenu računice napravi u
 * oba. Razlika: ovdje nema YAML profila, pa se naziv, mjesto, opskrbljivač i
 * lokacija izvode iz uvoza, a ručna očitanja su snimci `rucno`/`foto` (T1 i T2).
 *
 * Metoda: mjesečno = stanje brojila na prvi dan mjeseca, linearno između stvarnih
 * očitanja. Procjene ODS-a se izbacuju, osim kad bez njih razdoblje nema početak ili
 * kraj. Cijene su današnji cjenik HEP Elektre (javni API Mojeg računa).
 *
 * Datumi su „zidno vrijeme“ u Hrvatskoj zapisano kao UTC milisekunde, kao naivni
 * datetime u Pythonu: HEP-ov „2026-10-11“ je ponoć tog dana.
 */

export const CJENIK_URL = "https://mojracun.hep.hr/elektra/v1/api/obracun/cjenik";
const DUGI_RAZMAK = 45; // dana bez stvarnog očitanja nakon kojih je mjesec „raspodijeljen“
const PRAG = 3000; // kWh po polugodištu (lis–ožu, tra–ruj); iznad toga energija +35 %
const DAN = 86_400_000;
export const MJ = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"];
export const MJD = ["siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj", "srpanj",
  "kolovoz", "rujan", "listopad", "studeni", "prosinac"];
const DANI = ["pon", "uto", "sri", "čet", "pet", "sub", "ned"];

/** 1234.5 → „1.234,5“ */
export function hr(x: number, dec = 0): string {
  const s = Math.abs(x).toFixed(dec);
  const [c, d] = s.split(".");
  const tisuce = c.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (x < 0 && Number(s) !== 0 ? "−" : "") + tisuce + (d ? "," + d : "");
}
const hrDatum = (t: number) => { const d = new Date(t); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}.`; };
const mjesec = (t: number) => new Date(t).getUTCMonth() + 1;
const godina = (t: number) => new Date(t).getUTCFullYear();
const prvi = (g: number, m: number) => Date.UTC(g, m - 1, 1); // m 1..12, smije preliti
const dana = (a: number, b: number) => (b - a) / DAN;
const ym = (t: number) => new Date(t).toISOString().slice(0, 7); // 2026-09
const naslovno = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** ISO trenutak (UTC) → zidno vrijeme u Zagrebu kao UTC ms. */
function zagreb(iso: string): number {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
/** „2026-10-11“ ili „2026-10-11T…“ → ponoć tog dana. */
const datum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

// ---------------------------------------------------------------- ulaz

export type Snimak = {
  izvor: string; stvoren: string; omm: string | null; t1: number | null; t2: number | null;
  lat: number | null; lon: number | null; uvoz: string | null;
};
type Ocitanje = { datum: string; opis: string; t1_kwh: number | null; t2_kwh?: number | null };
type Promet = { opis: string; poziv_na_broj?: string | null; duguje_eur?: number };
type Mjesto = {
  izvor: string; dohvaceno: number; korisnik?: string | null; adresa?: string | null; brojilo?: string | null;
  ugovorni_racun?: string | null; tarifni_model?: string | null; ocitanja: Ocitanje[]; racuni: Promet[];
};

const PORTALI: Record<string, string> = {
  hep: "Moja mreža (HEP ODS)", "hep-moj-racun": "Moj račun (HEP Elektra)", "hep-hepi": "Moj Hepi račun (HEP Opskrba)",
};

/** Normalizira jedan uvoz (Moja mreža, Moj račun, Hepi) u mjesto za zadani OMM, ili null. */
function mjestoIzUvoza(izvor: string, uvoz: any, omm: string): Mjesto | null {
  const dohvaceno = datum(String(uvoz.dohvaceno ?? ""));
  if (Array.isArray(uvoz.kupci)) {
    const k = uvoz.kupci.find((k: any) => k?.omm === omm);
    if (!k) return null;
    return { izvor: PORTALI[izvor], dohvaceno, korisnik: k.ime, adresa: k.adresa, ugovorni_racun: k.ugovorni_racun,
      tarifni_model: k.tarifni_model, ocitanja: k.ocitanja ?? [],
      racuni: (k.promet ?? []).filter((s: Promet) => s.opis === "Račun") };
  }
  const m = Array.isArray(uvoz.mjesta) ? uvoz.mjesta.find((m: any) => m?.omm === omm) : uvoz.omm === omm ? uvoz : null;
  if (!m) return null;
  return { izvor: PORTALI[izvor], dohvaceno, korisnik: m.korisnik, adresa: m.adresa, brojilo: m.broj_brojila,
    tarifni_model: m.tarifni_model, ocitanja: m.ocitanja ?? [], racuni: [] };
}

export type Cjenik = any;
type Cijene = {
  bijeli: { ev: number; en: number; mv: number; mn: number }; plavi: { e: number; m: number };
  oie: number; fiksno: number; pdv: number;
};
function cijene(c: Cjenik): Cijene {
  const mreza = (m: string, t: string) => c[m].prijenos[t] + c[m].distribucija[t];
  return {
    bijeli: { ev: c.bijeli.proizvodnja.vt, en: c.bijeli.proizvodnja.nt, mv: mreza("bijeli", "vt"), mn: mreza("bijeli", "nt") },
    plavi: { e: c.plavi.proizvodnja.vt, m: mreza("plavi", "vt") },
    oie: c.oie, fiksno: c.opskrba + c.plavi.mjernaUsluga, pdv: 1 + c.pdv,
  };
}

/** Mjesto za naslov: zadnji dio adrese bez broja, bez poštanskog broja i „HR“. */
function grad(adresa: string): string | null {
  const dijelovi = adresa.split(",").map((d) => d.trim().replace(/^\d{5}\s+/, "")).filter((d) => d && d !== "HR");
  const bez = dijelovi.filter((d) => !/\d/.test(d));
  return bez.length ? naslovno(bez[bez.length - 1]) : null;
}

// ---------------------------------------------------------------- izračun

type Tocka = { t: number; t1: number; t2: number; opis: string; vrsta: "stvarno" | "rucno" | "procjena" };
const procjena = (opis: string) => /proc|preračun/i.test(opis ?? "");

export class NemaPodataka extends Error {}

function tocke(ocitanja: Ocitanje[], rucna: { t: number; t1: number; t2: number | null }[], od: number, doo: number): Tocka[] {
  const rucniDani = new Set(rucna.map((r) => Math.floor(r.t / DAN)));
  const sve: Tocka[] = [];
  for (const o of ocitanja) {
    if (o.t1_kwh == null) continue;
    sve.push({ t: datum(o.datum), t1: o.t1_kwh, t2: o.t2_kwh ?? 0, opis: o.opis,
      vrsta: procjena(o.opis) || !o.t1_kwh ? "procjena" : "stvarno" });
  }
  let stvarne = sve.filter((x) => x.vrsta === "stvarno" && !rucniDani.has(Math.floor(x.t / DAN)));
  const t2Rucno = Math.max(0, ...stvarne.map((x) => x.t2)); // bez T2 na snimku: T2 stoji
  stvarne = stvarne.concat(rucna.map((r) => ({ t: r.t, t1: r.t1, t2: r.t2 ?? t2Rucno, opis: "Ručno očitanje", vrsta: "rucno" as const })));
  // Dva očitanja istog trenutka (kupac i ODS 1.10., ili isto u dva uvoza): vrijedi veće stanje.
  const poTrenutku = new Map<number, Tocka>();
  for (const x of stvarne) {
    const y = poTrenutku.get(x.t);
    if (!y || x.t1 > y.t1 || (x.t1 === y.t1 && x.t2 > y.t2)) poTrenutku.set(x.t, x);
  }
  // Isto stanje ponovno dostavljeno kasnije nije novo očitanje.
  const ocisceno: Tocka[] = [];
  for (const x of [...poTrenutku.values()].sort((a, b) => a.t - b.t)) {
    const z = ocisceno[ocisceno.length - 1];
    if (!z || x.t1 !== z.t1 || x.t2 !== z.t2) ocisceno.push(x);
  }
  const procjene = sve.filter((x) => x.vrsta === "procjena" && x.t1).sort((a, b) => a.t - b.t);
  if (!ocisceno.some((x) => x.t <= od)) {
    const prije = procjene.filter((x) => x.t <= od);
    if (!prije.length) throw new NemaPodataka(`Nema očitanja prije ${hrDatum(od)}`);
    ocisceno.unshift(prije[prije.length - 1]);
  }
  if (!ocisceno.some((x) => x.t >= doo)) {
    const poslije = procjene.filter((x) => x.t >= doo && x.t > ocisceno[ocisceno.length - 1].t);
    if (!poslije.length) throw new NemaPodataka(`Nema očitanja ni procjene nakon ${hrDatum(doo)}`);
    ocisceno.push(poslije[0]);
  }
  return ocisceno;
}

function stanje(pts: Tocka[], d: number, k: "t1" | "t2"): number {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    if (a.t <= d && d <= b.t) return a[k] + (b[k] - a[k]) * dana(a.t, d) / dana(a.t, b.t);
  }
  throw new NemaPodataka(`Nema očitanja oko ${hrDatum(d)}`);
}

function interval(pts: Tocka[], d: number): [Tocka, Tocka] {
  for (let i = 0; i + 1 < pts.length; i++) if (pts[i].t <= d && d < pts[i + 1].t) return [pts[i], pts[i + 1]];
  throw new NemaPodataka(`Nema očitanja oko ${hrDatum(d)}`);
}

type Mj = { od: number; t1: number; t2: number; kwh: number; raspodijeljeno: boolean;
  energija: number; mreza: number; fiksno: number; preko: number; ukupno: number };

function mjeseci(pts: Tocka[], od: number, n = 12): Mj[] {
  const out: Mj[] = [];
  for (let i = 0; i < n; i++) {
    const a = prvi(godina(od), mjesec(od) + i), b = prvi(godina(od), mjesec(od) + i + 1);
    const t1 = stanje(pts, b, "t1") - stanje(pts, a, "t1");
    const t2 = stanje(pts, b, "t2") - stanje(pts, a, "t2");
    let raspodijeljeno = false;
    for (let d = a; d < b; d += DAN) {
      const [p, q] = interval(pts, d);
      if (dana(p.t, q.t) > DUGI_RAZMAK || p.vrsta === "procjena" || q.vrsta === "procjena") raspodijeljeno = true;
    }
    out.push({ od: a, t1, t2, kwh: t1 + t2, raspodijeljeno, energija: 0, mreza: 0, fiksno: 0, preko: 0, ukupno: 0 });
  }
  return out;
}

/** Mjesečni trošak s PDV-om za model 'bijeli' ili 'plavi'; prag po polugodištu. */
function trosak(mj: Mj[], model: string, c: Cijene) {
  let kum = 0;
  return mj.map((x) => {
    if (mjesec(x.od) === 10 || mjesec(x.od) === 4) kum = 0;
    const preko = Math.max(0, kum + x.kwh - PRAG) - Math.max(0, kum - PRAG);
    kum += x.kwh;
    const f = 1 + 0.35 * (x.kwh ? preko / x.kwh : 0);
    let en: number, mr: number;
    if (model === "bijeli") {
      const b = c.bijeli;
      en = (x.t1 * b.ev + x.t2 * b.en) * f;
      mr = x.t1 * (b.mv + c.oie) + x.t2 * (b.mn + c.oie);
    } else {
      en = x.kwh * c.plavi.e * f;
      mr = x.kwh * (c.plavi.m + c.oie);
    }
    return { energija: en * c.pdv, mreza: mr * c.pdv, fiksno: c.fiksno * c.pdv, preko, ukupno: (en + mr + c.fiksno) * c.pdv };
  });
}

function rasponMjeseci(mjs: Mj[]): string {
  if (!mjs.length) return "";
  const [a, b] = [mjs[0].od, mjs[mjs.length - 1].od];
  return a === b ? MJD[mjesec(a) - 1] : `${MJD[mjesec(a) - 1]}–${MJD[mjesec(b) - 1]}`;
}

// ---------------------------------------------------------------- izvještaj

export type Podaci = ReturnType<typeof izvjestaj>;

/**
 * snimci: svi snimci ključa za ovaj OMM (uvozi s HEP-a i očitanja), bilo kojim redom.
 * Za uvoze se uzimaju očitanja iz svih uvoza zajedno, jer portal pokazuje ograničenu
 * povijest, a podaci o kupcu iz najnovijeg.
 */
export function izvjestaj(omm: string, snimci: Snimak[], cjenik: Cjenik, opcije: { anonimno?: boolean; danas?: Date } = {}) {
  const anon = !!opcije.anonimno;
  const c = cijene(cjenik);
  const poVremenu = [...snimci].sort((a, b) => b.stvoren.localeCompare(a.stvoren));
  const mjesta = poVremenu.flatMap((s) => {
    if (!s.uvoz || !(s.izvor in PORTALI)) return [];
    const m = mjestoIzUvoza(s.izvor, JSON.parse(s.uvoz), omm);
    return m ? [{ izvor: s.izvor, m }] : [];
  });
  const rucna = poVremenu.filter((s) => (s.izvor === "rucno" || s.izvor === "foto") && s.omm === omm && s.t1 != null)
    .map((s) => ({ t: zagreb(s.stvoren), t1: s.t1!, t2: s.t2, lat: s.lat, lon: s.lon }));
  if (!mjesta.length) throw new NemaPodataka("Za ovaj OMM nema uvoza s HEP-a");

  // Podaci o kupcu: Moja mreža ima brojilo i tarifni model, Moj račun ugovorni račun.
  const najnoviji = (izvor: string) => mjesta.find((x) => x.izvor === izvor)?.m;
  const glavno = najnoviji("hep") ?? mjesta[0].m;
  const m: Mjesto = {
    ...glavno,
    ugovorni_racun: glavno.ugovorni_racun ?? mjesta.find((x) => x.m.ugovorni_racun)?.m.ugovorni_racun,
    tarifni_model: glavno.tarifni_model ?? mjesta.find((x) => x.m.tarifni_model)?.m.tarifni_model,
    // Hepi sva očitanja zove „Elektra“ i ne razlikuje procjene (rujan 2026: mjesečna
    // stanja za račun su većinom procjene). Uzimaju se samo kad drugog izvora nema.
    ocitanja: (mjesta.some((x) => x.izvor !== "hep-hepi") ? mjesta.filter((x) => x.izvor !== "hep-hepi") : mjesta)
      .flatMap((x) => x.m.ocitanja),
    racuni: najnoviji("hep-moj-racun")?.racuni ?? najnoviji("hep-hepi")?.racuni ?? [],
  };
  const izvori = [...new Set(mjesta.map((x) => x.m.izvor))];
  const opskrbljivac = najnoviji("hep-hepi") ? "HEP Opskrba (Hepi)" : najnoviji("hep-moj-racun") ? "HEP Elektra" : null;
  const lok = rucna.find((r) => r.lat != null && r.lon != null);

  // Zadnjih 12 punih mjeseci prije zadnjeg podatka (uvoza ili ručnog očitanja); kad
  // povijest ne seže toliko unatrag, od prvog punog mjeseca za koji postoji očitanje.
  const dohvaceno = Math.max(...mjesta.map((x) => x.m.dohvaceno).filter(Number.isFinite), ...rucna.map((r) => r.t));
  const doo = prvi(godina(dohvaceno), mjesec(dohvaceno));
  const sveTocke = [...m.ocitanja.filter((o) => o.t1_kwh != null).map((o) => datum(o.datum)), ...rucna.map((r) => r.t)];
  const najranije = Math.min(...sveTocke);
  const prviPuni = (t: number) => (t === prvi(godina(t), mjesec(t)) ? t : prvi(godina(t), mjesec(t) + 1));
  const od = Math.max(prvi(godina(doo) - 1, mjesec(doo)), prviPuni(najranije));
  const brojMj = (a: number, b: number) => (godina(b) - godina(a)) * 12 + mjesec(b) - mjesec(a);
  const n = brojMj(od, doo);
  if (n < 1) throw new NemaPodataka("Premalo očitanja: izvještaj treba barem jedan puni mjesec između dva očitanja");

  const pts = tocke(m.ocitanja, rucna, od, doo);
  const mj = mjeseci(pts, od, n);
  const tm = (m.tarifni_model ?? "").toLowerCase();
  const model = tm.includes("bijeli") ? "bijeli" : "plavi";
  trosak(mj, model, c).forEach((t, i) => Object.assign(mj[i], t));

  const zbroj = (xs: Mj[], k: keyof Mj) => xs.reduce((s, x) => s + (x[k] as number), 0);
  const kwh = zbroj(mj, "kwh"), eur = zbroj(mj, "ukupno"), t2 = zbroj(mj, "t2");
  const dvoregistarsko = t2 > kwh * 0.01;
  const zimski = (x: Mj) => mjesec(x.od) >= 10 || mjesec(x.od) <= 3;
  const mjZima = mj.filter(zimski), mjLjeto = mj.filter((x) => !zimski(x));
  const preko = zbroj(mj, "preko");
  const cijelaGodina = n === 12;
  const brojDana = (x: Mj) => dana(x.od, prvi(godina(x.od), mjesec(x.od) + 1));
  const poDanu = (xs: Mj[]) => zbroj(xs, "kwh") / xs.reduce((s, x) => s + brojDana(x), 0);

  // ---- usporedba s istim mjesecima godinu ranije, koliko povijest seže (barem 3 mjeseca)
  let usporedba = null;
  const odPrije = Math.max(prvi(godina(od) - 1, mjesec(od)), prviPuni(najranije));
  const nPrije = brojMj(odPrije, od);
  if (nPrije >= 3) {
    try {
      const mjPrije = mjeseci(tocke(m.ocitanja, rucna, odPrije, od), odPrije, nPrije);
      trosak(mjPrije, model, c).forEach((t, i) => Object.assign(mjPrije[i], t));
      // Isti kalendarski mjesec godinu kasnije.
      const sada = new Map(mj.map((x) => [ym(x.od), x]));
      const parovi = mjPrije.flatMap((p) => {
        const s = sada.get(ym(prvi(godina(p.od) + 1, mjesec(p.od))));
        return s ? [{ prije: p, sada: s }] : [];
      });
      if (parovi.length >= 3) {
        const [kp, ks] = [parovi.reduce((s, x) => s + x.prije.kwh, 0), parovi.reduce((s, x) => s + x.sada.kwh, 0)];
        const [ep, es] = [parovi.reduce((s, x) => s + x.prije.ukupno, 0), parovi.reduce((s, x) => s + x.sada.ukupno, 0)];
        const a = parovi[0].prije.od, b = parovi[parovi.length - 1].prije.od;
        usporedba = {
          razdoblje: `${MJD[mjesec(a) - 1]} ${godina(a)}. – ${MJD[mjesec(b) - 1]} ${godina(b)}.`,
          broj_mjeseci: parovi.length, kwh_prije: kp, kwh_sada: ks, eur_prije: ep, eur_sada: es,
          promjena: kp ? (ks - kp) / kp * 100 : 0,
          raspodijeljeno_prije: parovi.filter((x) => x.prije.raspodijeljeno).length,
          mjeseci: parovi.map((x) => ({
            oznaka: MJ[mjesec(x.sada.od) - 1], kwh_prije: x.prije.kwh, kwh_sada: x.sada.kwh,
            raspodijeljeno_prije: x.prije.raspodijeljeno, raspodijeljeno_sada: x.sada.raspodijeljeno,
          })),
        };
      }
    } catch (e) {
      if (!(e instanceof NemaPodataka)) throw e;
    }
  }

  // ---- tekst objašnjenja, iz podataka
  const biljeske = ["Mjesečna potrošnja je razlika stanja brojila na prvi dan mjeseca, linearno interpolirana " +
    "između očitanja s portala."];
  biljeske.push("Uzeta su samo stvarna očitanja (kupac, ODS, daljinsko" + (rucna.length ? ", vlastita s omm.domovina.ai" : "") +
    "). Procjene ODS-a i „preračunata“ stanja su izbačena" +
    (pts.some((p) => p.vrsta === "procjena") ? ", osim gdje bez njih razdoblje nema početak ili kraj." : "."));
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const n = dana(a.t, b.t);
    if (b.t <= od || a.t >= doo) continue;
    const unutra = mj.filter((x) => a.t < x.od + 27 * DAN && x.od < b.t);
    const k = (b.t1 - a.t1) + (b.t2 - a.t2);
    if (b.vrsta === "procjena") {
      biljeske.push(`Zadnje stvarno očitanje je ${hrDatum(a.t)} Razdoblje ${rasponMjeseci(unutra)} ide do ` +
        `procjene ODS-a za ${hrDatum(b.t)} (${hr(k / n, 1)} kWh/dan). Novo očitanje brojila ` +
        "učinilo bi te mjesece točnima.");
    } else if (a.vrsta === "procjena") {
      biljeske.push(`Prvo stvarno očitanje u razdoblju je ${hrDatum(b.t)}; početak se oslanja na procjenu ` +
        `ODS-a za ${hrDatum(a.t)}.`);
    } else if (n > DUGI_RAZMAK) {
      biljeske.push(`Od ${hrDatum(a.t)} do ${hrDatum(b.t)} nema stvarnog očitanja (${hr(k)} kWh u ` +
        `${hr(n)} dana, ${hr(k / n, 1)} kWh/dan), pa je ${rasponMjeseci(unutra)} raspodijeljen ravnomjerno.`);
    }
  }
  if (preko) {
    biljeske.push(`Prag: potrošnja iznad ${hr(PRAG)} kWh u polugodištu (lis–ožu, tra–ruj) plaća energiju 35 % ` +
      `skuplje; ovdje ${hr(preko)} kWh. Mrežarina ostaje ista.`);
  }
  if (dvoregistarsko) {
    const drugi = model === "bijeli" ? "plavi" : "bijeli";
    const eur2 = trosak(mj, drugi, c).reduce((s, t) => s + t.ukupno, 0);
    const razlika = eur2 - eur;
    const ime: Record<string, string> = { bijeli: "Bijelom", plavi: "Plavom" };
    let s = `NT je ${hr(t2 / kwh * 100)} % potrošnje. Na ${ime[drugi]} bi ${cijelaGodina ? "ista godina" : "isto razdoblje"} koštala ${hr(eur2, 2)} € ` +
      `umjesto ${hr(eur, 2)} €`;
    if (Math.abs(razlika) < 10) s += ": tarifni modeli izađu praktički isto.";
    else if (razlika > 0) s += `, dakle sadašnji model štedi oko ${hr(razlika)} € godišnje.`;
    else s += `: prelazak bi uštedio oko ${hr(-razlika)} € godišnje.`;
    biljeske.push(s);
  }
  if (m.racuni.length) {
    // Poziv na broj nosi kraj obračunskog mjeseca: …-260920-… = rujan 2026.
    const zadnji = doo - DAN;
    const a = ym(od).slice(2).replace("-", ""), b = ym(zadnji).slice(2).replace("-", "");
    const rac = m.racuni.filter((r) => r.poziv_na_broj && a <= (r.poziv_na_broj.split("-")[1] ?? "").slice(0, 4)
      && (r.poziv_na_broj.split("-")[1] ?? "").slice(0, 4) <= b);
    if (rac.length) {
      const [fod, fdo] = [ym(od), ym(zadnji)];
      const isti = mj.filter((x) => fod <= ym(x.od) && ym(x.od) <= fdo);
      biljeske.push(`Stvarno fakturirano za ${fod.slice(5)}/${fod.slice(0, 4)}–${fdo.slice(5)}/${fdo.slice(0, 4)} ` +
        `(${rac.length} računa, Moj račun): ${hr(rac.reduce((s, r) => s + (r.duguje_eur ?? 0), 0), 2)} €. Ovaj izračun za iste mjesece ` +
        `daje ${hr(zbroj(isti, "ukupno"), 2)} €. Računi idu po procjenama i korigiraju se nakon ` +
        "očitanja, a do 1.11.2025. cijene su bile niže.");
    }
  }
  const cj = model === "bijeli"
    ? `energija VT ${hr(c.bijeli.ev, 6)} / NT ${hr(c.bijeli.en, 6)}; mrežarina VT ${hr(c.bijeli.mv, 6)} / NT ${hr(c.bijeli.mn, 6)}`
    : `energija ${hr(c.plavi.e, 6)}; mrežarina ${hr(c.plavi.m, 6)}`;
  biljeske.push(`Cijene su današnje (bez PDV-a, €/kWh): ${cj}; OIE ${hr(c.oie, 6)}. Fiksno ` +
    `${hr(c.fiksno, 3)} €/mj. PDV ${hr((c.pdv - 1) * 100)} %.`);
  if (od < Date.UTC(2026, 0, 1)) {
    biljeske.push("Do 31.12.2025. mrežarina je bila oko 13 % niža, pa su mjeseci do kraja 2025. malo precijenjeni. " +
      "Ovo je procjena, ne preslika računa. Solidarna naknada nije uključena (obračuna se i stornira).");
  } else {
    biljeske.push("Ovo je procjena, ne preslika računa. Solidarna naknada nije uključena (obračuna se i stornira).");
  }

  // ---- vlastita očitanja (ako ih je barem dva u razdoblju)
  const ruc = pts.filter((p) => p.vrsta === "rucno");
  let rucno = null;
  if (ruc.length >= 2) {
    const [r0, rn] = [ruc[0], ruc[ruc.length - 1]];
    const uk = (rn.t1 + rn.t2) - (r0.t1 + r0.t2), n = dana(r0.t, rn.t);
    const zadnji = mj[mj.length - 1];
    const poKwh = zadnji.kwh ? (zadnji.ukupno - zadnji.fiksno) / zadnji.kwh : 0;
    const dm = (t: number) => { const d = new Date(t); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
    const dan = (t: number) => DANI[(new Date(t).getUTCDay() + 6) % 7];
    rucno = {
      od: hrDatum(r0.t), do: hrDatum(rn.t), kwh: uk, dana: n, po_danu: uk / n,
      mj30: uk / n * 30 * poKwh + zadnji.fiksno, ljeto_po_danu: poDanu(mj.slice(-3)),
      intervali: ruc.slice(1).map((b, i) => {
        const a = ruc[i], k = (b.t1 + b.t2) - (a.t1 + a.t2);
        return { oznaka: `${dm(a.t)} → ${dm(b.t)}`, dani: `${dan(a.t)}–${dan(b.t)}`, kwh: k, po_danu: k / dana(a.t, b.t) };
      }),
    };
  }

  // ---- zaglavlje
  const adresa = naslovno(m.adresa ?? "").replace(/, Hr$/, "");
  const mjestoGrad = grad(m.adresa ?? "");
  let zaglavlje: [string, string | null][] = [
    ["Mjerno mjesto (OMM)", anon ? `${omm.slice(0, 2)}•••••${omm.slice(-3)}` : omm],
    ["Adresa", anon ? mjestoGrad : adresa],
    ["Korisnik", anon ? null : naslovno(m.korisnik ?? "") || null],
    ["Brojilo", anon ? null : m.brojilo ?? null],
    ["Tarifni model", `${naslovno(model)} (${model === "bijeli" ? "dvotarifni" : "jednotarifni"})` +
      (model === "plavi" && dvoregistarsko ? ", brojilo mjeri VT i NT" : "")],
    ["Opskrbljivač", opskrbljivac],
    ["Izvor podataka", izvori.length > 1 ? `${izvori.length} portala` : izvori[0].replace(/ \(.*/, "")],
    ["Lokacija", anon || !lok ? null : `${hr(lok.lat!, 3)}° N, ${hr(lok.lon!, 3)}° E`],
  ];
  if (m.ugovorni_racun && !anon) zaglavlje.splice(4, 0, ["Ugovorni račun", m.ugovorni_racun]);
  if (anon) zaglavlje = zaglavlje.filter(([o]) => o !== "Korisnik" && o !== "Brojilo");
  // Mreža je 4 stupca: višak (ugovorni račun) gura „Izvor podataka“ van.
  if (zaglavlje.length > 8) zaglavlje = zaglavlje.filter(([o]) => o !== "Izvor podataka");

  const vrh = mj.reduce((a, b) => (b.kwh > a.kwh ? b : a));
  const sezona = (ime: string, xs: Mj[]) => xs.length
    ? `${ime} ${hr(zbroj(xs, "kwh"))} kWh${xs.length < 6 ? ` (${xs.length} mj.)` : ""}, oko ${hr(poDanu(xs), 1)} kWh/dan` : null;
  const sezone = [sezona("zima (lis–ožu)", mjZima), sezona("ljeto (tra–ruj)", mjLjeto)].filter(Boolean).join(" · ");
  const sazetak = (cijelaGodina ? "" : `Prvo očitanje je ${hrDatum(najranije)}, pa izvještaj pokriva ${n} punih mjeseci umjesto 12. `) +
    sezone.charAt(0).toUpperCase() + sezone.slice(1) +
    `. Najviši mjesec: ${MJD[mjesec(vrh.od) - 1]} ${godina(vrh.od)}. (${hr(vrh.kwh)} kWh). ` +
    (preko ? `Prag od ${hr(PRAG)} kWh po polugodištu je probijen, pa je ${hr(preko)} kWh plaćeno s energijom skupljom za 35 %.`
      : `Prag od ${hr(PRAG)} kWh po polugodištu nije probijen, pa nema uvećanja od 35 %.`);

  const danas = opcije.danas ?? new Date();
  const zadnjiDan = doo - DAN;
  const sat = (t: number) => new Date(t).toISOString().slice(11, 16);
  return {
    omm: anon ? `${omm.slice(0, 2)}•••••${omm.slice(-3)}` : omm,
    naslov: ["Mjerno mjesto", mjestoGrad].filter(Boolean).join(" · "),
    adresa: anon ? mjestoGrad : adresa,
    razdoblje: `${MJD[mjesec(od) - 1]} ${godina(od)}. – ${MJD[mjesec(zadnjiDan) - 1]} ${godina(zadnjiDan)}.`,
    od: ym(od),
    izvor: `podaci s portala ${izvori.join(", ")}` + (rucna.length ? " i vlastita očitanja" : "") + `, zadnji ${hrDatum(dohvaceno)}`,
    url: "https://omm.domovina.ai", izradeno: hrDatum(zagreb(danas.toISOString())),
    zaglavlje: zaglavlje.map(([oznaka, vrijednost]) => ({ oznaka, vrijednost })),
    opskrbljivac: opskrbljivac ?? "cjenik HEP Elektre", dvotarifno: dvoregistarsko,
    ukupno: { kwh, eur, energija: zbroj(mj, "energija"), mreza: zbroj(mj, "mreza"), fiksno: zbroj(mj, "fiksno") },
    sazetak, biljeske, rucno, usporedba, broj_mjeseci: n,
    mjeseci: mj.map((x) => ({
      oznaka: `${MJ[mjesec(x.od) - 1]} ${String(godina(x.od)).slice(2)}`, mjesec: `${MJD[mjesec(x.od) - 1]} ${godina(x.od)}`,
      kwh: x.kwh, t1: x.t1, t2: x.t2, energija: x.energija, mreza: x.mreza, fiksno: x.fiksno, ukupno: x.ukupno,
      raspodijeljeno: x.raspodijeljeno,
    })),
    ocitanja: pts.filter((p) => p.t >= od - 60 * DAN).map((p) => ({
      datum: hrDatum(p.t) + (p.vrsta === "rucno" ? ` ${sat(p.t)}` : ""), t1: p.t1, t2: p.t2, opis: p.opis,
    })),
  };
}
