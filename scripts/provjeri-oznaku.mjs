// Provjera da je public/hep-uvoz.js točno ono što je generirao flutter_moja_mreza
// (extension/tools/bookmarklet.mjs): treći redak nosi SHA-256 svega ispod njega.
// Ručna izmjena ovdje ili krivo kopirana datoteka zaustavi build (SEC-10 u
// docs/security/2026-10-16-security-audit-fable.md).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const kod = readFileSync(new URL("../public/hep-uvoz.js", import.meta.url), "utf8");
const redovi = kod.split("\n");
const m = /^\/\/ Izvor (\S+), sha256 ostatka ([0-9a-f]{64})$/.exec(redovi[2] ?? "");
if (!m) {
  console.error("hep-uvoz.js: nema retka s hashom; generiraj ga u flutter_moja_mreza (cd extension && npm run bookmarklet)");
  process.exit(1);
}
const otisak = createHash("sha256").update(redovi.slice(3).join("\n")).digest("hex");
if (otisak !== m[2]) {
  console.error(`hep-uvoz.js: hash se ne slaže (zaglavlje ${m[2].slice(0, 12)}…, sadržaj ${otisak.slice(0, 12)}…); datoteka je mijenjana nakon generiranja`);
  process.exit(1);
}
if (m[1].endsWith("+izmjene")) console.warn(`hep-uvoz.js: generiran iz necommitanog stanja (${m[1]})`);
console.log(`hep-uvoz.js: izvor ${m[1]}, hash u redu`);
