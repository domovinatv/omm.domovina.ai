/**
 * Čitanje zaslona brojila (Iskra i sl.) vision modelom na Workers AI.
 *
 * Brojilo izmjenjuje registre na zaslonu, pa je na jednoj slici obično samo
 * jedan: 1.8.1 (tarifa 1, viša) ili 1.8.2 (tarifa 2, niža). Klijent šalje
 * jednu ili dvije slike i spaja rezultate. Rezultat je prijedlog: korisnik ga
 * uvijek potvrđuje prije spremanja ili slanja HEP-u.
 */

export interface Registar {
  obis: string; // npr. "1.8.1"
  vrijednost: number; // kWh, s decimalama kako piše na zaslonu
}

export interface OcrRezultat {
  registri: Registar[];
  napomena?: string;
  model: string;
  sirovo: string;
}

const UPUTA = `Na slici je zaslon električnog brojila (najčešće Iskra MT174/AM550 u Hrvatskoj).
Pročitaj registre energije koji se vide. Oznake registara (OBIS):
- 1.8.1 ili 1.8.1.0 ili 01.8.1 = tarifa 1 (viša, VT)
- 1.8.2 ili 1.8.2.0 ili 01.8.2 = tarifa 2 (niža, NT)
- 1.8.0 = ukupno; 2.8.x = predana energija (proizvodnja)
- 0.9.1 je vrijeme, 0.9.2 datum: to NISU registri energije, ne vraćaj ih.
Vrijednost je u kWh i može imati vodeće nule i decimalni dio (npr. 0015283.4).
Na Iskra AM550 zadnja od 8 znamenki je decimala (00154365 = 15436.5).
Ako oznaka registra nije vidljiva, ne nagađaj: stavi "obis": "?".
Ako je ijedna znamenka mutna, prekrivena odsjajem ili nesigurna, NE vraćaj tu
vrijednost: ostavi "registri" prazan i u "napomena" napiši da treba oštrija slika.
Pogrešan broj je gori od nikakvog.
Odgovori SAMO JSON-om, bez ikakvog drugog teksta:
{"registri":[{"obis":"1.8.1","vrijednost":15283.4}],"napomena":"kratko, ako je nešto nečitljivo"}`;

function izvuciJson(tekst: string): { registri?: unknown; napomena?: unknown } | null {
  const s = tekst.indexOf("{");
  const e = tekst.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(tekst.slice(s, e + 1));
  } catch {
    return null;
  }
}

function normalizirajObis(o: string): string {
  const m = /(\d)\.8\.(\d)/.exec(o);
  return m ? `${m[1]}.8.${m[2]}` : o.trim() || "?";
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export async function procitaj(
  ai: Ai,
  model: string,
  slika: Uint8Array,
  mime = "image/jpeg",
): Promise<OcrRezultat> {
  const odgovor = (await ai.run(model as keyof AiModels, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: UPUTA },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64(slika)}` } },
        ],
      },
    ],
    max_tokens: 1500,
    temperature: 0,
    // Modeli s razmišljanjem (Gemma 4, Qwen 3) inače potroše tokene prije
    // odgovora; Mistral i Llama taj parametar odbijaju.
    ...(/gemma|qwen/.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  } as never)) as { response?: unknown; choices?: { message?: { content?: string | null } }[] };

  // Stariji modeli vraćaju `response`, noviji OpenAI oblik s `choices`.
  const r = odgovor.response;
  const sirovo =
    typeof r === "string"
      ? r
      : r != null
        ? JSON.stringify(r)
        : (odgovor.choices?.[0]?.message?.content ?? JSON.stringify(odgovor).slice(0, 2000));
  const parsed = typeof r === "object" && r !== null ? (r as ReturnType<typeof izvuciJson>) : izvuciJson(sirovo);

  const registri: Registar[] = [];
  if (parsed && Array.isArray(parsed.registri)) {
    for (const x of parsed.registri as { obis?: unknown; vrijednost?: unknown }[]) {
      const v = typeof x.vrijednost === "number" ? x.vrijednost : parseFloat(String(x.vrijednost ?? "").replace(",", "."));
      if (Number.isFinite(v)) registri.push({ obis: normalizirajObis(String(x.obis ?? "?")), vrijednost: v });
    }
  }
  return {
    registri,
    napomena: typeof parsed?.napomena === "string" ? parsed.napomena : undefined,
    model,
    sirovo,
  };
}

/** HEP prima cijele kWh: decimale se odbacuju, ne zaokružuju. */
export const kwh = (v: number) => Math.floor(v);
