import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import { html, PODNOZJE } from "../../../lib/izvjestaj/html";
import { izvjestaj, NemaPodataka } from "../../../lib/izvjestaj/izracun";
import { cjenik, snimciKljuca } from "../../../lib/izvjestaj/snimci";
import { CORS, greska, json, opcije, uredaj } from "../../../lib/http";

/**
 * GET godišnji izvještaj potrošnje za OMM, računa se pri svakom zahtjevu iz svih
 * uvoza i očitanja ovog ključa, pa uvijek uključuje zadnje očitanje.
 * `?oblik=pdf` (zadano) | `html` | `json`, `?anonimno=1` za dijeljenje.
 * PDF slaže Browser Rendering iz iste HTML stranice.
 */
export const GET: APIRoute = async ({ request, params, url }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const omm = params.omm ?? "";
  if (!/^\d{10}$/.test(omm)) return greska("OMM ima 10 znamenki");
  const oblik = url.searchParams.get("oblik") ?? "pdf";
  const anonimno = url.searchParams.get("anonimno") === "1";

  let podaci;
  try {
    podaci = izvjestaj(omm, await snimciKljuca(kljuc), await cjenik(), { anonimno });
  } catch (e) {
    if (e instanceof NemaPodataka) return greska(e.message, 422);
    throw e;
  }
  if (oblik === "json") return json(podaci);

  const font = (w: number) => `${url.origin}/fonts/Inter-${w}.ttf`;
  if (oblik === "html") {
    const stranica = html(podaci, { 400: font(400), 600: font(600), 700: font(700) });
    return new Response(stranica, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
  }
  const ugradi = async (w: number) => {
    const r = await env.ASSETS.fetch(font(w));
    return `data:font/ttf;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  };
  const [f400, f600, f700] = await Promise.all([ugradi(400), ugradi(600), ugradi(700)]);
  const stranica = html(podaci, { 400: f400, 600: f600, 700: f700 });

  const preglednik = await puppeteer.launch(env.BROWSER);
  try {
    const tab = await preglednik.newPage();
    await tab.setContent(stranica, { waitUntil: "networkidle0" });
    const pdf = await tab.pdf({
      format: "A4", printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: PODNOZJE,
    });
    // Anonimna verzija se dijeli, pa ni ime datoteke ne nosi OMM.
    const ime = anonimno ? `Potrosnja-struje-${podaci.od}-anonimno.pdf` : `Potrosnja-${omm}-${podaci.od}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${ime}"`, ...CORS },
    });
  } finally {
    await preglednik.close();
  }
};

export const OPTIONS: APIRoute = opcije;
