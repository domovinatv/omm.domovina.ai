// Generirano iz github.com/stepanic/flutter_moja_mreza (extension/tools/bookmarklet.mjs).
// Ne mijenjati ovdje: izvor su extension/uvoz.js, mojracun.js, hepi.js i bookmarklet.js.
// ---- uvoz.js ----
// Uvoz s Moje mreže (https://mojamreza.hep.hr) u pregledniku.
//
// Isti tok i isti JSON kao FlutterMojaMreza.uvezi() / HepUvoz.toJson() u
// pluginu, a parsiranje je prijepis lib/src/parser.dart. Radi samo u kontekstu
// stranice mojamreza.hep.hr (fetch je same-origin, ide s cookiejima sesije).
//
// Extension ovu datoteku ubacuje u karticu (chrome.scripting) i zove
// mojaMrezaUvoz(). Može se i zalijepiti u konzolu prijavljene stranice:
//   await mojaMrezaUvoz()

// Sve je u IIFE-u jer extension datoteku može ubaciti u istu karticu više puta.
(() => {
  class MojaMrezaIznimka extends Error {
    /** @param {'sesijaIstekla'|'neocekivanHtml'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const MojaMrezaParser = (() => {
    const tekst = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const znamenke = (s) => (s == null ? null : s.replace(/\D/g, ''));

    // `1.234` i `1 234` su tisuće; HEP daje cijele kWh.
    const broj = (s) => {
      const z = znamenke(s);
      return z == null || z === '' ? null : parseInt(z, 10);
    };

    // `dd.mm.yyyy.` → `yyyy-mm-dd`.
    const datum = (s) => {
      const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '');
      if (!m) return null;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };

    const dokument = (izvor) =>
      typeof izvor === 'string' ? new DOMParser().parseFromString(izvor, 'text/html') : izvor;

    // Prva tablica čiji thead sadrži sve obavezne stupce. Stupci se traže po
    // nazivu (početak, mala slova), ne po indeksu.
    function tablica(d, obavezni) {
      for (const t of d.querySelectorAll('table')) {
        const stupci = new Map();
        t.querySelectorAll('thead th').forEach((th, i) => stupci.set(tekst(th).toLowerCase(), i));
        const kljucevi = [...stupci.keys()];
        if (!obavezni.every((o) => kljucevi.some((k) => k.startsWith(o)))) continue;

        const retci = [...t.querySelectorAll('tbody tr')]
          // Prvi stupac retka je često <th scope="row"> (OMM na /Postavke,
          // ikona statusa na /Ocitanja), pa se broje i th i td.
          .map((tr) => [...tr.children].filter((c) => /^t[hd]$/i.test(c.tagName)).map(tekst))
          .filter((r) => r.some(Boolean));

        const celija = (redak, naziv) => {
          const k = kljucevi.find((k) => k.startsWith(naziv));
          const v = k == null ? undefined : redak[stupci.get(k)];
          return v ? v : null;
        };
        return { retci, celija };
      }
      throw new MojaMrezaIznimka('neocekivanHtml', `nema tablice sa stupcima ${obavezni.join(', ')}`);
    }

    return {
      /** `/Postavke`: svi OMM-ovi prijavljene osobe. OIB se namjerno ne uzima. */
      postavke(izvor) {
        const t = tablica(dokument(izvor), ['omm', 'broj brojila']);
        return t.retci
          .map((r) => ({
            omm: znamenke(t.celija(r, 'omm')),
            broj_brojila: t.celija(r, 'broj brojila'),
            korisnik: t.celija(r, 'korisnik'),
            adresa: t.celija(r, 'adresa'),
            tarifni_model: t.celija(r, 'tarifni model'),
          }))
          .filter((o) => o.omm);
      },

      /** `/Ocitanja`: stanja brojila, najnovije prvo. */
      ocitanja(izvor) {
        const t = tablica(dokument(izvor), ['datum', 'tarifa 1']);
        return t.retci
          .map((r) => ({
            datum: datum(t.celija(r, 'datum')),
            opis: t.celija(r, 'opis') || '',
            t1_kwh: broj(t.celija(r, 'tarifa 1')),
            t2_kwh: broj(t.celija(r, 'tarifa 2')),
          }))
          .filter((o) => o.datum);
      },

      /** `/Potrosnja`: potrošnja po obračunskim razdobljima, najnovije prvo. */
      potrosnja(izvor) {
        const t = tablica(dokument(izvor), ['razdoblje', 'tarifa 1']);
        const re = /(\d{1,2}\.\d{1,2}\.\d{4})\.?\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/;
        return t.retci.flatMap((r) => {
          const m = re.exec(t.celija(r, 'razdoblje') || '');
          if (!m) return [];
          const t1 = broj(t.celija(r, 'tarifa 1'));
          const t2 = broj(t.celija(r, 'tarifa 2'));
          return [{ od: datum(m[1]), do: datum(m[2]), t1_kwh: t1, t2_kwh: t2, ukupno_kwh: (t1 || 0) + (t2 || 0) }];
        });
      },

      /** OMM odabran u select#omm_select, ili null ako ga nema. */
      odabraniOmm(izvor) {
        const select = dokument(izvor).querySelector('#omm_select');
        if (!select) return null;
        const o = select.querySelector('option[selected]') || select.querySelector('option');
        return znamenke(o ? o.getAttribute('value') : null);
      },
    };
  })();

  /**
   * Uvoz svih OMM-ova prijavljene osobe s očitanjima i potrošnjom.
   * @param {{ocitanja?: boolean, potrosnja?: boolean, napredak?: (poruka: string) => void}} [opcije]
   */
  async function mojaMrezaUvoz({ ocitanja = true, potrosnja = true, napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojamreza.hep.hr') {
      throw new MojaMrezaIznimka('mreza', 'pokreni na https://mojamreza.hep.hr');
    }

    // HTML stranice, uz provjeru da je sesija živa i da je odabran omm.
    async function stranica(putanja, omm) {
      let odgovor;
      try {
        odgovor = await fetch(omm ? `${putanja}?omm=${encodeURIComponent(omm)}` : putanja, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (e) {
        throw new MojaMrezaIznimka('mreza', String(e));
      }
      // Neprijavljen zahtjev server preusmjerava na naslovnicu.
      if (new URL(odgovor.url).pathname === '/') throw new MojaMrezaIznimka('sesijaIstekla');
      if (odgovor.status !== 200) {
        throw new MojaMrezaIznimka('mreza', `HTTP ${odgovor.status} za ${putanja}`);
      }
      const html = await odgovor.text();
      if (omm) {
        const odabran = MojaMrezaParser.odabraniOmm(html);
        if (odabran && odabran !== omm) {
          throw new MojaMrezaIznimka('neocekivanHtml', `${putanja}?omm=${omm} vratio je OMM ${odabran}`);
        }
      }
      return html;
    }

    napredak('Dohvaćam mjerna mjesta…');
    const omms = MojaMrezaParser.postavke(await stranica('/Postavke'));
    const mjesta = [];
    for (const [i, omm] of omms.entries()) {
      napredak(`OMM ${omm.omm}${omms.length > 1 ? ` (${i + 1}/${omms.length})` : ''}…`);
      mjesta.push({
        ...omm,
        ocitanja: ocitanja ? MojaMrezaParser.ocitanja(await stranica('/Ocitanja', omm.omm)) : [],
        potrosnja: potrosnja ? MojaMrezaParser.potrosnja(await stranica('/Potrosnja', omm.omm)) : [],
      });
    }
    return { izvor: 'https://mojamreza.hep.hr', dohvaceno: new Date().toISOString(), mjesta };
  }

  const izvoz = { MojaMrezaParser, MojaMrezaIznimka, mojaMrezaUvoz };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- mojracun.js ----
// Uvoz s Mojeg računa HEP Elektre (https://mojracun.hep.hr/elektra) u pregledniku.
//
// Moj račun je Angular aplikacija s JSON API-jem na /elektra/v1/api/…, pa se
// ovdje ne parsira HTML tablica nego JSON. Parser je prijepis
// lib/src/moj_racun.dart i daje isti JSON kao MojRacunUvoz.toJson().
//
// Popis kupaca stiže samo u odgovoru prijave i ostaje u memoriji aplikacije
// (nema GET rute za njega). Zato se kupacId čita iz zahtjeva koje je stranica
// već poslala (Resource Timing), a ime, OMM i adresa iz zaglavlja „Kupac“.
// OIB se ne uzima.
//
// Extension ubacuje datoteku u karticu i zove mojRacunUvoz(); može se i
// zalijepiti u konzolu prijavljene stranice.

(() => {
  class MojRacunIznimka extends Error {
    /** @param {'sesijaIstekla'|'nemaKupca'|'neocekivanOdgovor'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const MojRacunParser = (() => {
    const prazno = (v) => (v == null || v === '' ? null : v);
    const tekst = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // API daje `2026-10-01T01:59:00Z` (rano jutro po našem vremenu) ili
    // `…+02:00`; datum je prvih 10 znakova.
    const datum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null);

    // `dd.mm.yyyy` → `yyyy-mm-dd`.
    const hrDatum = (s) => {
      const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '');
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    };

    const lista = (j, sto) => {
      if (!Array.isArray(j)) throw new MojRacunIznimka('neocekivanOdgovor', `${sto} nije lista`);
      return j;
    };

    return {
      /** `api/ocitanja/{kupacId}`: stanja brojila, najnovije prvo. */
      ocitanja: (j) =>
        lista(j, 'ocitanja')
          .map((o) => ({
            datum: datum(o.datum),
            opis: o.nacinOcitanja || '',
            t1_kwh: o.tarifa1 ?? null,
            t2_kwh: o.tarifa2 ?? null,
          }))
          .filter((o) => o.datum),

      /** `api/potrosnja/{kupacId}`: razdoblja, najnovije prvo; proizv = predano u mrežu. */
      potrosnja: (j) =>
        lista(j, 'potrosnja').flatMap((p) => {
          const [od, doDatuma] = (p.razdoblje || '').split('-').map(hrDatum);
          if (!od || !doDatuma) return [];
          const t1 = p.tarifa1 ?? null;
          const t2 = p.tarifa2 ?? null;
          return [{
            od,
            do: doDatuma,
            t1_kwh: t1,
            t2_kwh: t2,
            ukupno_kwh: (t1 || 0) + (t2 || 0),
            predano_t1_kwh: p.proizv1 ?? 0,
            predano_t2_kwh: p.proizv2 ?? 0,
          }];
        }),

      /** `api/promet/{kupacId}`: računi i uplate, najnovije prvo, i dospjeli dug. */
      promet(j) {
        if (!j || !Array.isArray(j.promet)) throw new MojRacunIznimka('neocekivanOdgovor', 'promet bez liste');
        return {
          stavke: j.promet
            .map((s) => {
              const racun = s.opis === 'Račun';
              return {
                datum: datum(s.datum),
                opis: s.opis || '',
                duguje_eur: s.duguje ?? 0,
                potrazuje_eur: s.potrazuje ?? 0,
                // Kod uplata server ovdje vraća trenutno vrijeme, ne rok.
                dospijeva: racun ? datum(s.dospijeva) : null,
                poziv_na_broj: prazno(s.pnb),
                racun: prazno(s.racun),
                status: prazno(s.status),
              };
            })
            .filter((s) => s.datum),
          saldo: j.saldo ? { iznos_eur: j.saldo.iznos ?? null, opis: tekst(j.saldo.opis) } : null,
        };
      },

      /** Zaglavlje „Kupac“ (app-kupac-list): odabrani kupac. */
      zaglavlje(izvor) {
        const d = typeof izvor === 'string' ? new DOMParser().parseFromString(izvor, 'text/html') : izvor;
        const k = d.querySelector('app-kupac-list');
        if (!k) return null;
        const t = tekst(k.textContent);
        const naziv = k.querySelector('.ng-value-label');
        return {
          ime: naziv ? tekst(naziv.textContent) || null : null,
          ugovorni_racun: (/Ugovorni račun:\s*(\d+)/.exec(t) || [])[1] || null,
          omm: (/Broj OMM:\s*(\d+)/.exec(t) || [])[1] || null,
          adresa: tekst((/Adresa:\s*(.+)$/.exec(t) || [])[1]) || null,
        };
      },

      /** kupacId iz URL-ova API zahtjeva, zadnje korišteni zadnji. */
      kupacIds(urlovi) {
        const ids = [];
        for (const u of urlovi) {
          const m = /\/api\/(?:promet|potrosnja|ocitanja|opomene|obracun)\/(\d+)(?:$|[?#])/.exec(u);
          if (!m) continue;
          const i = ids.indexOf(m[1]);
          if (i >= 0) ids.splice(i, 1);
          ids.push(m[1]);
        }
        return ids;
      },
    };
  })();

  /** @param {{napredak?: (poruka: string) => void}} [opcije] */
  async function mojRacunUvoz({ napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojracun.hep.hr' || !location.pathname.startsWith('/elektra')) {
      throw new MojRacunIznimka('mreza', 'pokreni na https://mojracun.hep.hr/elektra');
    }
    if (location.pathname.startsWith('/elektra/login')) throw new MojRacunIznimka('sesijaIstekla');

    async function api(putanja) {
      let o;
      try {
        o = await fetch(`/elektra/v1/api/${putanja}`, { credentials: 'same-origin', cache: 'no-store' });
      } catch (e) {
        throw new MojRacunIznimka('mreza', String(e));
      }
      if (o.status === 401 || o.status === 403) throw new MojRacunIznimka('sesijaIstekla');
      if (o.status !== 200) throw new MojRacunIznimka('mreza', `HTTP ${o.status} za ${putanja}`);
      try {
        return await o.json();
      } catch {
        throw new MojRacunIznimka('neocekivanOdgovor', `${putanja} nije JSON`);
      }
    }

    const kupacIdsSada = () => MojRacunParser.kupacIds(performance.getEntriesByType('resource').map((e) => e.name));
    let ids = kupacIdsSada();
    if (ids.length === 0) {
      // Naslovnica nakon prijave još nije tražila ništa s kupacId. Potrošnja
      // hoće, pa se na nju prelazi Angularovim routerom, bez učitavanja
      // stranice (učitavanje bi prekinulo ovaj kod): klik na poveznicu, a bez
      // nje pushState + popstate, koji router također sluša.
      napredak('Otvaram Potrošnju…');
      const poveznica = [...document.querySelectorAll('a[href]')].find((a) => /\/potrosnja\/?$/.test(a.pathname));
      if (poveznica) poveznica.click();
      else {
        history.pushState(null, '', '/elektra/potrosnja');
        dispatchEvent(new PopStateEvent('popstate', { state: null }));
      }
      for (let i = 0; i < 40 && ids.length === 0; i++) {
        await new Promise((ok) => setTimeout(ok, 250));
        ids = kupacIdsSada();
      }
      // Zaglavlje „Kupac“ se iscrta tek nakon odgovora.
      await new Promise((ok) => setTimeout(ok, 600));
    }
    if (ids.length === 0) throw new MojRacunIznimka('nemaKupca');
    // Zaglavlje pokazuje kupca čiji su podaci zadnji učitani.
    const odabran = ids[ids.length - 1];
    const zaglavlje = MojRacunParser.zaglavlje(document);

    const kupci = [];
    for (const [i, id] of ids.entries()) {
      napredak(`Kupac ${id}${ids.length > 1 ? ` (${i + 1}/${ids.length})` : ''}…`);
      const promet = MojRacunParser.promet(await api(`promet/${id}`));
      kupci.push({
        kupac_id: id,
        ...(id === odabran && zaglavlje ? zaglavlje : { ime: null, ugovorni_racun: null, omm: null, adresa: null }),
        saldo: promet.saldo,
        ocitanja: MojRacunParser.ocitanja(await api(`ocitanja/${id}`)),
        potrosnja: MojRacunParser.potrosnja(await api(`potrosnja/${id}`)),
        promet: promet.stavke,
      });
    }
    return { izvor: 'https://mojracun.hep.hr', dohvaceno: new Date().toISOString(), kupci };
  }

  const izvoz = { MojRacunParser, MojRacunIznimka, mojRacunUvoz };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- hepi.js ----
// Uvoz s Mojeg Hepi računa (https://mojracun.hep.hr/hepi), portala HEP Opskrbe
// za kupce na tržištu. Zaseban od Mojeg računa HEP Elektre (/elektra), sa
// zasebnom prijavom.
//
// Hepi je AngularJS aplikacija s JSON API-jem na /hepi/api/…. Prijava sprema
// token u localStorage['hepi.token'] i stranica ga šalje kao Bearer; ovaj kod
// radi isto, ali token nikad ne napušta stranicu. Za razliku od Elektre
// postoji GET /api/kupci, pa ne treba Resource Timing, a /api/report/racun
// vraća PDF računa. OIB i mail se ne uzimaju.
//
// Bookmarklet ubacuje datoteku u karticu i zove hepiUvoz(); može se i
// zalijepiti u konzolu prijavljene stranice.

(() => {
  class HepiIznimka extends Error {
    /** @param {'sesijaIstekla'|'neocekivanOdgovor'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const HepiParser = (() => {
    const prazno = (v) => (v == null || v === '' ? null : v);
    // API daje `2026-09-30T02:00:00+02:00` (ponoć po našem vremenu); datum je prvih 10 znakova.
    const datum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') && !String(s).startsWith('0001') ? s.slice(0, 10) : null);
    // `01.09.2026-30.09.2026` → { od, do }.
    const razdoblje = (s) => {
      const m = /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(s || '');
      return m ? { od: `${m[3]}-${m[2]}-${m[1]}`, do: `${m[6]}-${m[5]}-${m[4]}` } : { od: null, do: null };
    };
    const lista = (j, sto) => {
      if (!Array.isArray(j)) throw new HepiIznimka('neocekivanOdgovor', `${sto} nije lista`);
      return j;
    };

    /** GET /api/kupci: objekt { kupacId: kupac }. */
    function kupci(j) {
      if (!j || typeof j !== 'object') throw new HepiIznimka('neocekivanOdgovor', 'kupci nisu objekt');
      return Object.values(j).map((k) => ({
        kupac_id: String(k.KupacId),
        sifra_kupca: prazno(k.Sifra),
        ime: prazno(k.Naziv),
        omm: prazno(k.Omm),
        adresa: prazno(k.AdresaOmm) || prazno(k.Adresa),
        tarifni_model: prazno(k.TarifniModel),
        ugovor_od: datum(k.UgovorOd),
      }));
    }

    /** GET /api/potrosnja/:kupacId: { Total, Potrosnja[], Ocitanja[] }, najnovije prvo. */
    function potrosnja(j) {
      return {
        potrosnja: lista(j && j.Potrosnja, 'Potrosnja').map((p) => ({
          ...razdoblje(p.Razdoblje),
          t1_kwh: p.Tarifa1,
          t2_kwh: p.Tarifa2,
          ukupno_kwh: p.Ukupno,
        })),
        ocitanja: lista(j && j.Ocitanja, 'Ocitanja').map((o) => ({
          datum: datum(o.Datum),
          opis: prazno(o.NacinOcitanja),
          t1_kwh: o.Tarifa1,
          t2_kwh: o.Tarifa2,
        })),
      };
    }

    /** GET /api/promet/:kupacId: { Total (saldo), Racuni[], Uplate[] }. */
    function promet(j) {
      const t = (j && j.Total) || {};
      return {
        saldo: { iznos_eur: typeof t.Iznos === 'number' ? t.Iznos : null, opis: prazno(t.Labela) },
        racuni: lista(j && j.Racuni, 'Racuni').map((r) => ({
          datum: datum(r.Datum),
          poziv_na_broj: prazno(r.Pnb),
          iznos_eur: r.Iznos,
          dospijeva: datum(r.Dospijeva),
          placen: r.Status === 1,
          status: prazno(r.StatusText),
          link: prazno(r.Link),
        })),
        uplate: lista(j && j.Uplate, 'Uplate').map((u) => ({ datum: datum(u.Datum), iznos_eur: u.Iznos })),
      };
    }

    return { kupci, potrosnja, promet };
  })();

  function token() {
    let t = null;
    try { t = localStorage.getItem('hepi.token'); } catch {}
    if (!t || t === 'undefined') throw new HepiIznimka('sesijaIstekla');
    return t;
  }

  async function zahtjev(putanja, opcije = {}) {
    let o;
    try {
      o = await fetch(`/hepi/api/${putanja}`, {
        cache: 'no-store',
        ...opcije,
        headers: { Authorization: `Bearer ${token()}`, ...(opcije.headers || {}) },
      });
    } catch (e) {
      throw new HepiIznimka('mreza', String(e));
    }
    if (o.status === 401 || o.status === 403) throw new HepiIznimka('sesijaIstekla');
    if (o.status !== 200) throw new HepiIznimka('mreza', `HTTP ${o.status} za ${putanja}`);
    return o;
  }

  async function api(putanja) {
    const o = await zahtjev(putanja);
    try {
      return await o.json();
    } catch {
      throw new HepiIznimka('neocekivanOdgovor', `${putanja} nije JSON`);
    }
  }

  /** PDF računa (`link` iz promet.racuni[]), kao gumb za ispis računa na portalu. */
  async function hepiRacunPdf(link) {
    const o = await zahtjev('report/racun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });
    const b = new Uint8Array(await o.arrayBuffer());
    // Server šalje Content-Type text/html, pa se provjerava zaglavlje datoteke.
    if (String.fromCharCode(...b.slice(0, 5)) !== '%PDF-') throw new HepiIznimka('neocekivanOdgovor', 'račun nije PDF');
    return b;
  }

  /** @param {{napredak?: (poruka: string) => void}} [opcije] */
  async function hepiUvoz({ napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojracun.hep.hr' || !location.pathname.startsWith('/hepi')) {
      throw new HepiIznimka('mreza', 'pokreni na https://mojracun.hep.hr/hepi');
    }
    napredak('Dohvaćam kupce…');
    const popis = HepiParser.kupci(await api('kupci'));
    const kupci = [];
    for (const [i, k] of popis.entries()) {
      napredak(`Kupac ${k.sifra_kupca || k.kupac_id}${popis.length > 1 ? ` (${i + 1}/${popis.length})` : ''}…`);
      const { saldo, racuni, uplate } = HepiParser.promet(await api(`promet/${k.kupac_id}`));
      const { potrosnja, ocitanja } = HepiParser.potrosnja(await api(`potrosnja/${k.kupac_id}`));
      kupci.push({ ...k, saldo, ocitanja, potrosnja, racuni, uplate });
    }
    return { izvor: 'https://mojracun.hep.hr/hepi', dohvaceno: new Date().toISOString(), kupci };
  }

  const izvoz = { HepiParser, HepiIznimka, hepiUvoz, hepiRacunPdf };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- bookmarklet.js ----
// Bookmarklet „Uvezi iz HEP-a“: isti uvoz kao extension, bez instalacije.
//
// Oznaka u pregledniku ubacuje <script src="https://omm.domovina.ai/hep-uvoz.js?k=<ključ>">
// u prijavljenu karticu Moje mreže, Mojeg računa (Elektra) ili Mojeg Hepi
// računa. Ta datoteka je spoj uvoz.js + mojracun.js + hepi.js + ove datoteke
// (tools/bookmarklet.mjs), pa se kod
// izvršava na HEP-ovoj domeni: fetch je same-origin s cookiejima sesije, kao u
// extensionu. Na omm.domovina.ai odlazi samo gotov JSON, i to tek na klik.
//
// Zašto radi: nijedan portal nema CSP koji ograničava script-src ili
// connect-src (provjereno 2026-10-14), a /api/snimak ima CORS *. Ako se to
// promijeni, rezerva je nova kartica omm.domovina.ai/?primi=1 i postMessage.

(() => {
  const skripta = document.currentScript;
  const adresa = new URL(skripta ? skripta.src : 'https://omm.domovina.ai/hep-uvoz.js');
  const SERVER = adresa.origin;
  const KLJUC = adresa.searchParams.get('k');

  // Elektra i Hepi dijele origin mojracun.hep.hr, pa se razlikuju po putanji.
  const IZVORI = [
    { adresa: 'https://mojamreza.hep.hr/', ime: 'Moja mreža (HEP ODS)', funkcija: 'mojaMrezaUvoz', ommIzvor: 'hep', datoteka: 'moja-mreza',
      cita: ['mjerna mjesta (OMM, adresa, tarifa)', 'očitanja brojila', 'potrošnju po razdobljima'] },
    { adresa: 'https://mojracun.hep.hr/elektra', ime: 'Moj račun (HEP Elektra)', funkcija: 'mojRacunUvoz', ommIzvor: 'hep-moj-racun', datoteka: 'moj-racun',
      cita: ['kupca (OMM, adresa)', 'očitanja i potrošnju', 'promet (računi i uplate)'] },
    { adresa: 'https://mojracun.hep.hr/hepi', ime: 'Moj Hepi račun (HEP Opskrba)', funkcija: 'hepiUvoz', ommIzvor: 'hep-hepi', datoteka: 'hepi',
      cita: ['kupca (OMM, adresa, tarifni model)', 'saldo, račune i uplate', 'potrošnju i očitanja', 'PDF-ove računa koje još nemamo (čitamo brojeve, PDF ne čuvamo)'],
      racuni: true },
  ];
  const PORUKE = {
    sesijaIstekla: 'Nisi prijavljen. Prijavi se na ovoj stranici pa klikni oznaku ponovno.',
    neocekivanHtml: 'Stranica ne izgleda kako uvoz očekuje (HEP ju je možda promijenio).',
    neocekivanOdgovor: 'Odgovor Mojeg računa ne izgleda kako uvoz očekuje (HEP ga je možda promijenio).',
    nemaKupca: 'Ne vidim kupca. Otvori Potrošnju ili Promet u Mojem računu pa klikni oznaku ponovno.',
    mreza: 'Mreža ili preglednik javili su grešku.',
  };

  // Drugi klik na oznaku samo vrati postojeći prozorčić.
  const postojeci = document.getElementById('omm-domovina-uvoz');
  if (postojeci) {
    postojeci.style.display = '';
    return;
  }

  const domacin = document.createElement('div');
  domacin.id = 'omm-domovina-uvoz';
  domacin.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  // Shadow DOM: HEP-ov CSS ne dira prozorčić i obrnuto.
  const korijen = domacin.attachShadow({ mode: 'closed' });
  korijen.innerHTML = `
    <style>
      :host { all: initial; }
      .p { width: min(360px, calc(100vw - 32px)); box-sizing: border-box; background: #fff; color: #1b1f1a;
        border: 1px solid #dfe3db; border-radius: 14px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.18);
        font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
      h2 { font-size: 16px; margin: 0 0 4px; } p, ul { margin: 8px 0; } ul { padding-left: 18px; }
      .blijedo { color: #5d665b; font-size: 13px; }
      button { display: block; width: 100%; min-height: 40px; margin-top: 8px; border: 0; border-radius: 10px;
        font: inherit; font-weight: 600; cursor: pointer; background: #1f7a3a; color: #fff; }
      button.sporedni { background: transparent; color: #1b1f1a; border: 1px solid #dfe3db; }
      button:disabled { opacity: .5; cursor: default; }
      .x { position: absolute; top: 8px; right: 8px; width: 28px; min-height: 28px; margin: 0; padding: 0;
        background: transparent; color: #5d665b; font-size: 18px; }
      .greska { color: #b3261e; } a { color: #1f7a3a; }
      [hidden] { display: none !important; }
    </style>
    <div class="p" style="position:relative">
      <button class="x" id="zatvori" title="Zatvori">×</button>
      <h2>Uvoz na omm.domovina.ai</h2>
      <div id="sadrzaj"></div>
      <p id="status" class="blijedo" hidden></p>
    </div>`;
  document.body.append(domacin);
  const $ = (id) => korijen.getElementById(id);
  $('zatvori').onclick = () => { domacin.style.display = 'none'; };

  const status = (tekst, greska = false) => {
    $('status').hidden = !tekst;
    $('status').textContent = tekst || '';
    $('status').className = greska ? 'greska' : 'blijedo';
  };
  const gumb = (tekst, klik, sporedni = false) => {
    const b = document.createElement('button');
    b.textContent = tekst;
    if (sporedni) b.className = 'sporedni';
    b.onclick = klik;
    return b;
  };
  const odlomak = (html, klasa) => {
    const p = document.createElement('p');
    p.innerHTML = html;
    if (klasa) p.className = klasa;
    return p;
  };

  const izvor = IZVORI.find((i) => location.href.startsWith(i.adresa));
  const sadrzaj = $('sadrzaj');

  if (!KLJUC || !/^[A-Za-z0-9_-]{22,64}$/.test(KLJUC)) {
    sadrzaj.append(odlomak(`Oznaka nema ključ. Napravi je ponovno na <a href="${SERVER}/" target="_blank">${SERVER.replace('https://', '')}</a>.`, 'greska'));
    return;
  }
  if (!izvor) {
    sadrzaj.append(
      odlomak('Ova oznaka radi samo na HEP-ovim portalima. Otvori jedan, prijavi se i klikni je ponovno.'),
      gumb('Otvori Moju mrežu (HEP ODS)', () => { location.href = 'https://mojamreza.hep.hr/'; }),
      gumb('Otvori Moj račun (HEP Elektra)', () => { location.href = 'https://mojracun.hep.hr/elektra/'; }, true),
      gumb('Otvori Moj Hepi račun (HEP Opskrba)', () => { location.href = 'https://mojracun.hep.hr/hepi/'; }, true),
    );
    return;
  }

  const ul = document.createElement('ul');
  for (const c of izvor.cita) {
    const li = document.createElement('li');
    li.textContent = c;
    ul.append(li);
  }
  sadrzaj.append(
    odlomak(`<b>${izvor.ime}</b>: pročitat ćemo iz ove prijavljene sesije`),
    ul,
    odlomak(izvor.racuni
      ? 'i poslati na omm.domovina.ai. Ne čitamo OIB ni lozinku; token prijave koristimo samo na ovoj stranici i ne šaljemo ga nikamo.'
      : 'i poslati na omm.domovina.ai. Ne čitamo OIB, lozinku ni kolačiće; prijava ostaje u ovom pregledniku.', 'blijedo'),
  );
  const uvezi = gumb('Uvezi', pokreni);
  sadrzaj.append(uvezi);

  // OMM snimka kad uvoz ima točno jedno mjesto (Moja mreža) ili kupca (Moj račun).
  const jediniOmm = (u) => {
    const lista = u.mjesta || u.kupci || [];
    return lista.length === 1 ? lista[0].omm || null : null;
  };

  const sazetak = (u) =>
    (u.mjesta || u.kupci || []).map((m) =>
      `${m.omm || `kupac ${m.kupac_id}`}: ${m.ocitanja.length} očitanja, ${m.potrosnja.length} razdoblja potrošnje` +
      (m.promet ? `, ${m.promet.length} stavki prometa` : '') +
      (m.racuni ? `, ${m.racuni.length} računa` : ''));

  const tijelo = (u) => ({ izvor: izvor.ommIzvor, omm: jediniOmm(u), uvoz: u, lokacija: null });

  async function pokreni() {
    uvezi.disabled = true;
    status('Pokrećem…');
    let uvoz;
    try {
      uvoz = await globalThis[izvor.funkcija]({ napredak: status });
    } catch (e) {
      status(`${PORUKE[e.greska] || PORUKE.mreza} (${e.message || e})`, true);
      uvezi.disabled = false;
      uvezi.textContent = 'Pokušaj ponovno';
      return;
    }
    uvezi.remove();
    const lista = document.createElement('ul');
    for (const s of sazetak(uvoz)) {
      const li = document.createElement('li');
      li.textContent = s;
      lista.append(li);
    }
    if (!lista.children.length) lista.innerHTML = '<li>Nema mjernih mjesta na ovom računu.</li>';
    sadrzaj.append(lista);
    await posalji(uvoz);
  }

  async function posalji(uvoz) {
    status('Šaljem na omm.domovina.ai…');
    try {
      const o = await fetch(`${SERVER}/api/snimak`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KLJUC}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tijelo(uvoz)),
        credentials: 'omit',
      });
      const j = await o.json().catch(() => ({}));
      if (o.status !== 200 && o.status !== 201) throw new Error(j.greska || `HTTP ${o.status}`);
      const poruka = j.duplikat ? 'Isti uvoz je već bio na omm.domovina.ai ✓' : 'Spremljeno na omm.domovina.ai ✓';
      if (izvor.racuni) await posaljiRacune(uvoz);
      gotovo(poruka);
    } catch (e) {
      status(`Izravno slanje nije uspjelo (${e.message || e}).`, true);
      rezerva(uvoz);
    }
  }

  // Hepi: PDF-ove računa koje server još nema šalje na /api/racun, gdje se
  // pročitaju (isti parser kao za račune mailom) i odbace. Server vraća popis
  // poziva na broj koje već ima, pa se ponovni uvoz svodi na nove račune.
  async function posaljiRacune(uvoz) {
    const auth = { Authorization: `Bearer ${KLJUC}` };
    let imamo = [];
    try {
      const o = await fetch(`${SERVER}/api/racun`, { headers: auth, credentials: 'omit' });
      if (o.ok) imamo = await o.json();
    } catch {}
    const novi = uvoz.kupci.flatMap((k) => k.racuni).filter((r) => r.link && r.poziv_na_broj && !imamo.includes(r.poziv_na_broj));
    let procitano = 0;
    for (const [i, r] of novi.entries()) {
      status(`Račun ${i + 1}/${novi.length}…`);
      try {
        const pdf = await globalThis.hepiRacunPdf(r.link);
        const o = await fetch(`${SERVER}/api/racun`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: pdf, credentials: 'omit',
        });
        if (o.ok) procitano++;
      } catch {}
    }
    if (novi.length) {
      sadrzaj.append(odlomak(`Pročitano ${procitano} od ${novi.length} novih računa.`, procitano === novi.length ? 'blijedo' : 'greska'));
    }
  }

  function gotovo(poruka) {
    status('');
    sadrzaj.append(
      odlomak(`<b>${poruka}</b>`),
      // ?k= prenosi ključ oznake: stranica ga preuzme i pokaže uvoze i kad je
      // oznaka napravljena u drugom pregledniku ili profilu.
      gumb('Otvori omm.domovina.ai', () => window.open(`${SERVER}/?k=${encodeURIComponent(KLJUC)}`, '_blank')),
    );
  }

  // Ako HEP jednom uvede CSP ili WAF koji priječi fetch prema nama: nova
  // kartica omm.domovina.ai/?primi=1 javi „spreman“, dobije JSON preko
  // postMessage (provjerava event.origin) i sama ga spremi.
  function rezerva(uvoz) {
    sadrzaj.append(
      gumb('Pošalji preko nove kartice', () => {
        const prozor = window.open(`${SERVER}/?primi=1`, '_blank');
        if (!prozor) return status('Preglednik je blokirao novu karticu.', true);
        const slusaj = (e) => {
          if (e.origin !== SERVER || e.source !== prozor || !e.data || e.data.omm !== 'spreman') return;
          window.removeEventListener('message', slusaj);
          prozor.postMessage({ omm: 'uvoz', tijelo: tijelo(uvoz) }, SERVER);
          gotovo('Poslano u novu karticu omm.domovina.ai');
        };
        window.addEventListener('message', slusaj);
      }),
      gumb('Preuzmi JSON', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(uvoz, null, 2)], { type: 'application/json' }));
        a.download = `${izvor.datoteka}-${uvoz.dohvaceno.slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, true),
    );
  }
})();
