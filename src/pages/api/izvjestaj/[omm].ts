import type { APIRoute } from "astro";
import { izvjestaj, NemaPodataka } from "../../../lib/izvjestaj/izracun";
import { odgovorIzvjestaja } from "../../../lib/izvjestaj/odgovor";
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
  return odgovorIzvjestaja(podaci, { omm, oblik: oblik === "html" ? "html" : "pdf", anonimno, origin: url.origin, zaglavlja: CORS });
};

export const OPTIONS: APIRoute = opcije;
