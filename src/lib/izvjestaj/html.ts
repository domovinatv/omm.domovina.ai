/**
 * Izvještaj kao HTML stranica A4 (za PDF iz Browser Renderinga i za pregled).
 * Prijepis `flutter_moja_mreza/tools/izvjestaj/predlozak.html.j2` i funkcije
 * `stupci`: DOMOVINA brend iz mediakit.domovina.tv (logo Domovina Energy,
 * tamnoplava #002F6C). Promjenu izgleda napravi u oba.
 */
import qrcode from "qrcode-generator";
import logo from "./logo.svg?raw";
import { hr, type Podaci } from "./izracun";

const e = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jedan = (v: number) => (v % 1 ? hr(v, 1) : hr(v));

function qr(url: string): string {
  const q = qrcode(0, "M");
  q.addData(url);
  q.make();
  return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

/** Lijepa gornja granica i korak osi, najviše pet koraka: 576 → (600, 200), 106 → (125, 25). */
function zaokruziGore(v: number): [number, number] {
  if (v <= 0) return [1, 1];
  const ex = 10 ** Math.floor(Math.log10(v));
  for (const k of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    if (v / (k * ex) <= 5) return [k * ex * Math.ceil(v / (k * ex)), k * ex];
  }
  return [v, v];
}

function putStupca(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  const f = (n: number) => n.toFixed(1);
  return `M${f(x)},${f(y + h)} V${f(y + r)} Q${f(x)},${f(y)} ${f(x + r)},${f(y)} H${f(x + w - r)} ` +
    `Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)} V${f(y + h)} Z`;
}

/** stavke: za svaki stupac lista [vrijednost, css klasa] odozdo prema gore. */
function stupci(stavke: [number, string][][], oznake: string[], fmt: (v: number) => string,
  o: { H?: number; B?: number; crta?: number; podoznake?: string[] } = {}): string {
  const [W, H, L, R, T, B] = [680, o.H ?? 215, 46, 10, 18, o.B ?? 34];
  const zbroj = (s: [number, string][]) => s.reduce((a, [v]) => a + v, 0);
  const [maxv, korak] = zaokruziGore(Math.max(...stavke.map(zbroj)) * 1.08);
  const y = (v: number) => T + (H - T - B) * (1 - v / maxv);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let v = 0; v <= maxv + 1e-9; v += korak) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/>` +
      `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="ax" text-anchor="end">${fmt(v)}</text>`;
  }
  const slot = (W - L - R) / stavke.length, bw = slot * 0.62;
  stavke.forEach((segs, i) => {
    const cx = L + slot * i + slot / 2;
    let y0 = H - B;
    segs.forEach(([val, cls], j) => {
      const h = (H - T - B) * val / maxv;
      s += `<path d="${putStupca(cx - bw / 2, y0 - h, bw, h - (j ? 2 : 0), j === segs.length - 1 ? 4 : 0)}" class="${cls}"/>`;
      y0 -= h;
    });
    s += `<text x="${cx.toFixed(1)}" y="${(y0 - 5).toFixed(1)}" class="val" text-anchor="middle">${fmt(zbroj(segs))}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${H - B + 15}" class="ax" text-anchor="middle">${e(oznake[i])}</text>`;
    if (o.podoznake) s += `<text x="${cx.toFixed(1)}" y="${H - B + 28}" class="ax" text-anchor="middle">${e(o.podoznake[i])}</text>`;
  });
  if (o.crta != null) s += `<line x1="${L}" x2="${W - R}" y1="${y(o.crta).toFixed(1)}" y2="${y(o.crta).toFixed(1)}" class="prosjek"/>`;
  return s + `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="base"/></svg>`;
}

