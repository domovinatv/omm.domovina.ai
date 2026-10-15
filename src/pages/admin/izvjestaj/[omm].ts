import type { APIRoute } from "astro";
import { snimciOmm } from "../../../lib/admin/pregled";
import { izvjestaj, NemaPodataka } from "../../../lib/izvjestaj/izracun";
import { odgovorIzvjestaja } from "../../../lib/izvjestaj/odgovor";
import { cjenik } from "../../../lib/izvjestaj/snimci";

/**
 * Izvještaj za bilo koji OMM, iz uvoza i očitanja svih korisnika (ili `?kljuc=` jednog).
 * Isti izračun i izgled kao `/api/izvjestaj/:omm`. `?oblik=pdf|html|json`, `?anonimno=1`.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const omm = params.omm ?? "";
  if (!/^\d{10}$/.test(omm)) return new Response("OMM ima 10 znamenki", { status: 400 });
  const kljuc = url.searchParams.get("kljuc");
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
  return odgovorIzvjestaja(podaci, { omm, oblik: oblik === "html" ? "html" : "pdf", anonimno, origin: url.origin });
};
