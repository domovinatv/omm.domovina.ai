import type { APIRoute } from "astro";
import { snimciOmm } from "../../../lib/admin/pregled";
import { izvjestaj, NemaPodataka } from "../../../lib/izvjestaj/izracun";
import { odgovorIzvjestaja } from "../../../lib/izvjestaj/odgovor";
import { cjenik } from "../../../lib/izvjestaj/snimci";

/**
 * Izvještaj za bilo koji OMM iz uvoza i očitanja jednog ključa (`?kljuc=`), ili svih (`?svi=1`).
 * Spojeni samo izričito: uvoz šalje korisnik, pa tuđa očitanja mogu ući u ponudu (SEC-07).
 * Isti izračun i izgled kao `/api/izvjestaj/:omm`. `?oblik=pdf|html|json`, `?anonimno=1`.
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!locals.admin) return Response.json({ error: "unauthorized" }, { status: 401 });
  const omm = params.omm ?? "";
  if (!/^\d{10}$/.test(omm)) return new Response("OMM ima 10 znamenki", { status: 400 });
  const kljuc = url.searchParams.get("kljuc");
  if (!kljuc && url.searchParams.get("svi") !== "1") {
    return new Response("Odaberi ključ (?kljuc=) ili izričito spoji sve (?svi=1)", { status: 400 });
  }
  const oblik = url.searchParams.get("oblik") ?? "pdf";
  const anonimno = url.searchParams.get("anonimno") === "1";
  let podaci;
  try {
    podaci = izvjestaj(omm, await snimciOmm(omm, kljuc), await cjenik(), { anonimno });
  } catch (e) {
    if (e instanceof NemaPodataka) return new Response(e.message, { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } });
    throw e;
  }
  if (oblik === "json") return Response.json(podaci);
  return odgovorIzvjestaja(podaci, { omm, oblik: oblik === "html" ? "html" : "pdf", anonimno });
};