/** Podnožje svake stranice PDF-a (puppeteer footerTemplate; Browser Rendering ne crta @page rubne okvire). */
export const PODNOZJE = `<div style="font:7.5px Inter,sans-serif;color:#8a8984;width:100%;margin:0 14mm 5mm;display:flex">
<span>DOMOVINA Energy · omm.domovina.ai · izvještaj potrošnje struje</span>
<span style="margin-left:auto"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

/** Par stupaca po mjesecu: godinu ranije (svijetlo) i sada (tamnoplavo). */
function parovi(mjeseci: { oznaka: string; kwh_prije: number; kwh_sada: number;
  raspodijeljeno_prije: boolean; raspodijeljeno_sada: boolean }[]): string {
  const [W, H, L, R, T, B] = [680, 190, 46, 10, 18, 22];
  const [maxv, korak] = zaokruziGore(Math.max(...mjeseci.flatMap((x) => [x.kwh_prije, x.kwh_sada])) * 1.1);
  const y = (v: number) => T + (H - T - B) * (1 - v / maxv);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  for (let v = 0; v <= maxv + 1e-9; v += korak) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/>` +
      `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="ax" text-anchor="end">${hr(v)}</text>`;
  }
  const slot = (W - L - R) / mjeseci.length, bw = slot * 0.34;
  mjeseci.forEach((x, i) => {
    const cx = L + slot * i + slot / 2;
    const stupac = (v: number, lijevo: boolean, cls: string) => {
      const h = (H - T - B) * v / maxv, x0 = lijevo ? cx - bw - 1 : cx + 1;
      return `<path d="${putStupca(x0, H - B - h, bw, h, 3)}" class="${cls}"/>` +
        `<text x="${(x0 + bw / 2).toFixed(1)}" y="${(H - B - h - 4).toFixed(1)}" class="val sitno" text-anchor="middle">${hr(v)}</text>`;
    };
    s += stupac(x.kwh_prije, true, x.raspodijeljeno_prije ? "s3 est" : "s3");
    s += stupac(x.kwh_sada, false, x.raspodijeljeno_sada ? "s1 est" : "s1");
    s += `<text x="${cx.toFixed(1)}" y="${H - B + 15}" class="ax" text-anchor="middle">${e(x.oznaka)}</text>`;
  });
  return s + `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="base"/></svg>`;
}

