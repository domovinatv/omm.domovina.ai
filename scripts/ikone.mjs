// Ikone kao font: Material Symbols Sharp (ikone/, Apache 2.0, ravno odrezani krajevi kao znak).
//
//   node scripts/ikone.mjs --puno       → public/ikone: cijeli font + CSS za sve ikone (development)
//   node scripts/ikone.mjs <mapa>       → <mapa>: samo ikone koje se koriste u src/ (deploy)
//
// U kodu se ikona piše kao klasa `i i-<ime>` (npr. `<i class="i i-bolt" aria-hidden="true"></i>`
// ili `ikona("i-check")`), uvijek cijelim imenom, jer ova skripta imena traži u izvoru.
// Za deploy se font fiksira na FILL 1, wght 400, GRAD 0, opsz 24 i reže na korištene znakove.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import subsetFont from "subset-font";

const FONT = "ikone/MaterialSymbolsSharp.woff2";
const KODOVI = "ikone/MaterialSymbolsSharp.codepoints";
const OSI = { FILL: 1, wght: 400, GRAD: 0, opsz: 24 };

const kodovi = new Map(
  (await readFile(KODOVI, "utf8")).trim().split("\n").map((r) => r.split(" ")).map(([ime, kod]) => [ime, kod]),
);

const css = (imena) => `/* Generirano: scripts/ikone.mjs. Ne mijenjati ručno. */
@font-face { font-family: "Ikone"; font-style: normal; font-weight: 400; font-display: block;
  src: url("ikone.woff2") format("woff2"); }
.i { font-family: "Ikone"; font-style: normal; font-weight: normal; font-size: 1.15em; line-height: 1;
  display: inline-block; vertical-align: -0.2em; letter-spacing: normal; text-transform: none;
  white-space: nowrap; direction: ltr; -webkit-font-smoothing: antialiased; speak: never;
  font-variation-settings: "FILL" ${OSI.FILL}, "wght" ${OSI.wght}, "GRAD" ${OSI.GRAD}, "opsz" ${OSI.opsz}; }
${imena.map((ime) => `.i-${ime}::before { content: "\\${kodovi.get(ime)}"; }`).join("\n")}
`;

async function* datoteke(mapa) {
  for (const d of await readdir(mapa, { withFileTypes: true })) {
    const p = join(mapa, d.name);
    if (d.isDirectory()) yield* datoteke(p);
    else if ([".astro", ".ts", ".js", ".mjs", ".tsx"].includes(extname(d.name))) yield p;
  }
}

const font = await readFile(FONT);
const arg = process.argv[2];

if (arg === "--puno") {
  await mkdir("public/ikone", { recursive: true });
  await writeFile("public/ikone/ikone.woff2", font);
  await writeFile("public/ikone/ikone.css", css([...kodovi.keys()]));
  console.log(`ikone: cijeli font (${kodovi.size} ikona, ${(font.length / 1024).toFixed(0)} kB) u public/ikone`);
} else if (arg) {
  const korištene = new Set();
  const nepoznate = new Set();
  for await (const p of datoteke("src")) {
    for (const [, ime] of (await readFile(p, "utf8")).matchAll(/(?<![\w-])i-([a-z0-9_]+)/g)) {
      (kodovi.has(ime) ? korištene : nepoznate).add(ime);
    }
  }
  if (nepoznate.size) console.warn(`ikone: nema u fontu, preskačem: ${[...nepoznate].join(", ")}`);
  const imena = [...korištene].sort();
  const tekst = imena.map((ime) => String.fromCodePoint(parseInt(kodovi.get(ime), 16))).join("");
  const mali = await subsetFont(font, tekst, { targetFormat: "woff2", variationAxes: OSI });
  await mkdir(arg, { recursive: true });
  await writeFile(join(arg, "ikone.woff2"), mali);
  await writeFile(join(arg, "ikone.css"), css(imena));
  console.log(`ikone: ${imena.length} ikona, ${(mali.length / 1024).toFixed(1)} kB u ${arg} (${imena.join(", ")})`);
} else {
  console.error("Upotreba: node scripts/ikone.mjs --puno | <izlazna mapa>");
  process.exit(1);
}
