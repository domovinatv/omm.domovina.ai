import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../lib/dnevnik";
import { greska, json, noviId, opcije, uredaj } from "../../lib/http";
import { kwh, procitaj } from "../../lib/ocr";
import { usporedi, zadnjeStanje } from "../../lib/usporedba";

/**
 * POST multipart `slika` (jedna slika zaslona) → prijedlog 1.8.1 / 1.8.2.
 * Slika se sprema u R2 da se OCR kasnije može provjeriti; ključ se vraća pa ga
 * klijent šalje uz snimak.
 */
function vrstaSlike(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);

  const forma = await request.formData().catch(() => null);
  const slika = forma?.get("slika");
  const ommPolje = forma?.get("omm");
  const omm = typeof ommPolje === "string" && /^\d{10}$/.test(ommPolje) ? ommPolje : null;
  if (!(slika instanceof File)) return greska("Pošalji sliku u polju 'slika'");
  // Klijent šalje JPEG do 1600 px (ocitaj.astro), ~0,5 MB; 3 MB je rezerva za aplikaciju.
  if (slika.size > 3 * 1024 * 1024) return greska("Slika je veća od 3 MB", 413);

  const bajtovi = new Uint8Array(await slika.arrayBuffer());
  // Vrsta po sadržaju, ne po zaglavlju: Dartov http šalje application/octet-stream.
  const mime = vrstaSlike(bajtovi);
  if (!mime) {
    await zapisi(request, { uredaj: kljuc, vrsta: "ocitaj", ishod: "greska", tijelo: { greska: "nije JPEG/PNG/WebP", poslano_kao: slika.type } });
    return greska("Slika mora biti JPEG, PNG ili WebP", 415);
  }
  const r2 = `${kljuc}/${noviId()}.${mime === "image/png" ? "png" : "jpg"}`;
  await env.SLIKE.put(r2, bajtovi, { httpMetadata: { contentType: mime } });

  try {
    // `model` u formi služi za usporedbu modela, samo s popisa OCR_MODELI (SEC-02).
    const zatrazen = forma?.get("model");
    const dopusteni = env.OCR_MODELI.split(",").map((m) => m.trim()).filter(Boolean);
    const model = typeof zatrazen === "string" && dopusteni.includes(zatrazen) ? zatrazen : env.OCR_MODEL;
    const r = await procitaj(env.AI, model, bajtovi, mime);
    let t1: number | null = r.registri.find((x) => x.obis === "1.8.1")?.vrijednost ?? null;
    let t2: number | null = r.registri.find((x) => x.obis === "1.8.2")?.vrijednost ?? null;
    // Vrijednost bez sigurne oznake tarife (npr. "?" ili 1.8.0): klijent je
    // stavlja u prvo prazno polje i upozori korisnika.
    let neodredeno: number | null =
      t1 == null && t2 == null ? (r.registri.find((x) => !x.obis.startsWith("2."))?.vrijednost ?? null) : null;

    // Usporedba sa zadnjim poznatim stanjem: ispravlja zarez i određuje tarifu.
    const zadnje = await zadnjeStanje(kljuc, omm);
    const usporedba = zadnje ? usporedi(r.registri, zadnje) : null;
    if (usporedba) {
      for (const p of usporedba.prijedlozi) {
        if (p.tarifa === "t1") t1 = p.vrijednost;
        else t2 = p.vrijednost;
      }
      if (usporedba.prijedlozi.length) neodredeno = null;
    }
    const upozorenja = [
      ...(usporedba?.upozorenja ?? []),
      ...(usporedba?.prijedlozi ?? []).flatMap((p) => [
        ...(p.ispravljenZarez ? [`Model je pročitao ${p.procitano}; prema zadnjem stanju to je ${p.vrijednost}.`] : []),
        ...(p.tarifaPoUsporedbi ? [`Oznaka tarife nije vidljiva; po zadnjem stanju je ${p.tarifa === "t1" ? "1.8.1" : "1.8.2"}.`] : []),
      ]),
    ];
    await zapisi(request, {
      uredaj: kljuc,
      vrsta: "ocitaj",
      ishod: "ok",
      tijelo: { slika: r2, model, registri: r.registri, napomena: r.napomena, zadnje, usporedba },
    });
    return json({
      slika: r2,
      t1: t1 == null ? null : kwh(t1),
      t2: t2 == null ? null : kwh(t2),
      neodredeno: neodredeno == null ? null : kwh(neodredeno),
      zadnje,
      usporedba: usporedba?.prijedlozi ?? [],
      upozorenja,
      registri: r.registri,
      napomena: r.napomena ?? null,
      model: r.model,
      sirovo: r.sirovo,
    });
  } catch (e) {
    await zapisi(request, { uredaj: kljuc, vrsta: "ocitaj", ishod: "greska", tijelo: { slika: r2, greska: String(e) } });
    return json({ slika: r2, t1: null, t2: null, registri: [], greska: `OCR nije uspio: ${e}` }, 502);
  }
};

export const OPTIONS: APIRoute = opcije;