/** fontovi: URL-ovi Intera po težini; za PDF data: URL-ovi, jer Browser Rendering ne učita vanjske. */
export function html(p: Podaci, fontovi: Record<400 | 600 | 700, string>): string {
  const mj = p.mjeseci, u = p.ukupno, kod = qr(p.url);
  const n = p.broj_mjeseci, godisnje = n === 12;
  const kpi: [string, string][] = [
    [`${hr(u.kwh)} kWh`, godisnje ? "godišnja potrošnja" : `potrošnja u ${n} mj.`],
    [`${hr(u.eur)} €`, godisnje ? "godišnji trošak s PDV-om" : `trošak u ${n} mj. s PDV-om`],
    [`${hr(u.eur / n)} €`, "prosječno mjesečno"], [`${hr(u.eur / u.kwh * 100, 1)} c`, "po kWh, sve uključeno"],
  ];
  const us = p.usporedba;
  const usporedba = us ? `
<h2 style="margin-top:18px">Usporedba s godinom ranije (kWh)</h2>
<p class="note" style="margin-bottom:4px">Isti mjeseci godinu ranije (${e(us.razdoblje)}). Trošak je za obje godine po današnjim cijenama, pa razlika pokazuje promjenu potrošnje, a ne cijene.${us.raspodijeljeno_prije > us.broj_mjeseci / 2 ? ` Godinu ranije je ${us.raspodijeljeno_prije} od ${us.broj_mjeseci} mjeseci raspodijeljeno između rijetkih očitanja, pa je usporedba po mjesecima gruba, a zbroj pouzdaniji.` : ""}</p>
<div class="leg"><span><i style="background:var(--s3)"></i>godinu ranije</span><span><i style="background:var(--s1)"></i>ovo razdoblje</span><span><i style="background:repeating-linear-gradient(45deg,#002F6C 0 2px,#c9d3e3 2px 5px)"></i>raspodijeljeno ravnomjerno</span></div>
${parovi(us.mjeseci)}
<div class="kpi" style="grid-template-columns:repeat(3,1fr)">
<div><b>${us.promjena > 0 ? "+" : ""}${hr(us.promjena, 1)} %</b><span>potrošnja u ${us.broj_mjeseci} usporedivih mj.</span></div>
<div><b>${us.kwh_sada >= us.kwh_prije ? "+" : "−"}${hr(Math.abs(us.kwh_sada - us.kwh_prije))} kWh</b><span>${hr(us.kwh_prije)} → ${hr(us.kwh_sada)} kWh</span></div>
<div><b>${us.eur_sada >= us.eur_prije ? "+" : "−"}${hr(Math.abs(us.eur_sada - us.eur_prije))} €</b><span>razlika u trošku (${hr(us.eur_prije)} → ${hr(us.eur_sada)} €)</span></div>
</div>` : "";
  const r = p.rucno;
  const rucno = r ? `
<div class="pb"></div>
<h2>Vlastita očitanja: ${e(r.od)} – ${e(r.do)}</h2>
<p class="note" style="margin-bottom:6px">Prosječna potrošnja po danu između dva očitanja (kWh/dan). Ukupno ${hr(r.kwh, 1)} kWh u ${hr(r.dana, 1)} dana; isprekidana linija je prosjek ${hr(r.po_danu, 1)} kWh/dan.</p>
${stupci(r.intervali.map((i) => [[i.po_danu, "s1"]]), r.intervali.map((i) => i.oznaka), jedan,
    { H: 210, B: 44, crta: r.po_danu, podoznake: r.intervali.map((i) => `${i.dani} · ${hr(i.kwh, 1)} kWh`) })}
<div class="kpi" style="grid-template-columns:repeat(3,1fr)">
<div><b>${hr(r.po_danu, 1)} kWh</b><span>prosječno dnevno (zadnja tri mjeseca oko ${hr(r.ljeto_po_danu, 1)})</span></div>
<div><b>${hr(r.mj30, 2)} €</b><span>30 dana uz ovu potrošnju, ukupno na računu</span></div>
<div><b>${hr(r.kwh, 1)} kWh</b><span>potrošeno u ${hr(r.dana, 1)} dana</span></div>
</div>` : `<div class="pb"></div>`;

  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>Potrošnja struje · ${e(p.naslov)}</title>
<style>
@font-face{font-family:Inter;font-weight:400;src:url(${fontovi[400]})}
@font-face{font-family:Inter;font-weight:600;src:url(${fontovi[600]})}
@font-face{font-family:Inter;font-weight:700 900;src:url(${fontovi[700]})}
/* DOMOVINA brend (mediakit.domovina.tv): tamnoplava i crvena hrvatske zastave */
:root{--marka:#002F6C;--s1:#002F6C;--s2:#D9343A;--s3:#9AAAC2;--ink:#0b0b0b;--ink2:#52514e;--mute:#8a8984;--grid:#e6e5e1;--surf:#fcfcfb}
@page{size:A4;margin:12mm 14mm 14mm}
*{box-sizing:border-box}
body{font:10pt/1.45 Inter,-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--ink);background:#fff;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.traka{display:flex;align-items:center;gap:14px;background:var(--marka);color:#fff;border-radius:10px;padding:8px 12px;margin-bottom:10px}
.traka .logo{display:block;width:55px;height:55px;flex:none}
.traka .marka{color:#fff;line-height:1.1}
.traka .marka b{display:block;font-weight:900;font-size:15pt;letter-spacing:.03em}
.traka .marka span{font-size:11pt}
.traka .marka small{font-size:7.5pt;color:#b9c6da}
.traka .poziv{flex:1;font-size:8.5pt;line-height:1.35;color:#d3dcea}
.traka .poziv b{color:#fff;font-size:9.5pt}
.qr{background:#fff;border-radius:6px;padding:4px;width:58px;height:58px;flex:none}
.qr svg{display:block;width:50px;height:50px}
h1{font-size:19pt;margin:0 0 2px;letter-spacing:-.01em}
h2{font-size:12pt;margin:12px 0 4px}
.adresa{color:var(--ink2);margin:0 0 10px}
.zaglavlje{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--grid);border-radius:8px;overflow:hidden;margin-bottom:10px}
.zaglavlje div{padding:5px 9px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid)}
.zaglavlje div:nth-child(4n){border-right:none}
.zaglavlje span{display:block;font-size:7.5pt;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
.zaglavlje b{font-weight:600;font-size:9pt}
.zaglavlje .nema{color:var(--mute);font-weight:400;font-style:italic}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 6px}
.kpi div{background:var(--surf);border:1px solid var(--grid);border-radius:8px;padding:9px 12px}
.kpi b{display:block;font-size:16pt;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi span{color:var(--ink2);font-size:8.5pt}
.note{color:var(--ink2);font-size:8.5pt;margin:2px 0 0}
.grid{stroke:var(--grid);stroke-width:1}.base{stroke:#b8b7b2;stroke-width:1}
.prosjek{stroke:#52514e;stroke-width:1.5;stroke-dasharray:4 3}
.ax{font-size:9px;fill:var(--ink2)}.val{font-size:9px;fill:var(--ink);font-variant-numeric:tabular-nums}
.sitno{font-size:7px}.s3.est{fill:url(#srafura3)}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}.s3{fill:var(--s3)}.est{fill:url(#srafura)}
.leg{display:flex;gap:16px;font-size:8.5pt;color:var(--ink2);margin:2px 0 4px}
.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
table{border-collapse:collapse;width:100%;font-size:9pt;font-variant-numeric:tabular-nums}
th,td{padding:2.5px 6px;border-bottom:1px solid var(--grid);text-align:right}
th{color:var(--ink2);font-weight:600}
td:first-child,th:first-child{text-align:left}
.tot td{font-weight:700;border-top:1.5px solid var(--ink);border-bottom:none}
.oc td:last-child,.oc th:last-child{text-align:left}.oc td:first-child{white-space:nowrap}.oc td{font-size:8pt}
.cols{display:grid;grid-template-columns:1.1fr 1fr;gap:18px;margin-top:12px}
.cols li{font-size:8.5pt;margin:2px 0}
ul{padding-left:16px;margin:4px 0}
.pb{break-before:page}
.cta{display:flex;gap:14px;align-items:center;border:1.5px solid var(--marka);border-radius:10px;padding:10px 14px;margin-top:14px;break-inside:avoid}
.cta p{margin:0;font-size:9pt;color:var(--ink2)}.cta b{color:var(--ink)}
.cta .qr{width:64px;height:64px;padding:0}.cta .qr svg{width:64px;height:64px}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute"><defs><pattern id="srafura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#c9d3e3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#002F6C" stroke-width="2.5"/></pattern><pattern id="srafura3" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e3e8f0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9AAAC2" stroke-width="2.5"/></pattern></defs></svg>

<div class="traka">
  <svg class="logo" viewBox="0 0 512 512" role="img" aria-label="DOMOVINA Energy">${logo}</svg>
  <div class="marka"><b>DOMOVINA</b><span>Energy</span> <small>· omm.domovina.ai</small></div>
  <div class="poziv"><b>Koliko zapravo trošiš struje?</b><br>Uvezi potrošnju s HEP-ove Moje mreže ili Mojeg računa i dobij ovakav izvještaj, besplatno.</div>
  <div class="qr">${kod}</div>
</div>

<h1>Potrošnja struje: ${e(p.naslov)}</h1>
<p class="adresa">${e(p.adresa)} · ${e(p.razdoblje)}<br><small>${e(p.izvor)}</small></p>

<div class="zaglavlje">
${p.zaglavlje.map((z) => `<div><span>${e(z.oznaka)}</span>${z.vrijednost ? `<b>${e(z.vrijednost)}</b>` : `<b class="nema">nije upisano</b>`}</div>`).join("")}
</div>

<div class="kpi">${kpi.map(([v, o]) => `<div><b>${e(v)}</b><span>${e(o)}</span></div>`).join("")}</div>
<p class="note">${e(p.sazetak)}</p>

<h2>Potrošnja po mjesecima (kWh)</h2>
<div class="leg"><span><i style="background:var(--s1)"></i>iz očitanja unutar mjeseca</span><span><i style="background:repeating-linear-gradient(45deg,#002F6C 0 2px,#c9d3e3 2px 5px)"></i>raspodijeljeno ravnomjerno (dugi razmak između očitanja ili procjena ODS-a)</span></div>
${stupci(mj.map((x) => [[x.kwh, x.raspodijeljeno ? "s1 est" : "s1"]]), mj.map((x) => x.oznaka), hr)}

<h2>Trošak po mjesecima (€ s PDV-om)</h2>
<div class="leg"><span><i style="background:var(--s1)"></i>energija (${e(p.opskrbljivac)})</span><span><i style="background:var(--s2)"></i>mrežarina + naknada za OIE</span><span><i style="background:var(--s3)"></i>fiksno (opskrba + mjerno mjesto)</span></div>
${stupci(mj.map((x) => [[x.fiksno, "s3"], [x.mreza, "s2"], [x.energija, "s1"]]), mj.map((x) => x.oznaka), hr)}
${rucno}

${usporedba}

<h2 style="margin-top:18px">Tablica po mjesecima</h2>
<table><tr><th>Mjesec</th><th>kWh</th><th>Energija €</th><th>Mreža + OIE €</th><th>Fiksno €</th><th>Ukupno €</th></tr>
${mj.map((x) => `<tr><td>${e(x.mjesec)}</td><td>${hr(x.kwh)}${x.raspodijeljeno ? " *" : ""}</td><td>${hr(x.energija, 2)}</td><td>${hr(x.mreza, 2)}</td><td>${hr(x.fiksno, 2)}</td><td><b>${hr(x.ukupno, 2)}</b></td></tr>`).join("")}
<tr class="tot"><td>Ukupno</td><td>${hr(u.kwh)}</td><td>${hr(u.energija, 2)}</td><td>${hr(u.mreza, 2)}</td><td>${hr(u.fiksno, 2)}</td><td>${hr(u.eur, 2)}</td></tr></table>
<p class="note">* mjesec unutar dugog razmaka između očitanja ili uz procjenu ODS-a; kWh su raspodijeljeni ravnomjerno po danima.${p.dvotarifno ? " kWh = VT (T1) + NT (T2)." : ""}</p>

<div class="cols">
<div><h2 style="margin-top:0">Kako je izračunato</h2><ul>${p.biljeske.map((b) => `<li>${e(b)}</li>`).join("")}</ul></div>
<div><h2 style="margin-top:0">Očitanja</h2><table class="oc"><tr><th>Datum</th><th>T1</th>${p.dvotarifno ? "<th>T2</th>" : ""}<th>Vrsta</th></tr>
${p.ocitanja.map((o) => `<tr><td>${e(o.datum)}</td><td>${jedan(o.t1)}</td>${p.dvotarifno ? `<td>${jedan(o.t2)}</td>` : ""}<td>${e(o.opis)}</td></tr>`).join("")}</table></div>
</div>

<div class="cta">
  <div class="qr">${kod}</div>
  <p><b>DOMOVINA Energy</b> · izrađeno na omm.domovina.ai, ${e(p.izradeno)}<br>Prijaviš se sam na HEP-ov portal, a mi samo pročitamo očitanja i potrošnju. Bez OIB-a, bez lozinki. Skeniraj kod i napravi izvještaj za svoje brojilo.</p>
</div>
</body>
</html>`;
}
